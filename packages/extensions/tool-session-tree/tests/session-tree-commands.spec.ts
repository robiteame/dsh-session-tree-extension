/**
 * Companion-package behavior tests: the /tree command family (every
 * subcommand), /fork, /clone, /session, tool argument validation, the Remote
 * service surface, store-level Pi clone semantics, and all three
 * model-surface modes (native, stock, projection) including durable-event
 * resume.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionTreeService, {
  getSessionTreeSidecar,
  setSessionTreeSidecar,
  SessionTree,
  SessionTreeSidecar,
  SessionTreeStore,
  sessionTreeStore,
  sessionTreeSurfaceMode,
  supportsDurableSessionTreeEvents,
  supportsSelectedMessageSurface,
  syncSessionTree,
} from '@robiteame/dsh-pi-agent-session-tree'
import type { SessionTreeSnapshot, TreeNode } from '@robiteame/dsh-pi-agent-session-tree'
import * as toolSessionTree from '@robiteame/dsh-tool-session-tree'

const testToolSignal = new AbortController().signal
const testSidecarRoot = mkdtempSync(join(tmpdir(), 'dsh-session-tree-cmd-sidecar-'))

beforeEach(() => {
  rmSync(testSidecarRoot, { recursive: true, force: true })
  mkdirSync(testSidecarRoot, { recursive: true })
  setSessionTreeSidecar(new SessionTreeSidecar(testSidecarRoot))
})

afterAll(() => {
  rmSync(testSidecarRoot, { recursive: true, force: true })
})

const treeOf = (id: string): SessionTree => {
  const tree = sessionTreeStore.get(SessionId(id))
  if (tree === undefined) throw new Error(`tree '${id}' missing from the store`)
  return tree
}

/** One registry-compatible live agent whose session id keys its tree. */
function stubAgent(rawId: string): Agent {
  const session = Session.create(SessionId(rawId))
  return {
    id: session.id,
    options: {},
    session,
    inbox: { append: () => {}, claim: () => [], dispose: () => {} } as unknown as Agent['inbox'],
    get status(): AgentStatus { return 'running' },
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Mount the plugin under a real Cordis context with its service deps. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SessionTreeService)
  await ctx.plugin(toolSessionTree)
  return { ctx, service: ctx.sessionTree }
}

/** Execute one registered tool on behalf of an agent and parse its JSON text. */
async function runTool(ctx: Context, agent: Agent, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result: ToolExecutionResult = await ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${Math.random()}`),
    name: 'session_tree',
    arguments: args,
    agent,
  })
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected session_tree success')
  const block = result.content[0]
  if (block?.type !== 'text') throw new Error('expected text tool result')
  return JSON.parse(block.text) as Record<string, unknown>
}

interface CommandOutcome {
  kind: 'success' | 'error'
  text: string
  json: Record<string, unknown>
}

/** Run one slash command and parse its JSON payload. */
async function command(ctx: Context, agent: Agent, line: string): Promise<CommandOutcome> {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  if (execution === undefined) throw new Error(`command '${line}' did not match a registration`)
  const parsed = JSON.parse(execution.result.text) as Record<string, unknown>
  return { kind: execution.result.kind, text: execution.result.text, json: parsed }
}

function expectOk(result: unknown): unknown {
  const record = result as { ok?: unknown; value?: unknown }
  expect(record.ok).toBe(true)
  if (record.value === undefined) throw new Error('expected ok result')
  return record.value
}

function expectError(result: unknown, code: string): void {
  const record = result as { ok?: unknown; error?: { code?: unknown } }
  expect(record.ok).toBe(false)
  expect(record.error?.code).toBe(code)
}

/** Seed one durable two-turn conversation (root user + assistant answer). */
function seedTurns(agent: Agent): void {
  agent.session.append('user/message', { id: 'm-root', role: 'user', content: [{ type: 'text', text: 'root' }], source: { kind: 'user' } } as never, { surfaceOp: 'append' })
  agent.session.append('assistant/message', { turn: 1, step: 1, message: { id: 'm-answer', role: 'assistant', content: [{ type: 'text', text: 'answer' }], source: { kind: 'model', provider: 'p', model: 'm' } } } as never, { surfaceOp: 'append' })
}

/** A patched-Harness session: real Session plus the selected-surface API. */
interface NativeLikeSession extends Session {
  messageSurfaceNodes(): readonly number[]
  selectMessageSurface(nodes: readonly number[] | null): void
}

function nativeLikeSession(rawId: string, seed?: readonly SessionEvent[]): NativeLikeSession {
  const real = Session.create(SessionId(rawId), seed)
  let selected: readonly number[] | null = null
  return {
    id: real.id,
    get events() { return real.events },
    append: real.append.bind(real) as Session['append'],
    surface: real.surface,
    requestContext: () => ({ provider: 'p', model: 'm' }),
    selectMessageSurface(nodes) { selected = [...(nodes ?? [])] },
    messageSurfaceNodes() { return selected ?? [...real.surface.nodes] },
  } as unknown as NativeLikeSession
}

/** A stock-like session whose live surface cannot be rewritten (frozen nodes). */
function frozenSurfaceSession(rawId: string): Session {
  const events: SessionEvent[] = [
    { type: 'user/message', seq: 0, time: 1, data: { role: 'user', content: 'one', source: { kind: 'user' } }, surfaceOp: 'append' },
    { type: 'user/message', seq: 1, time: 2, data: { role: 'user', content: 'two', source: { kind: 'user' } }, surfaceOp: 'append' },
  ] as unknown as SessionEvent[]
  return {
    id: SessionId(rawId),
    events,
    surface: { nodes: Object.freeze([0, 1]) as unknown as number[] },
    requestContext: () => ({ provider: 'p', model: 'm' }),
    append: ((type: string, data: Record<string, unknown>, opts?: { surfaceOp?: unknown }) => {
      const event = { type, seq: events.length, time: Date.now(), data, ...(opts?.surfaceOp === undefined ? {} : { surfaceOp: opts.surfaceOp }) } as SessionEvent
      events.push(event)
      return event
    }) as Session['append'],
  } as unknown as Session
}

function withSession(agent: Agent, session: Session): Agent {
  ;(agent as { session: Session }).session = session
  return agent
}

describe('/fork command', () => {
  it('opens the user-prompt selector without creating a source branch', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('cmd-fork-default')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    service.jump(agent, root.nodeId)

    const forked = await command(ctx, agent, '/fork')
    expect(forked.kind).toBe('success')
    expect(expectOk(forked.json)).toEqual({ selectorRequired: true, userNodeCount: 1 })
    expect(treeOf('cmd-fork-default').activeBranch).toBe('main')
    expect(treeOf('cmd-fork-default').branches()).toHaveLength(1)
    expect(root.nodeId).toBe('session-event-0')
  })

  it('reports an empty selector when the source has no user messages', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('cmd-fork-empty')
    agent.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: { id: 'm-answer', role: 'assistant', content: [{ type: 'text', text: 'assistant only' }] },
    } as never, { surfaceOp: 'append' })
    const sourceSurfaceEvents = structuredClone(agent.session.events.filter(event => event.type !== 'command/run' && event.type !== 'command/done'))

    const outcome = await command(ctx, agent, '/fork')
    expect(outcome.kind).toBe('success')
    expect(expectOk(outcome.json)).toEqual({ selectorRequired: true, userNodeCount: 0 })
    expect(agent.session.events.filter(event => event.type !== 'command/run' && event.type !== 'command/done')).toEqual(sourceSurfaceEvents)
    expect(service.list(agent).nodes.some(node => node.message?.role === 'user')).toBe(false)
  })

  it('keeps every pre-branch node byte-identical while the compatibility branch grows', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('cmd-fork-immutable')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    service.jump(agent, root.nodeId)
    const before = treeOf('cmd-fork-immutable').list()

    service.branchInPlace(agent, root.nodeId, 'experiment')
    agent.session.append('user/message', { id: 'm-alt', role: 'user', content: [{ type: 'text', text: 'alt prompt' }], source: { kind: 'user' } } as never, { surfaceOp: 'append' })
    service.list(agent) // project the fresh native event into the store

    const after = treeOf('cmd-fork-immutable').list()
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after).toHaveLength(before.length + 1)
    const grown = after[after.length - 1]!
    expect(grown.parentId).toBe(root.nodeId)
    expect(grown.branch).toBe('experiment')
    const branches = treeOf('cmd-fork-immutable').branches().map(branch => branch.name)
    expect(branches).toContain('main')
    expect(branches).toContain('experiment')
  })

  it('reports the live fork count as direct children of the fork point', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('cmd-fork-count')
    seedTurns(agent)
    const view = service.list(agent)
    const root = view.nodes[0]!
    service.jump(agent, root.nodeId)
    service.branchInPlace(agent, root.nodeId, 'first')
    agent.session.append('user/message', { id: 'm-a', role: 'user', content: [{ type: 'text', text: 'a' }], source: { kind: 'user' } } as never, { surfaceOp: 'append' })
    service.branchInPlace(agent, root.nodeId, 'second')
    agent.session.append('user/message', { id: 'm-b', role: 'user', content: [{ type: 'text', text: 'b' }], source: { kind: 'user' } } as never, { surfaceOp: 'append' })

    const result = await runTool(ctx, agent, { operation: 'fork', nodeId: root.nodeId, branch: 'third' })
    // Direct children of the fork point: the original answer plus both forks' turns.
    expect(expectOk(result)).toMatchObject({ cursor: root.nodeId, branch: 'third', forkCount: 3 })
  })
})

describe('/clone command', () => {
  it('rejects /clone and /tree clone before a node is selected', async () => {
    const { ctx } = await harness()
    const agent = stubAgent('cmd-clone-unselected')
    seedTurns(agent)
    for (const line of ['/clone', '/tree clone']) {
      const outcome = await command(ctx, agent, line)
      expect(outcome.kind).toBe('error')
      expectError(outcome.json, 'INVALID_ARGUMENT')
      expect(outcome.text).toContain('请先在右侧会话树选中目标节点')
    }
  })

  it('uses an explicit /tree clone target and persists the clone sidecar', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('cmd-clone-explicit')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    service.jump(agent, root.nodeId)

    const outcome = await command(ctx, agent, '/tree clone my-explicit-clone')
    expect(outcome.kind).toBe('success')
    expect(expectOk(outcome.json)).toEqual({ sessionId: 'my-explicit-clone' })
    const cloneTree = treeOf('my-explicit-clone')
    expect(cloneTree.list()).toHaveLength(2)
    expect(cloneTree.cursor).toBe(root.nodeId)
    expect(cloneTree.selectedNode).toBe(root.nodeId)
    const sidecar = getSessionTreeSidecar().load(SessionId('my-explicit-clone'))
    expect(sidecar?.cursor).toBe(root.nodeId)
    expect(sidecar?.list()).toHaveLength(2)
  })

  it('filters synthetic cursor events and rewrites snapshot ownership in the clone seed', async () => {
    const { ctx, service } = await harness()
    const created: Array<{ sessionId: string; seed: readonly SessionEvent[] }> = []
    ctx.agents.setFactory({
      createAgent: async (_ownerCtx, options) => {
        created.push({ sessionId: String(options.sessionId), seed: options.seed ?? [] })
        return { agent: stubAgent(String(options.sessionId)), dispose: () => Promise.resolve() }
      },
      resume: async () => { throw new Error('resume is unused in this test') },
    })
    const agent = stubAgent('cmd-clone-seed')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    // A stock-mode jump writes a synthetic cursor event into the source log.
    service.jump(agent, root.nodeId)
    expect(agent.session.events.some(event => event.type === 'assistant/message' && (event.data as { treeRestore?: unknown }).treeRestore !== undefined)).toBe(true)
    // A durable snapshot event whose embedded sessionId must be rewritten.
    const snapshot = treeOf('cmd-clone-seed').snapshot()
    agent.session.append('session-tree/snapshot', { snapshot } as never)

    const outcome = await command(ctx, agent, '/clone')
    expect(outcome.kind).toBe('success')
    expect(created).toHaveLength(1)
    const seed = created[0]!.seed
    expect(seed.some(event => (event.data as { treeRestore?: unknown }).treeRestore !== undefined)).toBe(false)
    const snapshotEvent = seed.find(event => event.type === 'session-tree/snapshot')
    expect((snapshotEvent?.data as { snapshot?: { sessionId?: string } }).snapshot?.sessionId).toBe(created[0]!.sessionId)

    const replayed = Session.create(SessionId('cmd-clone-seed-replay'), seed.slice())
    const texts = replayed.deriveMessages().map(message =>
      (message.content as Array<{ type?: string; text?: string }>).map(block => block.text ?? '').join(''),
    )
    expect(texts).toEqual(['root', 'answer'])
  })

  it('surfaces real agent-factory failures instead of degrading silently', async () => {
    const { ctx, service } = await harness()
    ctx.agents.setFactory({
      createAgent: async () => { throw new Error('boom: capacity exhausted') },
      resume: async () => { throw new Error('resume is unused in this test') },
    })
    const agent = stubAgent('cmd-clone-factory-error')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    service.jump(agent, root.nodeId)

    const outcome = await command(ctx, agent, '/clone')
    expect(outcome.kind).toBe('error')
    expectError(outcome.json, 'INVALID_ARGUMENT')
    expect(outcome.text).toContain('boom: capacity exhausted')
  })

  it('validates tool clone arguments and accepts an empty-tree clone', async () => {
    const { ctx } = await harness()
    const agent = stubAgent('cmd-clone-tool-validation')
    seedTurns(agent)

    expectError(await runTool(ctx, agent, { operation: 'clone' }), 'INVALID_ARGUMENT')
    expectError(await runTool(ctx, agent, { operation: 'clone', sessionId: 'other' }), 'INVALID_ARGUMENT')
    expectError(await runTool(ctx, agent, { operation: 'clone', sessionId: 'other', targetSessionId: 't' }), 'INVALID_ARGUMENT')

    const empty = stubAgent('cmd-clone-empty-source')
    const cloned = expectOk(await runTool(ctx, empty, { operation: 'clone', targetSessionId: 'cmd-clone-empty-target' })) as { sessionId: string }
    expect(cloned.sessionId).toBe('cmd-clone-empty-target')
    expect(treeOf('cmd-clone-empty-target').cursor).toBeNull()
    expect(treeOf('cmd-clone-empty-target').list()).toEqual([])
  })
})

describe('/tree command family', () => {
  it('serves every read subcommand with the active surface mode', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('cmd-tree-reads')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    service.jump(agent, root.nodeId)
    const expectedSurface = sessionTreeSurfaceMode(agent.session)

    for (const line of ['/tree', '/tree list', '/tree tree', '/tree session']) {
      const outcome = await command(ctx, agent, line)
      expect(outcome.kind).toBe('success')
      expect((expectOk(outcome.json) as { surface: string }).surface).toBe(expectedSurface)
    }
    const branches = expectOk((await command(ctx, agent, '/tree branches')).json) as Array<{ name: string }>
    expect(branches.map(branch => branch.name)).toContain('main')
    const list = expectOk((await command(ctx, agent, '/tree list')).json) as { nodes: TreeNode[]; surface: string }
    expect(list.nodes).toHaveLength(2)
    const view = expectOk((await command(ctx, agent, '/tree tree')).json) as { sessionId: string; nodes: TreeNode[]; cursor: string }
    expect(view.sessionId).toBe(agent.session.id)
    expect(view.nodes).toHaveLength(2)
    expect(view.cursor).toBe(root.nodeId)
    const info = expectOk((await command(ctx, agent, '/tree session')).json) as { nodeCount: number; snapshotVersion: number }
    expect(info.nodeCount).toBe(2)
    expect(info.snapshotVersion).toBe(1)
  })

  it('reads the selected path through /tree context', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('cmd-tree-context')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    service.jump(agent, root.nodeId)

    const outcome = await command(ctx, agent, '/tree context')
    expect(outcome.kind).toBe('success')
    const value = expectOk(outcome.json) as { cursor: string; selectedNodeId: string; messages: Array<{ content: string }> }
    expect(value.cursor).toBe(root.nodeId)
    expect(value.selectedNodeId).toBe(root.nodeId)
    expect(value.messages.map(message => message.content)).toEqual(['root'])
  })

  it('jumps by explicit id, by selection, and rejects without either', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('cmd-tree-jump')
    seedTurns(agent)
    const view = service.list(agent)
    const root = view.nodes[0]!

    const explicit = await command(ctx, agent, `/tree jump ${root.nodeId}`)
    expect(explicit.kind).toBe('success')
    expect((expectOk(explicit.json) as { cursor: string }).cursor).toBe(root.nodeId)
    expect(treeOf('cmd-tree-jump').selectedNode).toBe(root.nodeId)
    expect(agent.session.deriveMessages().map(message =>
      (message.content as Array<{ type?: string; text?: string }>).map(block => block.text ?? '').join(''),
    )).toEqual(['root'])

    // No argument falls back to the current selection.
    const bySelection = await command(ctx, agent, '/tree jump')
    expect(bySelection.kind).toBe('success')
    expect((expectOk(bySelection.json) as { cursor: string }).cursor).toBe(root.nodeId)

    const unselected = stubAgent('cmd-tree-jump-unselected')
    const missing = await command(ctx, unselected, '/tree jump')
    expect(missing.kind).toBe('error')
    expectError(missing.json, 'INVALID_ARGUMENT')
  })

  it('forks and branches from the selected node through /tree subcommands', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('cmd-tree-write')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    service.jump(agent, root.nodeId)

    const forked = await command(ctx, agent, '/tree fork via-tree')
    expect(forked.kind).toBe('success')
    expect(expectOk(forked.json)).toMatchObject({ cursor: root.nodeId, branch: 'via-tree' })
    expect(treeOf('cmd-tree-write').activeBranch).toBe('via-tree')

    const branched = await command(ctx, agent, '/tree branch via-branch')
    expect(branched.kind).toBe('success')
    expect(expectOk(branched.json)).toMatchObject({ cursor: root.nodeId, branch: 'via-branch' })
    expect(treeOf('cmd-tree-write').branches().map(branch => branch.name)).toEqual(expect.arrayContaining(['via-tree', 'via-branch']))

    const unselected = stubAgent('cmd-tree-write-unselected')
    seedTurns(unselected)
    const forkDenied = await command(ctx, unselected, '/tree fork')
    expect(forkDenied.kind).toBe('error')
    expect(forkDenied.text).toContain('请先在右侧会话树选中目标节点')
    const branchDenied = await command(ctx, unselected, '/tree branch anywhere')
    expect(branchDenied.kind).toBe('error')
    expectError(branchDenied.json, 'NODE_NOT_FOUND')
  })

  it('round-trips /tree snapshot save and load, including spaced JSON', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('cmd-tree-snapshot')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!

    const saved = await command(ctx, agent, '/tree snapshot save')
    expect(saved.kind).toBe('success')
    const snapshot = expectOk(saved.json) as SessionTreeSnapshot
    expect(snapshot.version).toBe(1)
    expect(snapshot.nodes).toHaveLength(2)

    // Reassemble a snapshot whose JSON was split across command words. The
    // payload avoids commas/colons inside string values so the spacing stays
    // parseable; createdAt colons are fine (validation is type-only).
    const spaced = JSON.stringify(snapshot).split(',').join(', ').split(':').join(': ')
    const loaded = await command(ctx, agent, `/tree snapshot load ${spaced}`)
    expect(loaded.kind).toBe('success')
    expect(treeOf('cmd-tree-snapshot').list()).toHaveLength(2)

    const missing = await command(ctx, agent, '/tree snapshot load')
    expect(missing.kind).toBe('error')
    expect(missing.text).toContain('snapshot JSON is required')

    const foreign = await command(ctx, agent, `/tree snapshot load ${JSON.stringify({ version: 1, sessionId: 'someone-else', cursor: null, activeBranch: 'main', nodes: [] })}`)
    expect(foreign.kind).toBe('error')
    expectError(foreign.json, 'INVALID_SNAPSHOT')

    const malformed = await command(ctx, agent, '/tree snapshot load {not json')
    expect(malformed.kind).toBe('error')
    expectError(malformed.json, 'INVALID_SNAPSHOT')
    // root stays reachable for the type checker after the assertions above.
    expect(root.nodeId).toBeDefined()
  })

  it('continues appending from the restored cursor after /tree snapshot load', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('cmd-tree-snapshot-resume')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    service.jump(agent, root.nodeId)
    const snapshot = treeOf('cmd-tree-snapshot-resume').snapshot()

    // Simulate a diverged tree, then restore: the next native append must fork
    // from the snapshot's cursor, not the diverged tail.
    const diverged = expectOk(await runTool(ctx, agent, { operation: 'append', message: { role: 'user', content: 'diverged tail' } })) as TreeNode
    const restored = await command(ctx, agent, `/tree snapshot load ${JSON.stringify(snapshot)}`)
    expect(restored.kind).toBe('success')
    expect(treeOf('cmd-tree-snapshot-resume').list().some(node => node.nodeId === diverged.nodeId)).toBe(false)

    agent.session.append('user/message', { id: 'm-after', role: 'user', content: [{ type: 'text', text: 'after restore' }], source: { kind: 'user' } } as never, { surfaceOp: 'append' })
    const after = service.list(agent)
    const tail = after.nodes.find(node => node.summary === 'after restore')
    expect(tail?.parentId).toBe(root.nodeId)
  })

  it('answers unknown subcommands with the usage line', async () => {
    const { ctx } = await harness()
    const agent = stubAgent('cmd-tree-usage')
    const outcome = await command(ctx, agent, '/tree nonsense')
    expect(outcome.kind).toBe('error')
    expect(outcome.text).toContain('Usage: /tree')
  })
})

describe('/session command', () => {
  it('reports full tree status with the active surface mode', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('cmd-session')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    service.jump(agent, root.nodeId)
    await runTool(ctx, agent, {
      operation: 'append',
      message: { role: 'assistant', content: 'custom' },
      model: 'deepseek-chat',
      usage: { inputTokens: 10, outputTokens: 5 },
      cost: 0.02,
    })

    const outcome = await command(ctx, agent, '/session')
    expect(outcome.kind).toBe('success')
    const info = expectOk(outcome.json) as Record<string, unknown>
    expect(info.sessionId).toBe(agent.session.id)
    expect(info.nodeCount).toBe(3)
    expect(info.messageCount).toBe(3)
    // The custom append grew the path root → custom, so the live path is 2 long.
    expect(info.currentPathLength).toBe(2)
    expect(info.snapshotVersion).toBe(1)
    expect(info.tokenCount).toBe(15)
    expect(info.cost).toBe(0.02)
    expect(info.surface).toBe(sessionTreeSurfaceMode(agent.session))
  })
})

describe('session_tree tool argument validation', () => {
  it('treats duplicate creates as idempotent and rejects every missing required argument', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('tool-validation')
    await runTool(ctx, agent, { operation: 'create' })
    seedTurns(agent)
    service.list(agent)
    const again = expectOk(await runTool(ctx, agent, { operation: 'create' })) as { sessionId: string }
    expect(again.sessionId).toBe(agent.session.id)
    // The idempotent create must not reset the projected tree.
    expect(treeOf('tool-validation').list()).toHaveLength(2)

    expectError(await runTool(ctx, agent, { operation: 'append', message: { content: 'no role' } }), 'INVALID_ARGUMENT')
    expectError(await runTool(ctx, agent, { operation: 'append', message: { role: 'user', content: 'x' }, branch: '   ' }), 'INVALID_ARGUMENT')
    expectError(await runTool(ctx, agent, { operation: 'fork' }), 'INVALID_ARGUMENT')
    expectError(await runTool(ctx, agent, { operation: 'branch', nodeId: 'n' }), 'INVALID_ARGUMENT')
    expectError(await runTool(ctx, agent, { operation: 'branch.summary', nodeId: 'n' }), 'INVALID_ARGUMENT')
    expectError(await runTool(ctx, agent, { operation: 'snapshot.load' }), 'INVALID_ARGUMENT')
  })

  it('serves context for an explicit node instead of the cursor', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('tool-context-node')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    await runTool(ctx, agent, { operation: 'append', message: { role: 'user', content: 'extra tail' } })

    const context = expectOk(await runTool(ctx, agent, { operation: 'context', nodeId: root.nodeId })) as { messages: Array<{ content: string }> }
    expect(context.messages.map(message => message.content)).toEqual(['root'])
  })

  it('refuses to run without an agent-backed session', async () => {
    const { ctx } = await harness()
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('call-no-agent'),
      name: 'session_tree',
      arguments: { operation: 'sessions' },
      agent: undefined,
    })
    const block = result.content[0]
    if (block?.type !== 'text') throw new Error('expected text tool result')
    expectError(JSON.parse(block.text), 'INVALID_ARGUMENT')
  })
})

describe('sessionTree Remote service', () => {
  it('passes an isolated root-path seed to the forked Agent factory', async () => {
    const { ctx, service } = await harness()
    const created: Array<{ sessionId: string; seed: readonly SessionEvent[] }> = []
    ctx.agents.setFactory({
      createAgent: async (_ownerCtx, options) => {
        created.push({ sessionId: String(options.sessionId), seed: options.seed ?? [] })
        return { agent: stubAgent(String(options.sessionId)), dispose: () => Promise.resolve() }
      },
      resume: async () => { throw new Error('resume is unused in this test') },
    })

    const agent = stubAgent('remote-fork-seed')
    agent.session.append('turn/start', { turn: 0 })
    agent.session.append('user/message', {
      id: 'm-root',
      role: 'user',
      content: [{ type: 'text', text: 'root prompt' }],
      source: { kind: 'user' },
    } as never, { surfaceOp: 'append' })
    agent.session.append('assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: 'm-answer',
        role: 'assistant',
        content: [{ type: 'text', text: 'later answer' }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
    } as never, { surfaceOp: 'append' })
    agent.session.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
    const root = service.list(agent).nodes.find(node => node.message?.role === 'user')
    if (root === undefined) throw new Error('expected user root')
    const sourceEvents = structuredClone(agent.session.events)

    const forked = await service.forkSession(agent, root.nodeId, 'seed-check')
    expect(created).toHaveLength(1)
    expect(created[0]?.sessionId).toBe(String(forked.sessionId))
    expect(created[0]?.seed.some(event => event.type === 'assistant/message')).toBe(false)
    expect(created[0]?.seed.map(event => event.type)).toEqual(['turn/start', 'user/message', 'turn/end'])

    const target = Session.create(SessionId('remote-fork-seed-replay'), created[0]?.seed)
    expect(target.deriveMessages().map(message => message.role)).toEqual(['user'])
    expect(agent.session.events).toEqual(sourceEvents)
  })

  it('forks with the default branch name and throws the standard error for unknown nodes', async () => {
    const { service } = await harness()
    const agent = stubAgent('remote-fork')
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!

    const sourceEvents = structuredClone(agent.session.events)
    const forked = await service.forkSession(agent, root.nodeId, '')
    expect(forked).toMatchObject({ cursor: root.nodeId, branch: 'fork' })
    expect(forked.sessionId).toMatch(/^remote-fork-fork-/u)
    expect(forked.prompt).toBe('root')
    // The source log is read-only: no branch marker or other event is added.
    expect(agent.session.events).toEqual(sourceEvents)
    // The independent copy contains only the selected root-to-node path.
    const target = treeOf(forked.sessionId!)
    expect(target.list()).toHaveLength(1)
    expect(target.list()[0]?.message).toMatchObject({ role: 'user', content: 'root' })
    expect(target.cursor).toBe(root.nodeId)
    expect(target.activeBranch).toBe('fork')

    await expect(service.forkSession(agent, 'missing-node', 'x')).rejects.toThrow('NODE_NOT_FOUND')
    const assistant = service.list(agent).nodes.find(node => node.message?.role === 'assistant')
    if (assistant === undefined) throw new Error('expected assistant node')
    await expect(service.forkSession(agent, assistant.nodeId, 'assistant-only')).rejects.toThrow('user-message node')
  })

  it('copies a leaf user node without carrying the abandoned assistant turn', async () => {
    const { service } = await harness()
    const agent = stubAgent('remote-fork-leaf')
    agent.session.append('user/message', { id: 'm-root', role: 'user', content: [{ type: 'text', text: 'root' }], source: { kind: 'user' } } as never, { surfaceOp: 'append' })
    agent.session.append('assistant/message', { turn: 1, step: 1, message: { id: 'm-answer', role: 'assistant', content: [{ type: 'text', text: 'answer' }] } } as never, { surfaceOp: 'append' })
    const root = service.list(agent).nodes[0]!
    // Start a real alternative branch from root; the first-turn assistant is
    // a sibling, not an ancestor, of the selected retry prompt.
    service.jump(agent, root.nodeId)
    agent.session.append('user/message', { id: 'm-leaf', role: 'user', content: [{ type: 'text', text: 'retry prompt' }], source: { kind: 'user' } } as never, { surfaceOp: 'append' })
    const tree = service.list(agent)
    const leaf = tree.nodes.find(node => node.summary === 'retry prompt')!
    const sourceEvents = structuredClone(agent.session.events)

    const forked = await service.forkSession(agent, leaf.nodeId, 'retry')
    expect(forked.prompt).toBe('retry prompt')
    const target = treeOf(forked.sessionId!)
    expect(target.list().map(node => node.summary)).toEqual(['root', 'retry prompt'])
    expect(target.list().some(node => node.summary === 'answer')).toBe(false)
    expect(target.cursor).toBe(leaf.nodeId)
    expect(target.activeBranch).toBe('retry')
    expect(agent.session.events).toEqual(sourceEvents)
  })

  it('creates an empty tree on first read and serves session info', async () => {
    const { service } = await harness()
    const agent = stubAgent('remote-empty')
    const view = service.list(agent)
    expect(view.nodes).toEqual([])
    expect(view.cursor).toBeNull()
    expect(service.session(agent)).toMatchObject({ sessionId: agent.session.id, nodeCount: 0, branchCount: 0 })
  })
})

describe('store-level clone (Pi active-branch semantics)', () => {
  it('clones only the active path with fresh node ids', () => {
    const store = new SessionTreeStore()
    const source = store.create(SessionId('store-clone-src'))
    const root = expectOk(source.append({ role: 'user', content: 'root' })) as TreeNode
    expectOk(source.append({ role: 'assistant', content: 'abandoned' }))
    expect(source.jump(root.nodeId).ok).toBe(true)
    const alt = expectOk(source.append({ role: 'assistant', content: 'active' })) as TreeNode

    const cloned = store.clone(SessionId('store-clone-src'), SessionId('store-clone-dst'))
    expect(cloned.ok).toBe(true)
    const target = store.get(SessionId('store-clone-dst'))!
    const nodes = target.list()
    expect(nodes).toHaveLength(2)
    expect(nodes.map(node => node.message?.content)).toEqual(['root', 'active'])
    const sourceIds = new Set(source.list().map(node => node.nodeId))
    for (const node of nodes) expect(sourceIds.has(node.nodeId)).toBe(false)
    expect(nodes[1]?.parentId).toBe(nodes[0]?.nodeId)
    expect(target.cursor).toBe(nodes[1]?.nodeId)

    expectError(store.clone(SessionId('store-clone-src'), SessionId('store-clone-dst')), 'SESSION_ALREADY_EXISTS')
    expectError(store.clone(SessionId('no-such-source'), SessionId('store-clone-other')), 'SESSION_NOT_FOUND')
    expect(alt.nodeId).toBeDefined()
  })
})

describe('native surface mode (patched Harness)', () => {
  it('detects the selected-surface API and reports native mode', async () => {
    const { ctx } = await harness()
    const session = nativeLikeSession('native-detect')
    const agent = withSession(stubAgent('native-detect'), session)
    seedTurns(agent)

    expect(supportsSelectedMessageSurface(session)).toBe(true)
    expect(sessionTreeSurfaceMode(session)).toBe('native')
    expect(supportsDurableSessionTreeEvents(session)).toBe(true)
    const info = expectOk(await runTool(ctx, agent, { operation: 'session' })) as { surface: string }
    expect(info.surface).toBe('native')
  })

  it('switches the selected surface and writes durable branch/selection events on /fork', async () => {
    const { ctx, service } = await harness()
    const session = nativeLikeSession('native-fork')
    const agent = withSession(stubAgent('native-fork'), session)
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    // Selection comes from an explicit jump; native mode records durable
    // cursor and selection markers for it.
    service.jump(agent, root.nodeId)
    expect(session.messageSurfaceNodes()).toEqual([0])

    const forked = service.branchInPlace(agent, root.nodeId, 'durable-alt')
    expect(forked).toMatchObject({ cursor: root.nodeId, branch: 'durable-alt' })
    expect(session.messageSurfaceNodes()).toEqual([0])
    const durable = session.events.filter(event => event.type.startsWith('session-tree/'))
    expect(durable.map(event => `${event.type}:${(event.data as { nodeId?: string }).nodeId}`)).toEqual([
      `session-tree/cursor:${root.nodeId}`,
      `session-tree/selection:${root.nodeId}`,
      `session-tree/branch:${root.nodeId}`,
      `session-tree/selection:${root.nodeId}`,
    ])
    // The durable log stays replayable: canonical history survives verbatim.
    const replayed = Session.create(SessionId('native-fork-replay'), session.events.slice())
    expect(replayed.deriveMessages()).toHaveLength(2)
  })

  it('restores cursor, branch, selection, and surface from the durable log on resume', async () => {
    const { ctx, service } = await harness()
    const source = nativeLikeSession('native-resume')
    const agent = withSession(stubAgent('native-resume'), source)
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    service.jump(agent, root.nodeId)
    service.branchInPlace(agent, root.nodeId, 'resumed-branch')
    agent.session.append('user/message', { id: 'm-alt', role: 'user', content: [{ type: 'text', text: 'alt turn' }], source: { kind: 'user' } } as never, { surfaceOp: 'append' })
    // Consume the full log once on the source side, then capture the surface
    // selection the live agent ended up with.
    service.list(agent)
    const expectedSurface = [...source.messageSurfaceNodes()]
    expect(expectedSurface[0]).toBe(0)
    expect(expectedSurface).toHaveLength(2)

    // Fresh process: a new session replays the same durable log.
    const revivedSession = nativeLikeSession('native-resume-2', source.events.slice())
    const revived = withSession(stubAgent('native-resume-2'), revivedSession)
    const tree = syncSessionTree(revived)
    const alt = tree.list().find(node => node.summary === 'alt turn')
    expect(alt?.parentId).toBe(root.nodeId)
    expect(alt?.branch).toBe('resumed-branch')
    expect(tree.cursor).toBe(alt?.nodeId)
    expect(tree.selectedNode).toBe(root.nodeId)
    expect(tree.activeBranch).toBe('resumed-branch')
    expect(tree.branches().map(branch => branch.name)).toEqual(expect.arrayContaining(['main', 'resumed-branch']))
    expect(revivedSession.messageSurfaceNodes()).toEqual(expectedSurface)
    expect(tree.messages().map(message => message.content)).toEqual(['root', 'alt turn'])
  })

  it('keeps native jump markers replayable and restores the cursor on resume', async () => {
    const { service } = await harness()
    const source = nativeLikeSession('native-jump-resume')
    const agent = withSession(stubAgent('native-jump-resume'), source)
    seedTurns(agent)
    const root = service.list(agent).nodes[0]!
    service.jump(agent, root.nodeId)
    const durable = source.events.filter(event => event.type.startsWith('session-tree/'))
    expect(durable.map(event => event.type)).toEqual(['session-tree/cursor', 'session-tree/selection'])

    const revivedSession = nativeLikeSession('native-jump-resume-2', source.events.slice())
    const revived = withSession(stubAgent('native-jump-resume-2'), revivedSession)
    const tree = syncSessionTree(revived)
    expect(tree.cursor).toBe(root.nodeId)
    expect(revivedSession.messageSurfaceNodes()).toEqual([0])
  })
})

describe('projection surface mode (unwritable live surface)', () => {
  it('degrades navigation to projection-only without throwing', async () => {
    const { ctx } = await harness()
    const session = frozenSurfaceSession('projection-fallback')
    const agent = withSession(stubAgent('projection-fallback'), session)
    expect(sessionTreeSurfaceMode(session)).toBe('stock')

    const service = ctx.sessionTree
    const view = service.list(agent)
    expect(view.nodes).toHaveLength(2)
    expect(() => service.jump(agent, view.nodes[0]!.nodeId)).not.toThrow()
    expect(treeOf('projection-fallback').cursor).toBe(view.nodes[0]!.nodeId)

    expect(sessionTreeSurfaceMode(session)).toBe('projection')
    const outcome = await command(ctx, agent, '/session')
    expect(outcome.kind).toBe('success')
    expect((expectOk(outcome.json) as { surface: string }).surface).toBe('projection')

    // The sidecar still carries the navigation for the next process.
    const sidecar = getSessionTreeSidecar().load(SessionId('projection-fallback'))
    expect(sidecar?.cursor).toBe(view.nodes[0]!.nodeId)
    expect(Object.isFrozen(session.surface.nodes)).toBe(true)
  })
})

describe('SessionTree domain guards', () => {
  it('round-trips checkpoint and rollback across every mutation', () => {
    const tree = new SessionTree(SessionId('domain-checkpoint'))
    const root = expectOk(tree.append({ role: 'user', content: 'root' })) as TreeNode
    expectOk(tree.append({ role: 'assistant', content: 'answer' }))
    tree.select(root.nodeId)
    tree.markSessionEventSeq(7)
    const checkpoint = tree.checkpoint()

    tree.jump(root.nodeId)
    tree.branch(root.nodeId, 'divergent')
    expectOk(tree.append({ role: 'user', content: 'extra' }))
    tree.select(tree.cursor ?? root.nodeId)
    tree.markSessionEventSeq(42)

    expect(tree.rollback(checkpoint).ok).toBe(true)
    expect(tree.list()).toHaveLength(2)
    expect(tree.cursor).toBe(checkpoint.cursor)
    expect(tree.selectedNode).toBe(root.nodeId)
    expect(tree.activeBranch).toBe('main')
    expect(tree.branches().map(branch => branch.name)).toEqual(['main'])
    expect(tree.lastSessionEventSeq()).toBe(7)

    expectError(tree.select('missing'), 'NODE_NOT_FOUND')
    expect(tree.jump(null).ok).toBe(true)
    expect(tree.cursor).toBeNull()
    expect(tree.messages()).toEqual([])
  })
})

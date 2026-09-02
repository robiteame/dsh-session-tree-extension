/**
 * Host-half behavior tests: append-only history, cursor jumps, standard LLM
 * message reconstruction, branch preservation, snapshots, multi-tree
 * coexistence, the standard error envelope, the /tree command family, and the
 * system-prompt section.
 */

import { describe, expect, it } from 'vitest'
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
import SessionTreeService, { sessionTreeStore, syncSessionTree } from '@deepseek-ai/dsh-pi-agent-session-tree'
import type { SessionTreeSnapshot, TreeNode } from '@deepseek-ai/dsh-pi-agent-session-tree'
import { sessionEventsToTreeNodes } from '@deepseek-ai/dsh-pi-agent-session-tree'
import * as toolSessionTree from '@deepseek-ai/dsh-tool-session-tree'

const testToolSignal = new AbortController().signal
const sessionTreeStoreForTest = (id: string) => sessionTreeStore.get(SessionId(id))

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
  const fiber = await ctx.plugin(toolSessionTree)
  return { ctx, fiber, service: ctx.sessionTree }
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
  const parsed = JSON.parse(block.text) as Record<string, unknown>
  expect(result.value).toEqual(parsed)
  return parsed
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

function nodeOf(nodes: readonly TreeNode[], summary: string): TreeNode {
  const node = nodes.find(candidate => candidate.summary === summary)
  if (node === undefined) throw new Error(`node with summary '${summary}' not found`)
  return node
}

describe('session_tree tool: append-only history', () => {
  it('appends nodes as children of the cursor, never modifying old nodes', async () => {
    const { ctx } = await harness()
    const agent = stubAgent('tree-append-only')
    await runTool(ctx, agent, { operation: 'create' })
    const first = expectOk(await runTool(ctx, agent, {
      operation: 'append',
      message: { role: 'user', content: 'first question' },
    })) as TreeNode
    const second = expectOk(await runTool(ctx, agent, {
      operation: 'append',
      message: { role: 'assistant', content: 'first answer' },
    })) as TreeNode
    expect(second.parentId).toBe(first.nodeId)
    expect(first.parentId).toBe(null)

    const list = expectOk(await runTool(ctx, agent, { operation: 'list' })) as TreeNode[]
    const replay = list.find(node => node.nodeId === first.nodeId)
    expect(replay).toEqual(first)
  })

  it('preserves every branch across jumps and forks', async () => {
    const { ctx } = await harness()
    const agent = stubAgent('tree-branches')
    await runTool(ctx, agent, { operation: 'create' })
    const root = expectOk(await runTool(ctx, agent, {
      operation: 'append', message: { role: 'user', content: 'root' },
    })) as TreeNode
    await runTool(ctx, agent, {
      operation: 'append', message: { role: 'assistant', content: 'main path' },
    })
    // Fork: park at root, name a new branch, append.
    await runTool(ctx, agent, { operation: 'branch', nodeId: root.nodeId, branch: 'alt' })
    const altNode = expectOk(await runTool(ctx, agent, {
      operation: 'append', message: { role: 'user', content: 'alternative path' },
    })) as TreeNode
    expect(altNode.parentId).toBe(root.nodeId)
    expect(altNode.branch).toBe('alt')

    const list = expectOk(await runTool(ctx, agent, { operation: 'list' })) as TreeNode[]
    expect(list).toHaveLength(3)
    // Jumping back to root and appending forks a second branch.
    await runTool(ctx, agent, { operation: 'jump', nodeId: root.nodeId })
    await runTool(ctx, agent, { operation: 'branch', nodeId: root.nodeId, branch: 'second-alt' })
    const fork = expectOk(await runTool(ctx, agent, {
      operation: 'append', message: { role: 'user', content: 'fork path' },
    })) as TreeNode
    expect(fork.parentId).toBe(root.nodeId)

    const branches = expectOk(await runTool(ctx, agent, { operation: 'branches' })) as Array<{ name: string; headId: string; nodeIds: string[] }>
    expect(branches.map(branch => branch.name).sort()).toEqual(['alt', 'main', 'second-alt'])
    expect(branches.find(branch => branch.name === 'alt')?.nodeIds).toContain(altNode.nodeId)
    expect(branches.find(branch => branch.name === 'alt')?.headId).toBe(altNode.nodeId)
    const view = expectOk(await runTool(ctx, agent, { operation: 'tree' })) as { branchHeads: Record<string, string> }
    expect(view.branchHeads.alt).toBe(altNode.nodeId)
  })

  it('reconstructs standard LLM messages for the root-to-cursor path only', async () => {
    const { ctx } = await harness()
    const agent = stubAgent('tree-context')
    await runTool(ctx, agent, { operation: 'create' })
    const root = expectOk(await runTool(ctx, agent, {
      operation: 'append', message: { role: 'user', content: 'root question' },
    })) as TreeNode
    await runTool(ctx, agent, {
      operation: 'append', message: { role: 'assistant', content: 'main answer' },
    })
    await runTool(ctx, agent, { operation: 'branch', nodeId: root.nodeId, branch: 'alt' })
    await runTool(ctx, agent, {
      operation: 'append', message: { role: 'user', content: 'alt question' },
    })

    const context = expectOk(await runTool(ctx, agent, { operation: 'context' })) as {
      cursor: string | null
      messages: Array<{ role: string; content: string }>
    }
    expect(context.messages).toEqual([
      { role: 'user', content: 'root question' },
      { role: 'user', content: 'alt question' },
    ])
    expect(context.cursor).not.toBeNull()
  })

  it('branches with a summary without touching the abandoned path', async () => {
    const { ctx } = await harness()
    const agent = stubAgent('tree-summary')
    await runTool(ctx, agent, { operation: 'create' })
    const root = expectOk(await runTool(ctx, agent, {
      operation: 'append', message: { role: 'user', content: 'root' },
    })) as TreeNode
    await runTool(ctx, agent, {
      operation: 'append', message: { role: 'assistant', content: 'explored' },
    })
    const summary = expectOk(await runTool(ctx, agent, {
      operation: 'branch.summary', nodeId: root.nodeId, summary: 'abandoned exploration',
    })) as TreeNode
    expect(summary.parentId).toBe(root.nodeId)
    const list = expectOk(await runTool(ctx, agent, { operation: 'list' })) as TreeNode[]
    expect(list).toHaveLength(3)
    expect(nodeOf(list, 'explored').message?.content).toBe('explored')
  })

  it('round-trips JSON snapshots with full restore', async () => {
    const { ctx } = await harness()
    const agent = stubAgent('tree-snapshot')
    await runTool(ctx, agent, { operation: 'create' })
    await runTool(ctx, agent, {
      operation: 'append', message: { role: 'user', content: 'kept question' },
    })
    const snapshot = expectOk(await runTool(ctx, agent, { operation: 'snapshot.save' })) as SessionTreeSnapshot
    expect(snapshot.version).toBe(1)
    expect(snapshot.nodes).toHaveLength(1)

    const restored = expectOk(await runTool(ctx, agent, {
      operation: 'snapshot.load', snapshot,
    })) as { sessionId: string }
    expect(restored.sessionId).toBe(agent.session.id)
    const list = expectOk(await runTool(ctx, agent, { operation: 'list' })) as TreeNode[]
    expect(list).toHaveLength(1)
    expect(list[0]?.message?.content).toBe('kept question')

    const bad = await runTool(ctx, agent, {
      operation: 'snapshot.load',
      snapshot: { version: 99, sessionId: agent.session.id, cursor: null, activeBranch: 'main', nodes: [] },
    })
    expectError(bad, 'INVALID_SNAPSHOT')
  })

  it('keeps multiple trees independent and reports standard errors', async () => {
    const { ctx } = await harness()
    const alpha = stubAgent('tree-alpha')
    const beta = stubAgent('tree-beta')
    await runTool(ctx, alpha, { operation: 'create' })
    await runTool(ctx, beta, { operation: 'create' })
    await runTool(ctx, alpha, {
      operation: 'append', message: { role: 'user', content: 'alpha only' },
    })
    const betaList = expectOk(await runTool(ctx, beta, { operation: 'list' })) as TreeNode[]
    expect(betaList).toHaveLength(0)

    const sessions = expectOk(await runTool(ctx, alpha, { operation: 'sessions' })) as string[]
    expect(sessions).toContain(alpha.session.id)
    expect(sessions).toContain(beta.session.id)

    const missing = await runTool(ctx, beta, { operation: 'jump', nodeId: 'no-such-node' })
    expectError(missing, 'NODE_NOT_FOUND')
    const foreignAppend = await runTool(ctx, alpha, { sessionId: beta.session.id, operation: 'append', message: { role: 'user', content: 'forbidden' } })
    expectError(foreignAppend, 'INVALID_ARGUMENT')
    const foreignJump = await runTool(ctx, alpha, { sessionId: beta.session.id, operation: 'jump', nodeId: 'no-such-node' })
    expectError(foreignJump, 'INVALID_ARGUMENT')
    const foreignBranch = await runTool(ctx, alpha, { sessionId: beta.session.id, operation: 'branch', nodeId: 'no-such-node', branch: 'forbidden' })
    expectError(foreignBranch, 'INVALID_ARGUMENT')
    const unknownOp = await runTool(ctx, alpha, { operation: 'nope' })
    expectError(unknownOp, 'INVALID_ARGUMENT')
  })

  it('supports Pi-style fork, clone, and session status', async () => {
    const { ctx } = await harness()
    const agent = stubAgent('tree-pi-surfaces')
    await runTool(ctx, agent, { operation: 'create' })
    const root = expectOk(await runTool(ctx, agent, { operation: 'append', message: { role: 'user', content: 'root' } })) as TreeNode
    await runTool(ctx, agent, { operation: 'append', message: { role: 'assistant', content: 'answer' } })
    const fork = expectOk(await runTool(ctx, agent, { operation: 'fork', nodeId: root.nodeId, branch: 'alt' })) as { cursor: string; branch: string }
    expect(fork.cursor).toBe(root.nodeId)
    expect(fork.branch).toBe('alt')
    const browsed = expectOk(await runTool(ctx, agent, { operation: 'jump', nodeId: root.nodeId })) as { cursor: string }
    expect(browsed.cursor).toBe(root.nodeId)
    const view = expectOk(await runTool(ctx, agent, { operation: 'tree' })) as { branchHeads: Record<string, string> }
    expect(view.branchHeads.alt).toBe(root.nodeId)
    const cloned = expectOk(await runTool(ctx, agent, { operation: 'clone', targetSessionId: 'tree-pi-clone' })) as { sessionId: string }
    expect(cloned.sessionId).toBe('tree-pi-clone')
    const status = expectOk(await runTool(ctx, agent, { operation: 'session' })) as { nodeCount: number; currentPathLength: number }
    expect(status.nodeCount).toBe(2)
    expect(status.currentPathLength).toBe(1)
    const cloneTree = sessionTreeStoreForTest('tree-pi-clone')
    // The clone inherits the whole source tree (root + abandoned answer) even
    // though the cursor is parked at root; it must not be a leaf-only envelope.
    expect(cloneTree?.list()).toHaveLength(2)
    expect(nodeOf(cloneTree?.list() ?? [], 'answer').message?.content).toBe('answer')
    expect(cloneTree?.cursor).toBe(root.nodeId)
  })

  it('projects Harness message and tool events into a parent-linked tree', () => {
    const nodes = sessionEventsToTreeNodes([
      { type: 'user/message', seq: 0, time: 1000, data: { role: 'user', content: 'hello', source: 'human' } },
      { type: 'assistant/message', seq: 1, time: 2000, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'world' }] } } },
      { type: 'tool/call', seq: 2, time: 3000, data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{}' } },
      { type: 'request/context', seq: 3, time: 4000, data: { provider: 'deepseek', model: 'deepseek-chat' } },
    ] as never[])
    expect(nodes).toHaveLength(4)
    expect(nodes.map(node => node.parentId)).toEqual([null, nodes[0]?.nodeId, nodes[1]?.nodeId, nodes[2]?.nodeId])
    expect(nodes[1]?.message?.content).toBe('world')
    expect(nodes[1]?.content).toEqual([{ type: 'text', text: 'world' }])
    expect(nodes[2]?.type).toBe('tool_call')
    expect(nodes[3]?.type).toBe('model_change')
    expect(nodes[3]?.model).toBe('deepseek-chat')
  })

  it('preserves compaction replacements as append-only tree nodes', () => {
    const nodes = sessionEventsToTreeNodes([
      { type: 'user/message', seq: 4, time: 1000, data: { role: 'user', content: 'old' }, surfaceOp: 'append' },
      { type: 'assistant/message', seq: 9, time: 2000, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'summary' }] } }, surfaceOp: { op: 'replace', start: 4, end: 4 }, sourceEventSeqs: [4] },
    ] as never[])
    expect(nodes).toHaveLength(2)
    expect(nodes[0]?.type).toBe('message')
    expect(nodes[1]?.type).toBe('compaction')
    expect(nodes[1]?.parentId).toBe(nodes[0]?.nodeId)
    expect(nodes[1]?.metadata).toMatchObject({ surfaceReplacement: true, replaceStart: 4, replaceEnd: 4, sourceEventSeqs: [4] })
  })

  it('exports and replays append-only log records', async () => {
    const tree = new (await import('@deepseek-ai/dsh-pi-agent-session-tree')).SessionTree(SessionId('tree-log'))
    const first = tree.append({ role: 'user', content: 'one' })
    expect(first.ok).toBe(true)
    const records = tree.log()
    expect(records).toHaveLength(1)
    const restored = new (await import('@deepseek-ai/dsh-pi-agent-session-tree')).SessionTree(SessionId('tree-log-restored'))
    const result = restored.replay(records)
    expect(result).toEqual({ ok: true, value: { applied: 1 } })
    expect(restored.list()[0]?.message?.content).toBe('one')
    const invalid = restored.replay([
      { seq: 1, node: { ...records[0]!.node, nodeId: 'valid-second', parentId: records[0]!.node.nodeId } },
      { seq: 3, node: { ...records[0]!.node, nodeId: 'bad-third', parentId: 'valid-second' } },
    ])
    expect(invalid.ok).toBe(false)
    expect(restored.list()).toHaveLength(1)
  })

  it('replays a branched append-only node log without deleting either path', async () => {
    const tree = new (await import('@deepseek-ai/dsh-pi-agent-session-tree')).SessionTree(SessionId('tree-mixed-log'))
    const root = expectOk(tree.append({ role: 'user', content: 'root' })) as TreeNode
    const main = expectOk(tree.append({ role: 'assistant', content: 'main answer' })) as TreeNode
    expect(tree.jump(root.nodeId).ok).toBe(true)
    const alternative = expectOk(tree.append({ role: 'assistant', content: 'alternative answer' })) as TreeNode
    const records = tree.log()
    const restored = new (await import('@deepseek-ai/dsh-pi-agent-session-tree')).SessionTree(SessionId('tree-mixed-restored'))
    expect(restored.replay(records)).toEqual({ ok: true, value: { applied: 3 } })
    expect(restored.list().map(node => node.nodeId)).toEqual([root.nodeId, main.nodeId, alternative.nodeId])
    expect(restored.list().find(node => node.nodeId === main.nodeId)?.parentId).toBe(root.nodeId)
    expect(restored.list().find(node => node.nodeId === alternative.nodeId)?.parentId).toBe(root.nodeId)
  })

  it('preserves structured content and model usage metadata', async () => {
    const { ctx } = await harness()
    const agent = stubAgent('tree-content-parts')
    await runTool(ctx, agent, { operation: 'create' })
    const node = expectOk(await runTool(ctx, agent, {
      operation: 'append',
      message: { role: 'assistant', content: 'answer' },
      content: [{ type: 'text', text: 'answer' }, { type: 'reasoning', text: 'because' }],
      model: 'deepseek-chat',
      usage: { inputTokens: 4, outputTokens: 2 },
      cost: 0.001,
    })) as TreeNode
    expect(node.content).toEqual([{ type: 'text', text: 'answer' }, { type: 'reasoning', text: 'because' }])
    expect(node.model).toBe('deepseek-chat')
    expect(node.usage).toEqual({ inputTokens: 4, outputTokens: 2 })
    expect(node.cost).toBe(0.001)
    const status = expectOk(await runTool(ctx, agent, { operation: 'session' })) as { messageCount: number; tokenCount: number; cost: number }
    expect(status.messageCount).toBe(1)
    expect(status.tokenCount).toBe(6)
    expect(status.cost).toBe(0.001)
  })

  it('preserves the native event watermark in snapshots and accepts legacy snapshots', async () => {
    const tree = new (await import('@deepseek-ai/dsh-pi-agent-session-tree')).SessionTree(SessionId('tree-watermark'))
    tree.markSessionEventSeq(17)
    const snapshot = tree.snapshot()
    expect(snapshot.nativeEventSeq).toBe(17)
    const restored = new (await import('@deepseek-ai/dsh-pi-agent-session-tree')).SessionTree(SessionId('tree-watermark'), snapshot)
    expect(restored.lastSessionEventSeq()).toBe(17)
    const legacy = { ...snapshot, nativeEventSeq: undefined }
    const legacyRestored = new (await import('@deepseek-ai/dsh-pi-agent-session-tree')).SessionTree(SessionId('tree-legacy'), { ...legacy, sessionId: 'tree-legacy' })
    expect(legacyRestored.lastSessionEventSeq()).toBe(-1)
  })

  it('forwards tool-call message fields and metadata through append', async () => {
    const { ctx } = await harness()
    const agent = stubAgent('tree-tool-fields')
    await runTool(ctx, agent, { operation: 'create' })
    const node = expectOk(await runTool(ctx, agent, {
      operation: 'append',
      message: { role: 'tool', content: 'tool result', name: 'session_tree', toolCallId: 'call-1' },
      metadata: { kind: 'trace', depth: 1 },
    })) as TreeNode
    expect(node.message?.name).toBe('session_tree')
    expect(node.message?.toolCallId).toBe('call-1')
    expect(node.metadata).toEqual({ kind: 'trace', depth: 1 })
  })

  it('rejects snapshots for a foreign session and with broken parent topology', async () => {
    const { ctx } = await harness()
    const agent = stubAgent('tree-snapshot-guards')
    await runTool(ctx, agent, { operation: 'create' })

    const foreign = await runTool(ctx, agent, {
      operation: 'snapshot.load',
      snapshot: { version: 1, sessionId: 'other-session', cursor: null, activeBranch: 'main', nodes: [] },
    })
    expectError(foreign, 'INVALID_SNAPSHOT')

    const dangling = await runTool(ctx, agent, {
      operation: 'snapshot.load',
      snapshot: {
        version: 1,
        sessionId: agent.session.id,
        cursor: 'n1',
        activeBranch: 'main',
        nodes: [{ nodeId: 'n1', parentId: 'missing', branch: 'main', summary: 'orphan', createdAt: '2026-01-01T00:00:00.000Z' }],
      },
    })
    expectError(dangling, 'INVALID_SNAPSHOT')

    const cyclic = await runTool(ctx, agent, {
      operation: 'snapshot.load',
      snapshot: {
        version: 1,
        sessionId: agent.session.id,
        cursor: 'n1',
        activeBranch: 'main',
        nodes: [{ nodeId: 'n1', parentId: 'n1', branch: 'main', summary: 'loop', createdAt: '2026-01-01T00:00:00.000Z' }],
      },
    })
    expectError(cyclic, 'INVALID_SNAPSHOT')

    const inconsistentBranch = await runTool(ctx, agent, {
      operation: 'snapshot.load',
      snapshot: { version: 1, sessionId: agent.session.id, cursor: 'n1', activeBranch: 'missing', branchHeads: { main: 'n1' }, nodes: [{ nodeId: 'n1', parentId: null, branch: 'main', summary: 'node', createdAt: '2026-01-01T00:00:00.000Z' }] },
    })
    expectError(inconsistentBranch, 'INVALID_SNAPSHOT')

    const malformedParts = await runTool(ctx, agent, {
      operation: 'snapshot.load',
      snapshot: {
        version: 1,
        sessionId: agent.session.id,
        cursor: 'n1',
        activeBranch: 'main',
        nodes: [{ nodeId: 'n1', parentId: null, branch: 'main', summary: 'bad', createdAt: '2026-01-01T00:00:00.000Z', content: [{ type: 'unknown' }] }],
      },
    })
    expectError(malformedParts, 'INVALID_SNAPSHOT')
  })
})

describe('session_tree plugin surfaces', () => {
  it('keeps the live store unchanged when incremental synchronization fails', async () => {
    const { service } = await harness()
    const agent = stubAgent('tree-atomic-sync')
    agent.session.append('user/message', { role: 'user', content: 'valid' } as never, { surfaceOp: 'append' })
    const before = service.list(agent)
    agent.session.append('session-tree/cursor', { nodeId: 'missing' })
    expect(() => syncSessionTree(agent)).toThrow('NODE_NOT_FOUND')
    expect(service.list(agent).nodes.map(node => node.nodeId)).toEqual(before.nodes.map(node => node.nodeId))
  })

  it('hydrates the tree from native Harness session events on first Remote read', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('tree-native-hydrate')
    agent.session.append('user/message', { role: 'user', content: 'native history' } as never, { surfaceOp: 'append' })
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{}' } as never)
    const view = service.list(agent)
    expect(view.nodes).toHaveLength(2)
    expect(view.nodes[0]?.message?.content).toBe('native history')
    expect(view.nodes[1]?.type).toBe('tool_call')
    expect(service.jump(agent, view.nodes[0]!.nodeId).messages).toEqual([{ role: 'user', content: 'native history' }])
    agent.session.append('session-tree/branch', { nodeId: view.nodes[0]!.nodeId, branch: 'alternate' })
    agent.session.append('user/message', { role: 'user', content: 'later event' } as never, { surfaceOp: 'append' })
    const updated = service.list(agent)
    expect(updated.nodes).toHaveLength(3)
    expect(updated.nodes[1]?.parentId).toBe(updated.nodes[0]?.nodeId)
    expect(updated.nodes[1]?.type).toBe('tool_call')
    expect(updated.nodes[2]?.parentId).toBe(updated.nodes[0]?.nodeId)
    expect(updated.nodes[2]?.branch).toBe('alternate')
    const snapshot = service.list(agent)
    const custom = expectOk(await runTool(ctx, agent, { operation: 'append', message: { role: 'assistant', content: 'custom entry' } })) as { nodeId: string }
    expect(custom.nodeId).toBeDefined()
    const afterResync = service.list(agent)
    expect(afterResync.nodes.some(node => node.nodeId === custom.nodeId)).toBe(true)
    expect(afterResync.nodes.filter(node => node.message !== undefined)).toHaveLength(3)
    const mixedStatus = expectOk(await runTool(ctx, agent, { operation: 'session' })) as { messageCount: number }
    expect(mixedStatus.messageCount).toBe(3)
    agent.session.append('session-tree/snapshot', { snapshot: { version: 1, sessionId: agent.session.id, cursor: snapshot.cursor, activeBranch: snapshot.activeBranch, ...(snapshot.branchHeads !== undefined ? { branchHeads: snapshot.branchHeads } : {}), nodes: snapshot.nodes } })
    agent.session.append('session-tree/node', { node: { nodeId: 'after-snapshot', parentId: snapshot.cursor, branch: snapshot.activeBranch, summary: 'after snapshot', createdAt: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'after snapshot' } } })
    const restored = service.list(agent)
    expect(restored.nodes.some(node => node.nodeId === 'after-snapshot')).toBe(true)
  })

  it('switches Harness actual model history and grows the new branch', async () => {
    const { service } = await harness()
    const agent = stubAgent('tree-model-surface')
    agent.session.append('user/message', { role: 'user', content: 'root', source: 'human' } as never, { surfaceOp: 'append' })
    agent.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: { role: 'assistant', content: [{ type: 'text', text: 'main answer' }] },
    } as never, { surfaceOp: 'append' })

    const initial = service.list(agent)
    expect(agent.session.deriveMessages()).toHaveLength(2)
    service.jump(agent, initial.nodes[0]!.nodeId)
    expect(agent.session.deriveMessages().map(message => message.role)).toEqual(['user'])

    agent.session.append('user/message', { role: 'user', content: 'alternate prompt', source: 'human' } as never, { surfaceOp: 'append' })
    expect(agent.session.deriveMessages().map(message => message.role)).toEqual(['user', 'user'])
    const branched = service.list(agent)
    const alternative = branched.nodes.find(node => node.summary === 'alternate prompt')
    expect(alternative?.parentId).toBe(initial.nodes[0]!.nodeId)
    expect(branched.nodes.find(node => node.summary === 'main answer')).toBeDefined()
  })

  it('runs /fork and /clone from the explicitly selected node without IDs', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('tree-command-selection')
    agent.session.append('user/message', { role: 'user', content: 'root', source: 'human' } as never, { surfaceOp: 'append' })
    agent.session.append('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } } as never, { surfaceOp: 'append' })
    const before = await ctx.commands.execute(agent, '/fork', [], new AbortController().signal)
    expect(before?.result.kind).toBe('error')
    expect(before?.result.text).toContain('请先在右侧会话树选中目标节点')

    const selected = service.list(agent).nodes[0]!
    service.jump(agent, selected.nodeId)
    const forked = await ctx.commands.execute(agent, '/fork experiment', [], new AbortController().signal)
    expect(forked?.result.kind).toBe('success')
    expect(syncSessionTree(agent).activeBranch).toBe('experiment')
    expect(syncSessionTree(agent).cursor).toBe(selected.nodeId)
    // The command must synchronously re-point the model-visible surface at the
    // fork target so the next turn starts from the selected node, not the tail.
    expect(agent.session.deriveMessages().map(message => message.content)).toEqual(['root'])

    const cloned = await ctx.commands.execute(agent, '/clone', [], new AbortController().signal)
    expect(cloned?.result.kind).toBe('success')
    const payload = JSON.parse(cloned?.result.text ?? '{}') as { value?: { sessionId?: string } }
    expect(payload.value?.sessionId).toMatch(/^tree-command-selection-clone-/u)
    const cloneTree = sessionTreeStoreForTest(payload.value?.sessionId ?? '')
    // A clone inherits the ENTIRE source conversation, not just the selected
    // leaf's envelope: both the root and the abandoned answer must survive.
    expect(cloneTree?.list()).toHaveLength(2)
    expect(nodeOf(cloneTree?.list() ?? [], 'answer').message?.content).toBe('answer')
    expect(cloneTree?.cursor).toBe(selected.nodeId)
    expect(cloneTree?.selectedNode).toBe(selected.nodeId)
  })

  it('grows the /fork branch as a child of the selected node, not the previous tail', async () => {
    const { ctx, service } = await harness()
    const agent = stubAgent('tree-fork-parent')
    agent.session.append('user/message', { role: 'user', content: 'root', source: 'human' } as never, { surfaceOp: 'append' })
    agent.session.append('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } } as never, { surfaceOp: 'append' })

    const selected = service.list(agent).nodes[0]!
    service.jump(agent, selected.nodeId)
    const forked = await ctx.commands.execute(agent, '/fork experiment', [], new AbortController().signal)
    expect(forked?.result.kind).toBe('success')

    agent.session.append('user/message', { role: 'user', content: 'branch prompt', source: 'human' } as never, { surfaceOp: 'append' })
    const branched = service.list(agent)
    const branchNode = branched.nodes.find(node => node.summary === 'branch prompt')
    expect(branchNode?.parentId).toBe(selected.nodeId)
    expect(branchNode?.branch).toBe('experiment')
  })

  it('clones the full source event log so the new session derives the same messages', async () => {
    const { ctx, service } = await harness()
    const created: Array<{ sessionId: string; seed: readonly SessionEvent[] }> = []
    ctx.agents.setFactory({
      createAgent: async (_ownerCtx, options) => {
        created.push({ sessionId: String(options.sessionId), seed: options.seed ?? [] })
        return { agent: stubAgent(String(options.sessionId)), dispose: () => Promise.resolve() }
      },
      resume: async () => { throw new Error('resume is unused in this test') },
    })
    const agent = stubAgent('tree-clone-content')
    agent.session.append('user/message', { id: 'm-root', role: 'user', content: [{ type: 'text', text: 'root' }], source: { kind: 'user' } } as never, { surfaceOp: 'append' })
    agent.session.append('assistant/message', { turn: 1, step: 1, message: { id: 'm-answer', role: 'assistant', content: [{ type: 'text', text: 'answer' }], source: { kind: 'model', provider: 'p', model: 'm' } } } as never, { surfaceOp: 'append' })

    const selected = service.list(agent).nodes[0]!
    service.jump(agent, selected.nodeId)
    const cloned = await ctx.commands.execute(agent, '/clone', [], new AbortController().signal)
    expect(cloned?.result.kind).toBe('success')
    expect(created).toHaveLength(1)

    const replayed = Session.create(SessionId('tree-clone-replay'), created[0]!.seed)
    const texts = replayed.deriveMessages().map(message =>
      (message.content as Array<{ type?: string; text?: string }>).map(block => block.text ?? '').join(''),
    )
    expect(texts).toEqual(['root', 'answer'])
  })

  it('registers the tool, the /tree command, and the system-prompt section', async () => {
    const { ctx, fiber } = await harness()
    const agent = stubAgent('tree-surfaces')
    expect(ctx.tools.get('session_tree')?.name).toBe('session_tree')
    expect(ctx.commands.find(agent, 'tree')?.name).toBe('tree')
    expect(ctx.commands.find(agent, 'fork')?.name).toBe('fork')
    expect(ctx.commands.find(agent, 'clone')?.name).toBe('clone')
    expect(ctx.commands.find(agent, 'session')?.name).toBe('session')
    const section = (await ctx.systemPrompt.assemble()).sections.find(item => item.name === 'plugin:pi_agent_session_tree')
    expect(section?.text).toContain('durable Harness Session log')
    expect(section?.text).toContain('never duplicate ordinary turns')
    await fiber.dispose()
    expect(ctx.tools.get('session_tree')).toBeUndefined()
  })
})

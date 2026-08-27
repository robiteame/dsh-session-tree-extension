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
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionTreeService from '@deepseek-ai/dsh-pi-agent-session-tree'
import type { SessionTreeSnapshot, TreeNode } from '@deepseek-ai/dsh-pi-agent-session-tree'
import * as toolSessionTree from '@deepseek-ai/dsh-tool-session-tree'

const testToolSignal = new AbortController().signal

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
  const service = await ctx.plugin(SessionTreeService)
  const fiber = await ctx.plugin(toolSessionTree)
  return { ctx, fiber, service }
}

/** Execute one registered tool on behalf of an agent and parse its JSON text. */
async function runTool(ctx: Context, agent: Agent, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result: ToolExecutionResult = await ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${Math.random()}`),
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

    const branches = expectOk(await runTool(ctx, agent, { operation: 'branches' })) as Array<{ name: string; nodeIds: string[] }>
    expect(branches.map(branch => branch.name).sort()).toEqual(['alt', 'main', 'second-alt'])
    expect(branches.find(branch => branch.name === 'alt')?.nodeIds).toContain(altNode.nodeId)
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
    const unknownOp = await runTool(ctx, alpha, { operation: 'nope' })
    expectError(unknownOp, 'INVALID_ARGUMENT')
  })
})

describe('session_tree plugin surfaces', () => {
  it('registers the tool, the /tree command, and the system-prompt section', async () => {
    const { ctx, fiber } = await harness()
    const agent = stubAgent('tree-surfaces')
    expect(ctx.tools.get('session_tree')?.name).toBe('session_tree')
    expect(ctx.commands.find(agent, 'tree')?.name).toBe('tree')
    const section = (await ctx.systemPrompt.assemble()).sections.find(item => item.name === 'plugin:pi_agent_session_tree')
    expect(section?.text).toContain('sole conversation history')
    await fiber.dispose()
    expect(ctx.tools.get('session_tree')).toBeUndefined()
  })
})

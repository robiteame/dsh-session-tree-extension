/**
 * Model-facing tool and slash-command companion of the session-tree service:
 * the `session_tree` tool, the `/tree` command family, and a system-prompt
 * section. All state lives in the shared `sessionTreeStore` from
 * `@deepseek-ai/dsh-pi-agent-session-tree`, so the model, the command line,
 * and the browser panel observe the same trees.
 *
 * Design notes
 * - Harness Session events remain the durable history source. The prompt tells
 *   the model to read the active branch with `context`, never duplicate native
 *   turns with `append`, and never edit historical nodes.
 * - Every operation returns the standard `{ok, value}|{ok:false,error}` JSON
 *   envelope; a thrown body also settles as that envelope, so tool results
 *   are always lossless JSON.
 *
 * @module @deepseek-ai/dsh-tool-session-tree
 */

import type { Context } from '@deepseek-ai/cordis'
import { SessionId as toSessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { applyTreeCursorToSession, SessionTree, sessionTreeStore, syncSessionTree } from '@deepseek-ai/dsh-pi-agent-session-tree'
import type { JsonValue } from '@deepseek-ai/dsh-pi-agent-session-tree'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'tool-session-tree'
export const inject = ['tools', 'systemPrompt', 'commands', 'agents']

/** System-prompt fragment steering the agent to the tree as its only history. */
export const SESSION_TREE_PROMPT = 'SessionTree is the append-only projection of this agent\'s durable Harness Session log. Native user, assistant, tool, and model-context events are synchronized automatically: never duplicate ordinary turns with operation \'append\'. Before answering after navigation, call session_tree with operation \'context\' and treat its root-to-cursor messages as the active branch context. Use \'append\' only for an explicit custom tree entry not already recorded by Harness. To explore an alternative, call \'fork\' or \'branch\' with a historical nodeId and branch name (or \'branch.summary\' to record a summary); old nodes are never modified or deleted. Use \'branches\' and \'tree\' to inspect topology, and \'snapshot.save\'/\'snapshot.load\' for explicit export or full-tree restore. All operations report failures as {ok:false,error:{code,message}}.'

/** Register the tool, the command family, and the prompt section. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'plugin:pi_agent_session_tree', order: 120, text: SESSION_TREE_PROMPT })

  ctx.tools.register(defineTool({
    name: 'session_tree',
    description:
      'Inspect and navigate the append-only tree projected from the durable Harness Session log. '
      + 'Native user/assistant/tool/model events synchronize automatically; use append only for an explicit custom entry, context to read the active cursor path, '
      + 'fork or branch from a historical node without deleting old history, clone the active path into an independent Harness session, and snapshot.save/snapshot.load for explicit export or restore.',
    parameters: {
      operation: { type: 'string', required: true },
      sessionId: { type: 'string' },
      nodeId: { type: 'string' },
      branch: { type: 'string' },
      summary: { type: 'string' },
      message: { type: 'json' },
      snapshot: { type: 'json' },
      metadata: { type: 'json' },
      targetSessionId: { type: 'string' },
      content: { type: 'json' },
      model: { type: 'string' },
      usage: { type: 'json' },
      cost: { type: 'number' },
      error: { type: 'string' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args: SessionTreeToolArgs, exec: ToolRunContext): Promise<JsonValue> {
      try {
        return await runToolOperation(ctx, args, exec) as JsonValue
      } catch (error) {
        return {
          ok: false,
          error: { code: 'INVALID_ARGUMENT', message: error instanceof Error ? error.message : 'invalid request' },
        }
      }
    },
  }))

  ctx.commands.register({
    name: 'tree',
    description: 'Open or refresh the right-sidebar session tree',
    handler: invocation => runTreeCommand(ctx, invocation),
  })
  ctx.commands.register({ name: 'fork', description: 'Fork the selected session-tree node', handler: invocation => runForkCommand(invocation) })
  ctx.commands.register({ name: 'clone', description: 'Clone the selected session-tree node into a new Harness session', handler: invocation => runCloneCommand(ctx, invocation) })
  ctx.commands.register({ name: 'session', description: 'Show current session tree status', handler: invocation => runSessionCommand(invocation) })
}

/** Tool argument shape (lossless JSON, validated by the tool schema). */
interface SessionTreeToolArgs {
  operation: string
  sessionId?: string
  nodeId?: string
  branch?: string
  summary?: string
  message?: JsonValue
  snapshot?: JsonValue
  metadata?: JsonValue
  targetSessionId?: string
  content?: JsonValue
  model?: string
  usage?: JsonValue
  cost?: number
  error?: string
}

async function runToolOperation(ctx: Context, args: SessionTreeToolArgs, exec: ToolRunContext): Promise<unknown> {
  if (exec.agent === undefined) {
    return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'session_tree requires an agent-backed session' } }
  }
  const sessionId = (args.sessionId ?? exec.agent.session.id) as SessionId
  const isOwnSession = sessionId === exec.agent.session.id
  if (isOwnSession) syncSessionTree(exec.agent)
  if (args.operation !== 'sessions' && args.operation !== 'clone' && !isOwnSession) {
    return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'session_tree can only modify the calling agent session' } }
  }
  if (args.operation === 'clone' && args.targetSessionId === undefined) {
    return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'targetSessionId is required' } }
  }
  switch (args.operation) {
    case 'create': {
      const tree = sessionTreeStore.get(sessionId) ?? sessionTreeStore.create(sessionId)
      return { ok: true, value: { sessionId: tree.sessionId } }
    }
    case 'sessions':
      return { ok: true, value: sessionTreeStore.list() }
    case 'clone': {
      if (args.targetSessionId === undefined) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'targetSessionId is required' } }
      if (sessionId !== exec.agent.session.id) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'clone must target the calling agent session' } }
      return cloneActiveSession(ctx, exec.agent, args.targetSessionId)
    }
    case 'snapshot.load': {
      if (args.snapshot === undefined) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'snapshot is required' } }
      }
      const snapshot = args.snapshot as unknown as Parameters<typeof sessionTreeStore.load>[0]
      if (snapshot.sessionId !== sessionId) {
        return { ok: false, error: { code: 'INVALID_SNAPSHOT', message: `snapshot session '${snapshot.sessionId}' does not match the calling session '${sessionId}'` } }
      }
      if (sessionId !== exec.agent.session.id) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'snapshot.load requires the calling agent session' } }
      const candidate = newSessionTreeFromSnapshot(sessionId, snapshot)
      if (!candidate.ok) return { ok: false, error: { code: 'INVALID_SNAPSHOT', message: candidate.error } }
      const event = exec.agent.session.append('session-tree/snapshot', { snapshot })
      candidate.value.markSessionEventSeq(event.seq)
      sessionTreeStore.replace(sessionId, candidate.value)
      return { ok: true, value: { sessionId } }
    }
    default:
      break
  }
  const required = sessionTreeStore.require(sessionId)
  if (!required.ok) return required
  const tree = required.value
  switch (args.operation) {
    case 'append': {
      if (args.message === undefined) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'message is required' } }
      }
      const request = args.message as { role?: string; content?: string; name?: string; toolCallId?: string }
      if (typeof request.role !== 'string' || typeof request.content !== 'string') {
        return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'message.role and message.content are required' } }
      }
      const checkpoint = tree.checkpoint()
      const appended = tree.append(
        {
          role: request.role as 'system' | 'user' | 'assistant' | 'tool',
          content: request.content,
          ...(request.name === undefined ? {} : { name: request.name }),
          ...(request.toolCallId === undefined ? {} : { toolCallId: request.toolCallId }),
        },
        {
          ...(args.branch === undefined ? {} : { branch: args.branch }),
          ...(args.summary === undefined ? {} : { summary: args.summary }),
          ...(args.metadata === undefined ? {} : { metadata: args.metadata as Record<string, JsonValue> }),
          ...(args.content === undefined ? {} : { content: args.content as never }),
          ...(args.model === undefined ? {} : { model: args.model }),
          ...(args.usage === undefined ? {} : { usage: args.usage as Record<string, JsonValue> }),
          ...(args.cost === undefined ? {} : { cost: args.cost }),
          ...(args.error === undefined ? {} : { error: args.error }),
        },
      )
      if (appended.ok && sessionId === exec.agent.session.id) {
        try {
          const event = exec.agent.session.append('session-tree/node', { node: appended.value })
          tree.markSessionEventSeq(event.seq)
        } catch (error) {
          tree.rollback(checkpoint)
          throw error
        }
      }
      return appended
    }
    case 'list':
      return { ok: true, value: tree.list() }
    case 'branches':
      return { ok: true, value: tree.branches() }
    case 'tree':
      return { ok: true, value: tree.view() }
    case 'session':
      return { ok: true, value: tree.info() }
    case 'jump': {
      const checkpoint = tree.checkpoint()
      const moved = tree.jump(args.nodeId ?? null)
      if (moved.ok && sessionId === exec.agent.session.id) {
        try {
          const event = exec.agent.session.append('session-tree/cursor', { nodeId: args.nodeId ?? null })
          tree.markSessionEventSeq(event.seq)
          if (args.nodeId != null) {
            const selected = tree.select(args.nodeId)
            if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`)
            const selection = exec.agent.session.append('session-tree/selection', { nodeId: args.nodeId })
            tree.markSessionEventSeq(selection.seq)
          }
          applyTreeCursorToSession(exec.agent, tree)
        } catch (error) {
          tree.rollback(checkpoint)
          throw error
        }
      }
      return moved
    }
    case 'fork': {
      if (args.nodeId === undefined) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'nodeId is required' } }
      const checkpoint = tree.checkpoint()
      const forked = tree.fork(args.nodeId, args.branch)
      if (forked.ok && sessionId === exec.agent.session.id) {
        try {
          const selected = tree.select(args.nodeId)
          if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`)
          const event = exec.agent.session.append('session-tree/branch', { nodeId: args.nodeId, branch: forked.value.branch })
          tree.markSessionEventSeq(event.seq)
          const selection = exec.agent.session.append('session-tree/selection', { nodeId: args.nodeId })
          tree.markSessionEventSeq(selection.seq)
          applyTreeCursorToSession(exec.agent, tree)
        } catch (error) {
          tree.rollback(checkpoint)
          throw error
        }
      }
      return forked
    }
    case 'context':
      return { ok: true, value: { cursor: tree.cursor, messages: tree.messages(args.nodeId ?? tree.cursor) } }
    case 'branch': {
      if (args.nodeId === undefined || args.branch === undefined) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'nodeId and branch are required' } }
      }
      const checkpoint = tree.checkpoint()
      const branched = tree.branch(args.nodeId, args.branch)
      if (branched.ok && sessionId === exec.agent.session.id) {
        try {
          const selected = tree.select(args.nodeId)
          if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`)
          const event = exec.agent.session.append('session-tree/branch', { nodeId: args.nodeId, branch: args.branch })
          tree.markSessionEventSeq(event.seq)
          const selection = exec.agent.session.append('session-tree/selection', { nodeId: args.nodeId })
          tree.markSessionEventSeq(selection.seq)
          applyTreeCursorToSession(exec.agent, tree)
        } catch (error) {
          tree.rollback(checkpoint)
          throw error
        }
      }
      return branched
    }
    case 'branch.summary': {
      if (args.nodeId === undefined || args.summary === undefined) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'nodeId and summary are required' } }
      }
      const checkpoint = tree.checkpoint()
      const summarized = tree.branchWithSummary(args.nodeId, args.summary)
      if (summarized.ok && sessionId === exec.agent.session.id) {
        try {
          const event = exec.agent.session.append('session-tree/node', { node: summarized.value })
          tree.markSessionEventSeq(event.seq)
        } catch (error) {
          tree.rollback(checkpoint)
          throw error
        }
      }
      return summarized
    }
    case 'snapshot.save':
      return { ok: true, value: tree.snapshot() }
    default:
      return { ok: false, error: { code: 'INVALID_ARGUMENT', message: `unknown operation '${args.operation}'` } }
  }
}

function runForkCommand(invocation: CommandInvocation): CommandResult {
  const [branch = `fork-${Date.now().toString(36)}`] = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
  const tree = syncSessionTree(invocation.agent)
  if (tree.selectedNode === null) return errorCommand('请先在右侧会话树选中目标节点')
  const checkpoint = tree.checkpoint()
  const forked = tree.fork(tree.selectedNode, branch)
  if (!forked.ok) return jsonCommand(forked)
  try {
    const selected = tree.select(forked.value.cursor)
    if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`)
    const event = invocation.agent.session.append('session-tree/branch', { nodeId: forked.value.cursor, branch: forked.value.branch })
    tree.markSessionEventSeq(event.seq)
    const selection = invocation.agent.session.append('session-tree/selection', { nodeId: forked.value.cursor })
    tree.markSessionEventSeq(selection.seq)
    applyTreeCursorToSession(invocation.agent, tree)
  } catch (error) {
    tree.rollback(checkpoint)
    throw error
  }
  return jsonCommand(forked)
}

async function cloneActiveSession(ctx: Context, agent: NonNullable<ToolRunContext['agent']>, target: string, nodeId?: string): Promise<unknown> {
  const tree = syncSessionTree(agent)
  const focusId = nodeId ?? tree.cursor
  // A clone must inherit the WHOLE conversation the source agent can see, not
  // just the tree's node envelopes. Seed the new Session from the source's
  // durable event log verbatim; the shared store then projects the identical
  // tree. Snapshot events are rewritten so their embedded sessionId matches the
  // target (otherwise a resumed clone would reject the seed as foreign).
  const seed: SessionEvent[] = agent.session.events.map((event, index) => {
    const record = JSON.parse(JSON.stringify(event)) as unknown as SessionEvent
    if (record.type === 'session-tree/snapshot') {
      record.data = { ...record.data, snapshot: { ...record.data.snapshot, sessionId: toSessionId(target) } }
    }
    record.seq = index
    return record
  })
  const seedTime = Date.now()
  seed.push({
    type: 'session-tree/cursor',
    seq: seed.length,
    time: seedTime + seed.length,
    data: { nodeId: focusId },
  })
  if (focusId !== null) {
    seed.push({
      type: 'session-tree/selection',
      seq: seed.length,
      time: seedTime + seed.length,
      data: { nodeId: focusId },
    })
  }

  seedCloneTree(toSessionId(target), tree, focusId, seed.length - 1)
  try {
    await ctx.agents.create({
      sessionId: toSessionId(target),
      seed,
      meta: { parentSession: agent.session.id, seedLength: seed.length },
      agentOptions: agent.options,
    })
  } catch (error) {
    // A tool-only host (no agent factory) is still served by the store-seeded
    // tree. Re-throw real creation failures instead of silently degrading them.
    if (!(error instanceof Error) || !error.message.includes('no agent factory registered')) {
      throw error
    }
  }
  return { ok: true, value: { sessionId: target } }
}

/** Seed the shared store for a cloned session from the source tree snapshot. */
function seedCloneTree(targetId: SessionId, source: SessionTree, focusId: string | null, nativeEventSeq: number): void {
  const snapshot = source.snapshot()
  const focusNode = focusId === null ? undefined : snapshot.nodes.find(node => node.nodeId === focusId)
  const activeBranch = focusNode?.branch ?? snapshot.activeBranch
  const branchHeads = { ...snapshot.branchHeads }
  if (focusNode !== undefined) branchHeads[focusNode.branch] = focusNode.nodeId
  sessionTreeStore.replace(targetId, new SessionTree(targetId, {
    version: 1,
    sessionId: targetId,
    cursor: focusId,
    activeBranch,
    ...(focusId === null && Object.keys(branchHeads).length === 0 ? {} : { branchHeads }),
    selectedNodeId: focusId,
    nativeEventSeq,
    nodes: snapshot.nodes,
  }))
}

/** Validate and construct a restored tree without throwing. */
function newSessionTreeFromSnapshot(
  sessionId: SessionId,
  snapshot: unknown,
): { ok: true; value: SessionTree } | { ok: false; error: string } {
  try {
    return { ok: true, value: new SessionTree(sessionId, snapshot) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid snapshot' }
  }
}

async function runCloneCommand(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const tree = syncSessionTree(invocation.agent)
  if (tree.selectedNode === null) return errorCommand('请先在右侧会话树选中目标节点')
  const target = `${invocation.agent.session.id}-clone-${Date.now().toString(36)}`
  try {
    return jsonCommand(await cloneActiveSession(ctx, invocation.agent, target, tree.selectedNode))
  } catch (error) {
    return { kind: 'error', text: JSON.stringify({ ok: false, error: { code: 'INVALID_ARGUMENT', message: error instanceof Error ? error.message : 'clone failed' } }) }
  }
}

function runSessionCommand(invocation: CommandInvocation): CommandResult {
  return jsonCommand({ ok: true, value: syncSessionTree(invocation.agent).info() })
}

function jsonCommand(value: unknown, map?: (tree: import('@deepseek-ai/dsh-pi-agent-session-tree').SessionTree) => unknown): CommandResult {
  const result = map === undefined ? value : (value as { ok: boolean; value?: import('@deepseek-ai/dsh-pi-agent-session-tree').SessionTree }).ok
    ? map((value as { value: import('@deepseek-ai/dsh-pi-agent-session-tree').SessionTree }).value)
    : value
  const failed = typeof result === 'object' && result !== null && (result as { ok?: unknown }).ok === false
  return { kind: failed ? 'error' : 'success', text: JSON.stringify(result) }
}

function errorCommand(message: string): CommandResult {
  return { kind: 'error', text: JSON.stringify({ ok: false, error: { code: 'INVALID_ARGUMENT', message } }) }
}

async function runTreeCommand(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const parts = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
  const sessionId = invocation.agent.session.id
  const tree = syncSessionTree(invocation.agent)
  const [head, ...rest] = parts
  const action = head === 'snapshot' ? `snapshot.${rest[0] ?? ''}` : (head ?? 'list')
  // Surface domain failures (`{ok:false}`) as command errors, matching the
  // usage/parse-error paths, so callers can't mistake a failed operation for
  // a successful one.
  const json = (value: unknown): CommandResult => {
    const failed = typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false
    return { kind: failed ? 'error' : 'success', text: JSON.stringify(value) }
  }
  switch (action) {
    case 'list': return json({ ok: true, value: tree.list() })
    case 'branches': return json({ ok: true, value: tree.branches() })
    case 'tree': return json({ ok: true, value: tree.view() })
    case 'session': return json({ ok: true, value: tree.info() })
    case 'fork': {
      if (tree.selectedNode === null) return json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: '请先在右侧会话树选中目标节点' } })
      const checkpoint = tree.checkpoint()
      const result = tree.fork(tree.selectedNode, rest[0] ?? 'fork')
      if (result.ok) {
        try {
          const selected = tree.select(result.value.cursor)
          if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`)
          const event = invocation.agent.session.append('session-tree/branch', { nodeId: result.value.cursor, branch: result.value.branch })
          tree.markSessionEventSeq(event.seq)
          const selection = invocation.agent.session.append('session-tree/selection', { nodeId: result.value.cursor })
          tree.markSessionEventSeq(selection.seq)
          applyTreeCursorToSession(invocation.agent, tree)
        } catch (error) { tree.rollback(checkpoint); throw error }
      }
      return json(result)
    }
    case 'clone': {
      if (tree.selectedNode === null) return json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: '请先在右侧会话树选中目标节点' } })
      const target = rest[0] ?? `${sessionId}-clone-${Date.now().toString(36)}`
      try { return json(await cloneActiveSession(ctx, invocation.agent, target, tree.selectedNode)) }
      catch (error) { return json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: error instanceof Error ? error.message : 'clone failed' } }) }
    }
    case 'context': return json({ ok: true, value: { cursor: tree.cursor, selectedNodeId: tree.selectedNode, messages: tree.messages(tree.selectedNode ?? tree.cursor) } })
    case 'jump': {
      const nodeId = rest[0] ?? tree.selectedNode
      if (nodeId === null) return json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: '请先在右侧会话树选中目标节点' } })
      const checkpoint = tree.checkpoint()
      const result = tree.jump(nodeId)
      if (result.ok) {
        try {
          const event = invocation.agent.session.append('session-tree/cursor', { nodeId })
          tree.markSessionEventSeq(event.seq)
          const selected = tree.select(nodeId)
          if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`)
          const selection = invocation.agent.session.append('session-tree/selection', { nodeId })
          tree.markSessionEventSeq(selection.seq)
          applyTreeCursorToSession(invocation.agent, tree)
        } catch (error) { tree.rollback(checkpoint); throw error }
      }
      return json(result)
    }
    case 'branch': {
      const nodeId = tree.selectedNode ?? ''
      const branch = rest[0] ?? 'fork'
      const checkpoint = tree.checkpoint()
      const result = tree.branch(nodeId, branch)
      if (result.ok) {
        try {
          const selected = tree.select(nodeId)
          if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`)
          const event = invocation.agent.session.append('session-tree/branch', { nodeId, branch })
          tree.markSessionEventSeq(event.seq)
          const selection = invocation.agent.session.append('session-tree/selection', { nodeId })
          tree.markSessionEventSeq(selection.seq)
          applyTreeCursorToSession(invocation.agent, tree)
        } catch (error) { tree.rollback(checkpoint); throw error }
      }
      return json(result)
    }
    case 'snapshot.save': return json({ ok: true, value: tree.snapshot() })
    case 'snapshot.load': {
      // `rest` is `['load', ...jsonFragments]`; reassemble the JSON (single
      // spaces keep it valid) rather than reading only `rest[0]`, which is the
      // literal word "load".
      const raw = rest.slice(1).join(' ').trim()
      if (raw === '') {
        return { kind: 'error', text: JSON.stringify({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'snapshot JSON is required' } }) }
      }
      try {
        const snapshot = JSON.parse(raw) as Parameters<typeof sessionTreeStore.load>[0]
        if (snapshot.sessionId !== sessionId) {
          return json({ ok: false, error: { code: 'INVALID_SNAPSHOT', message: `snapshot session '${snapshot.sessionId}' does not match the calling session '${sessionId}'` } })
        }
        const candidate = new SessionTree(sessionId, snapshot)
        try {
          const event = invocation.agent.session.append('session-tree/snapshot', { snapshot })
          candidate.markSessionEventSeq(event.seq)
          sessionTreeStore.replace(sessionId, candidate)
          return json({ ok: true, value: { sessionId } })
        } catch (error) {
          throw error
        }
      } catch (error) {
        return { kind: 'error', text: JSON.stringify({ ok: false, error: { code: 'INVALID_SNAPSHOT', message: error instanceof Error ? error.message : 'invalid snapshot JSON' } }) }
      }
    }
    default:
      return {
        kind: 'error',
        text: JSON.stringify({
          ok: false,
          error: {
            code: 'INVALID_ARGUMENT',
            message: 'Usage: /tree [list|branches|tree|context|jump <nodeId>|branch <nodeId> <name>|snapshot save|snapshot load <json>]',
          },
        }),
      }
  }
}

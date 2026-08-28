/**
 * Model-facing tool and slash-command companion of the session-tree service:
 * the `session_tree` tool, the `/tree` command family, and a system-prompt
 * section. All state lives in the shared `sessionTreeStore` from
 * `@deepseek-ai/dsh-pi-agent-session-tree`, so the model, the command line,
 * and the browser panel observe the same trees.
 *
 * Design notes
 * - The tool is the agent's only conversation-history surface: the system
 *   prompt section directs the model to build context with `context` and to
 *   append each turn, and never to edit historical nodes.
 * - Every operation returns the standard `{ok, value}|{ok:false,error}` JSON
 *   envelope; a thrown body also settles as that envelope, so tool results
 *   are always lossless JSON.
 *
 * @module @deepseek-ai/dsh-tool-session-tree
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { sessionTreeStore } from '@deepseek-ai/dsh-pi-agent-session-tree'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'tool-session-tree'
export const inject = ['tools', 'systemPrompt', 'commands']

/** System-prompt fragment steering the agent to the tree as its only history. */
export const SESSION_TREE_PROMPT = 'SessionTree is the sole conversation history for this agent. Before answering, call session_tree with operation \'context\' for your active session and treat its returned messages as the complete context; never assume a linear chat history. Append every user and assistant turn with operation \'append\'. To explore an alternative, call \'branch\' with a historical nodeId and a branch name (or \'branch.summary\' to record a summary of the abandoned path), then append new messages; never modify or delete historical nodes. Use \'branches\' and \'tree\' to enumerate the conversation tree, and \'snapshot.save\'/\'snapshot.load\' to export or restore the whole tree as JSON. All operations report failures as {ok:false,error:{code,message}}.'

/** Register the tool, the command family, and the prompt section. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'plugin:pi_agent_session_tree', order: 120, text: SESSION_TREE_PROMPT })

  ctx.tools.register(defineTool({
    name: 'session_tree',
    description:
      'Manage isolated append-only conversation trees (one per agent session) and reconstruct standard LLM messages. '
      + 'Use context to read the active cursor path, append to grow the current branch, branch from any historical node to '
      + 'fork (old nodes are never modified or deleted), clone into an independent session, and snapshot.save/snapshot.load to export or restore the tree as JSON.',
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
    execute(args: SessionTreeToolArgs, exec: ToolRunContext): Promise<JsonValue> {
      try {
        return Promise.resolve(runToolOperation(args, exec) as JsonValue)
      } catch (error) {
        return Promise.resolve({
          ok: false,
          error: { code: 'INVALID_ARGUMENT', message: error instanceof Error ? error.message : 'invalid request' },
        } as unknown as JsonValue)
      }
    },
  }))

  ctx.commands.register({
    name: 'tree',
    description: 'Inspect and navigate the append-only session tree',
    input: { hint: 'list | branches | context | tree | jump <nodeId> | branch <nodeId> <name> | snapshot save|load <json>' },
    handler: invocation => runTreeCommand(invocation),
  })
  ctx.commands.register({ name: 'fork', description: 'Fork the current session tree at a historical node', input: { hint: '<nodeId> [branch]' }, handler: invocation => runForkCommand(invocation) })
  ctx.commands.register({ name: 'clone', description: 'Clone the current session tree into a new session', input: { hint: '<sessionId>' }, handler: invocation => runCloneCommand(invocation) })
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

function runToolOperation(args: SessionTreeToolArgs, exec: ToolRunContext): unknown {
  if (exec.agent === undefined) {
    return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'session_tree requires an agent-backed session' } }
  }
  const sessionId = (args.sessionId ?? exec.agent.session.id) as SessionId
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
      return sessionTreeStore.clone(sessionId, args.targetSessionId as SessionId)
    }
    case 'snapshot.load': {
      if (args.snapshot === undefined) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'snapshot is required' } }
      }
      const snapshot = args.snapshot as unknown as Parameters<typeof sessionTreeStore.load>[0]
      if (snapshot.sessionId !== sessionId) {
        return { ok: false, error: { code: 'INVALID_SNAPSHOT', message: `snapshot session '${snapshot.sessionId}' does not match the calling session '${sessionId}'` } }
      }
      return sessionTreeStore.load(snapshot)
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
      return tree.append(
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
    }
    case 'list':
      return { ok: true, value: tree.list() }
    case 'branches':
      return { ok: true, value: tree.branches() }
    case 'tree':
      return { ok: true, value: tree.view() }
    case 'session':
      return { ok: true, value: tree.info() }
    case 'jump':
      return tree.jump(args.nodeId ?? null)
    case 'fork': {
      if (args.nodeId === undefined) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'nodeId is required' } }
      return tree.fork(args.nodeId, args.branch)
    }
    case 'context':
      return { ok: true, value: { cursor: tree.cursor, messages: tree.messages(args.nodeId ?? tree.cursor) } }
    case 'branch': {
      if (args.nodeId === undefined || args.branch === undefined) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'nodeId and branch are required' } }
      }
      return tree.branch(args.nodeId, args.branch)
    }
    case 'branch.summary': {
      if (args.nodeId === undefined || args.summary === undefined) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'nodeId and summary are required' } }
      }
      return tree.branchWithSummary(args.nodeId, args.summary)
    }
    case 'snapshot.save':
      return { ok: true, value: tree.snapshot() }
    default:
      return { ok: false, error: { code: 'INVALID_ARGUMENT', message: `unknown operation '${args.operation}'` } }
  }
}

function runForkCommand(invocation: CommandInvocation): CommandResult {
  const [nodeId, branch = 'fork'] = invocation.rawInput.trim().split(/\s+/u)
  return jsonCommand(sessionTreeStore.require(invocation.agent.session.id), tree => tree.fork(nodeId ?? '', branch))
}

function runCloneCommand(invocation: CommandInvocation): CommandResult {
  const target = invocation.rawInput.trim()
  return target === '' ? errorCommand('targetSessionId is required') : jsonCommand(sessionTreeStore.clone(invocation.agent.session.id, target as SessionId))
}

function runSessionCommand(invocation: CommandInvocation): CommandResult {
  return jsonCommand(sessionTreeStore.require(invocation.agent.session.id), tree => tree.info())
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

function runTreeCommand(invocation: CommandInvocation): CommandResult {
  const parts = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
  const sessionId = invocation.agent.session.id
  const tree = sessionTreeStore.get(sessionId) ?? sessionTreeStore.create(sessionId)
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
    case 'fork': return json(tree.fork(rest[0] ?? '', rest[1] ?? 'fork'))
    case 'clone': {
      const target = rest[0]
      if (target === undefined) return json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'targetSessionId is required' } })
      return json(sessionTreeStore.clone(sessionId, target as SessionId))
    }
    case 'context': return json({ ok: true, value: { cursor: tree.cursor, messages: tree.messages() } })
    case 'jump': {
      const result = tree.jump(rest[0] ?? null)
      return json(result)
    }
    case 'branch': {
      const result = tree.branch(rest[0] ?? '', rest[1] ?? '')
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
        const result = sessionTreeStore.load(snapshot)
        return json(result)
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

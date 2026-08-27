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
      + 'fork (old nodes are never modified or deleted), and snapshot.save/snapshot.load to export or restore the tree as JSON.',
    parameters: {
      operation: { type: 'string', required: true },
      sessionId: { type: 'string' },
      nodeId: { type: 'string' },
      branch: { type: 'string' },
      summary: { type: 'string' },
      message: { type: 'json' },
      snapshot: { type: 'json' },
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
}

function runToolOperation(args: SessionTreeToolArgs, exec: ToolRunContext): unknown {
  if (exec.agent === undefined) {
    return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'session_tree requires an agent-backed session' } }
  }
  const sessionId = (args.sessionId ?? exec.agent.session.id) as SessionId
  switch (args.operation) {
    case 'create': {
      const tree = sessionTreeStore.get(sessionId) ?? sessionTreeStore.create(sessionId)
      return { ok: true, value: { sessionId: tree.sessionId } }
    }
    case 'sessions':
      return { ok: true, value: sessionTreeStore.list() }
    case 'snapshot.load': {
      if (args.snapshot === undefined) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'snapshot is required' } }
      }
      return sessionTreeStore.load(args.snapshot as unknown as Parameters<typeof sessionTreeStore.load>[0])
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
      const request = args.message as { role?: string; content?: string; branch?: string; summary?: string }
      if (typeof request.role !== 'string' || typeof request.content !== 'string') {
        return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'message.role and message.content are required' } }
      }
      return tree.append(
        { role: request.role as 'system' | 'user' | 'assistant' | 'tool', content: request.content },
        {
          ...(args.branch === undefined ? {} : { branch: args.branch }),
          ...(args.summary === undefined ? {} : { summary: args.summary }),
        },
      )
    }
    case 'list':
      return { ok: true, value: tree.list() }
    case 'branches':
      return { ok: true, value: tree.branches() }
    case 'tree':
      return { ok: true, value: tree.view() }
    case 'jump':
      return tree.jump(args.nodeId ?? null)
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

function runTreeCommand(invocation: CommandInvocation): CommandResult {
  const parts = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
  const sessionId = invocation.agent.session.id
  const tree = sessionTreeStore.get(sessionId) ?? sessionTreeStore.create(sessionId)
  const [head, ...rest] = parts
  const action = head === 'snapshot' ? `snapshot.${rest[0] ?? ''}` : (head ?? 'list')
  const json = (value: unknown): CommandResult => ({ kind: 'success', text: JSON.stringify(value) })
  switch (action) {
    case 'list': return json({ ok: true, value: tree.list() })
    case 'branches': return json({ ok: true, value: tree.branches() })
    case 'tree': return json({ ok: true, value: tree.view() })
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
      const raw = rest[0]
      if (raw === undefined) {
        return { kind: 'error', text: JSON.stringify({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'snapshot JSON is required' } }) }
      }
      try {
        const snapshot = JSON.parse(raw) as Parameters<typeof sessionTreeStore.load>[0]
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

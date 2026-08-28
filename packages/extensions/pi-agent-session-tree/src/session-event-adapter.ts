/**
 * Pure projection between Harness SessionEvent logs and SessionTree nodes.
 * This module does not subscribe to a live Session or persistence service: the
 * host integration can feed it immutable `session.events` snapshots, while
 * preserving the Session log as the durable source of truth.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ContentPart, JsonValue, LlmMessage, TreeNode } from './types.ts'

/** Project the message-producing Harness events into an append-only tree. */
export function sessionEventsToTreeNodes(events: readonly SessionEvent[]): TreeNode[] {
  const nodes: TreeNode[] = []
  let parentId: string | null = null
  for (const event of events) {
    const projected = projectEvent(event, parentId)
    if (projected === undefined) continue
    nodes.push(projected)
    parentId = projected.nodeId
  }
  return nodes
}

function projectEvent(event: SessionEvent, parentId: string | null): TreeNode | undefined {
  let message: LlmMessage | undefined
  let content: ContentPart[] | undefined
  let type: TreeNode['type'] = 'custom'
  let summary = event.type
  let usage: Record<string, JsonValue> | undefined
  let model: string | undefined
  let metadata: Record<string, JsonValue> = { sessionEventType: event.type, sessionEventSeq: event.seq }

  if (event.type === 'user/message') {
    type = 'message'
    message = { role: 'user', content: textOf(event.data.content) }
    content = [{ type: 'text', text: message.content }]
    summary = message.content
  } else if (event.type === 'assistant/message') {
    type = 'message'
    message = { role: 'assistant', content: textOf(event.data.message.content) }
    content = [{ type: 'text', text: message.content }]
    summary = message.content
    if (event.data.usage !== undefined) usage = event.data.usage as unknown as Record<string, JsonValue>
    if (event.data.interrupted === true) metadata = { ...metadata, interrupted: true }
  } else if (event.type === 'tool/call') {
    type = 'tool_call'
    const args = parseJson(event.data.arguments)
    content = [{ type: 'tool_call', id: String(event.data.callId), name: event.data.name, arguments: args }]
    summary = `${event.data.name}(${event.data.arguments})`
  } else if (event.type === 'request/context') {
    type = 'model_change'
    model = event.data.model
    summary = `model: ${event.data.provider}/${event.data.model}`
    content = [{ type: 'text', text: summary }]
  } else if (event.type === 'tool/result') {
    type = 'tool_result'
    message = { role: 'tool', content: textOf(event.data.message.content), toolCallId: String(event.data.message.toolCallId) }
    content = [{ type: 'tool_result', toolCallId: String(event.data.message.toolCallId), content: message.content }]
    summary = message.content
  } else {
    return undefined
  }

  return {
    nodeId: `session-event-${event.seq}`,
    parentId,
    forkCount: 0,
    type,
    branch: 'main',
    summary: summarize(summary),
    createdAt: new Date(event.time).toISOString(),
    ...(message === undefined ? {} : { message }),
    ...(content === undefined ? {} : { content }),
    ...(model === undefined ? {} : { model }),
    ...(usage === undefined ? {} : { usage }),
    metadata,
  }
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' && item !== null && 'text' in item ? String((item as { text?: unknown }).text ?? '') : '').join('')
  return String(value ?? '')
}

function parseJson(raw: string): JsonValue {
  try { return JSON.parse(raw) as JsonValue } catch { return raw }
}

function summarize(value: string): string {
  const flat = value.replace(/\s+/gu, ' ').trim()
  return flat.length <= 120 ? flat : `${flat.slice(0, 117)}...`
}

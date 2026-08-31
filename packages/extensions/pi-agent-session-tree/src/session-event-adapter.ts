/**
 * Pure projection between Harness SessionEvent logs and SessionTree nodes.
 * This module does not subscribe to a live Session or persistence service: the
 * host integration can feed it immutable `session.events` snapshots, while
 * preserving the Session log as the durable source of truth.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ContentPart, JsonValue, LlmMessage, TreeNode } from './types.ts'

/** Project the message-producing Harness events into an append-only tree. */
export function sessionEventsToTreeNodes(events: readonly SessionEvent[], initialParentId: string | null = null): TreeNode[] {
  const nodes: TreeNode[] = []
  let parentId: string | null = initialParentId
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
  let metadata: Record<string, JsonValue> = {
    sessionEventType: event.type,
    sessionEventSeq: event.seq,
    sourceEventSeq: event.seq,
  }

  if (event.type === 'session-tree/node') {
    return { ...event.data.node, metadata: { ...event.data.node.metadata, sessionEventType: event.type, sessionEventSeq: event.seq, sourceEventSeq: event.seq } }
  } else if (event.type === 'session-tree/snapshot') {
    return undefined
  } else if (event.type === 'user/message') {
    type = 'message'
    message = { role: 'user', content: textOf(event.data.content) }
    content = partsOf(event.data.content)
    summary = message.content
  } else if (event.type === 'assistant/message') {
    type = 'message'
    message = { role: 'assistant', content: textOf(event.data.message.content) }
    content = partsOf(event.data.message.content)
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

  // Harness represents compaction as a surface replacement on a message event.
  // Keep it as an immutable tree record instead of pretending the shadowed
  // messages were deleted from the append-only tree.
  const surfaceOp = (event as { surfaceOp?: unknown }).surfaceOp
  if (typeof surfaceOp === 'object' && surfaceOp !== null && (surfaceOp as { op?: unknown }).op === 'replace') {
    const replacement = surfaceOp as { start?: unknown; end?: unknown }
    const sourceEventSeqs = (event as { sourceEventSeqs?: unknown }).sourceEventSeqs
    type = 'compaction'
    metadata = {
      ...metadata,
      surfaceReplacement: true,
      ...(typeof replacement.start === 'number' ? { replaceStart: replacement.start } : {}),
      ...(typeof replacement.end === 'number' ? { replaceEnd: replacement.end } : {}),
      sourceEventSeqs: Array.isArray(sourceEventSeqs) ? sourceEventSeqs.filter((seq): seq is number => typeof seq === 'number') : [],
    }
    summary = `compaction: ${summary}`
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

function partsOf(value: unknown): ContentPart[] {
  if (!Array.isArray(value)) return [{ type: 'text', text: textOf(value) }]
  const parts: ContentPart[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || !('type' in item)) continue
    const block = item as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string') parts.push({ type: 'text', text: block.text })
    else if (block.type === 'reasoning' && typeof block.text === 'string') parts.push({ type: 'reasoning', text: block.text })
    else if (block.type === 'tool-call' && typeof block.id === 'string' && typeof block.name === 'string' && typeof block.arguments === 'string') parts.push({ type: 'tool_call', id: block.id, name: block.name, arguments: parseJson(block.arguments) })
    else if (block.type === 'tool-result' && typeof block.toolCallId === 'string') parts.push({ type: 'tool_result', toolCallId: block.toolCallId, content: textOf(block.content), ...(typeof block.isError === 'boolean' ? { isError: block.isError } : {}) })
  }
  return parts
}

function parseJson(raw: string): JsonValue {
  try { return JSON.parse(raw) as JsonValue } catch { return raw }
}

function summarize(value: string): string {
  const flat = value.replace(/\s+/gu, ' ').trim()
  return flat.length <= 120 ? flat : `${flat.slice(0, 117)}...`
}

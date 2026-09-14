import type { TreeNode } from '@robiteame/dsh-pi-agent-session-tree/client'

/**
 * Browser-side twin of the host adapter's `isInjectedUserSource` (the client
 * outlet is type-only, so the five-line predicate is duplicated here). A
 * `user/message` source with an object shape whose `kind` is not `'user'`
 * marks harness-injected context — skill prompts, system-prompt snapshots,
 * context notices — rather than a typed human prompt.
 */
export function isInjectedUserSource(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false
  const kind = (source as { kind?: unknown }).kind
  return typeof kind === 'string' && kind !== 'user'
}

/** Whether one tree node records harness-injected context instead of a typed human prompt. */
export function isInjectedUserNode(node: TreeNode): boolean {
  return node.metadata?.injected === true
}

/** Resolve the complete user-visible text for one session-tree node. */
export function nodeFullText(node: TreeNode): string {
  const parts = node.content
  if (parts === undefined || parts.length === 0) return node.message?.content ?? node.summary

  const lines: string[] = []
  for (const part of parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      if (part.text !== '') lines.push(part.text)
    } else if (part.type === 'tool_call') {
      lines.push(`${part.name}(${typeof part.arguments === 'string' ? part.arguments : JSON.stringify(part.arguments)})`)
    } else if (part.type === 'tool_result') {
      if (part.content !== '') lines.push(part.content)
    }
  }

  const text = lines.join('\n')
  return text === '' ? node.message?.content ?? node.summary : text
}

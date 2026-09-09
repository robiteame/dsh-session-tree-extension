import type { TreeNode } from '@robiteame/dsh-pi-agent-session-tree/client'

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

/** Marker carried by official surface events written by stock-mode tree jumps. */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

export interface SessionTreeRestoreMarker {
  readonly kind: 'cursor'
  readonly nodeId: string | null
}

/**
 * Read the plugin marker from an event's JSON data. Native Harness events
 * never carry this key, so its presence is unambiguous.
 */
export function sessionTreeMarkerOf(event: SessionEvent): SessionTreeRestoreMarker | undefined {
  const data = event.data as Record<string, unknown>
  const marker = data.treeRestore
  if (typeof marker !== 'object' || marker === null) return undefined
  const candidate = marker as Partial<SessionTreeRestoreMarker>
  if (candidate.kind !== 'cursor') return undefined
  if (candidate.nodeId !== null && typeof candidate.nodeId !== 'string') return undefined
  return { kind: 'cursor', nodeId: candidate.nodeId }
}

/** Whether one event is a synthetic cursor rewrite rather than conversation content. */
export function isSessionTreeRestoreEvent(event: SessionEvent): boolean {
  return sessionTreeMarkerOf(event) !== undefined
}

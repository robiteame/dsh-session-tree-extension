/**
 * Session-tree domain service: the append-only multi-branch conversation
 * tree, one per agent session, served to the browser through the generated
 * `sessionTree` Remote namespace.
 *
 * Design notes
 * - A process-wide store keeps every session's tree; the companion
 *   `@deepseek-ai/dsh-tool-session-tree` plugin shares the same store, so
 *   anything the model appends is immediately visible to the browser panel
 *   and vice versa.
 * - Harness Session events are the durable source of truth; the process-wide
 *   store is an incrementally synchronized projection, while explicit snapshots
 *   remain available for export and full-tree restore.
 * - Every operation answers `{ok, value}|{ok:false,error}` from the domain
 *   layer; the Remote boundary adds its own transport envelope.
 *
 * @module @deepseek-ai/dsh-pi-agent-session-tree
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { SessionTree, sessionTreeStore } from './session-tree.ts'
import { sessionEventsToTreeNodes } from './session-event-adapter.ts'
import type { JumpView, SessionTreeSessionInfo, SessionTreeView } from './types.ts'

export { SessionTree, SessionTreeStore, sessionTreeStore } from './session-tree.ts'
export type * from './types.ts'
export { sessionEventsToTreeNodes } from './session-event-adapter.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionTree: SessionTreeService
  }
}

/** Materialize and incrementally synchronize native Harness history. */
export function syncSessionTree(agent: Agent): SessionTree {
  const sessionId = agent.session.id
  const existing = sessionTreeStore.get(sessionId)
  let tree = existing === undefined ? new SessionTree(sessionId) : new SessionTree(sessionId, existing.snapshot())
  const lastSeq = existing?.lastSessionEventSeq() ?? -1
  const surfaceSeqs = new Set(agent.session.surface.nodes)
  const freshEvents = agent.session.events.filter(event => event.seq > lastSeq)
  let nativeParentId = tree.cursor
  for (const event of freshEvents) {
    if (event.type === 'session-tree/snapshot') {
      if (event.data.snapshot.sessionId !== sessionId) throw new Error('INVALID_SNAPSHOT: snapshot session does not match the owning Session')
      try {
        tree = new SessionTree(sessionId, event.data.snapshot)
      } catch (error) {
        throw new Error(`INVALID_SNAPSHOT: ${error instanceof Error ? error.message : 'invalid snapshot'}`)
      }
      tree.markSessionEventSeq(event.seq)
      nativeParentId = tree.cursor
      continue
    }
    if (event.type === 'session-tree/cursor') {
      const moved = tree.jump(event.data.nodeId)
      if (!moved.ok) throw new Error(`${moved.error.code}: ${moved.error.message}`)
      nativeParentId = event.data.nodeId
      continue
    }
    if (event.type === 'session-tree/branch') {
      const branched = tree.branch(event.data.nodeId, event.data.branch)
      if (!branched.ok) throw new Error(`${branched.error.code}: ${branched.error.message}`)
      nativeParentId = event.data.nodeId
      continue
    }
    // Explicit session-tree nodes are durable tree records, not model-surface
    // events; they must be projected even though they are absent from surface.
    const isExplicitTreeNode = event.type === 'session-tree/node'
    const isTreeMetadataEvent = event.type === 'tool/call' || event.type === 'request/context'
    if (!isExplicitTreeNode && !isTreeMetadataEvent && !surfaceSeqs.has(event.seq)) continue
    const nodes = sessionEventsToTreeNodes([event], nativeParentId)
    if (nodes.length === 0) continue
    const restored = tree.replay([{ seq: tree.list().length, node: nodes[0]! }])
    if (!restored.ok) throw new Error(`${restored.error.code}: ${restored.error.message}`)
    nativeParentId = nodes[0]!.nodeId
  }
  const newestSeq = freshEvents[freshEvents.length - 1]?.seq
  if (newestSeq !== undefined) tree.markSessionEventSeq(newestSeq)
  sessionTreeStore.replace(sessionId, tree)
  return tree
}

/** Remote-only service backing the browser tree panel. */
export class SessionTreeService extends TypertRemoteService {
  /**
   * Register the service under `sessionTree`.
   * @param ctx - owning Cordis Context.
   */
  constructor(ctx: Context) {
    super(ctx, 'sessionTree')
  }

  /**
   * Read the current tree view (nodes, branches, cursor) for one agent.
   * The tree is created on first read, so an empty panel is valid.
   * @param agent - owning live agent.
   * @returns the complete view for the panel.
   */
  @Remote('list')
  list(agent: Agent): SessionTreeView {
    return syncSessionTree(agent).view()
  }

  /**
   * Move the SessionTree cursor to an existing node and return its root-to-node
   * path through the context operation. This updates tree navigation state; it
   * does not mutate Harness' native model surface because Agent.inject() only
   * queues additional context for a future step.
   * @param agent - owning live agent.
   * @param nodeId - target node, or null to reset before the first node.
   * @returns the new cursor and reconstructed messages.
   * @throws Error when the node does not exist (settles as the standard error envelope).
   */
  @Remote('jump')
  jump(agent: Agent, nodeId: string | null): JumpView {
    const tree = syncSessionTree(agent)
    const checkpoint = tree.checkpoint()
    const result = tree.jump(nodeId)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    try {
      const event = agent.session.append('session-tree/cursor', { nodeId })
      tree.markSessionEventSeq(event.seq)
    } catch (error) {
      tree.rollback(checkpoint)
      throw error
    }
    return result.value
  }

  /** Position a named branch at a historical node for the next append. */
  @Remote('fork')
  fork(agent: Agent, nodeId: string, branch = 'fork'): { cursor: string; branch: string; forkCount: number } {
    const tree = syncSessionTree(agent)
    const checkpoint = tree.checkpoint()
    const result = tree.fork(nodeId, branch)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    try {
      const event = agent.session.append('session-tree/branch', { nodeId, branch: result.value.branch })
      tree.markSessionEventSeq(event.seq)
    } catch (error) {
      tree.rollback(checkpoint)
      throw error
    }
    return result.value
  }

  /** Read compact status metadata for the current session tree. */
  @Remote('session')
  session(agent: Agent): SessionTreeSessionInfo {
    return syncSessionTree(agent).info()
  }
}

export default SessionTreeService

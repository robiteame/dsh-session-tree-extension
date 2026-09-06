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
import type { Session } from '@deepseek-ai/dsh-session'
import { isSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session/types'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { SessionTree, sessionTreeStore } from './session-tree.ts'
import { sessionEventsToTreeNodes } from './session-event-adapter.ts'
import { getSessionTreeSidecar, persistSessionTree } from './session-tree-sidecar.ts'
import type { JumpView, SessionTreeSessionInfo, SessionTreeView } from './types.ts'

export { SessionTree, SessionTreeStore, sessionTreeStore } from './session-tree.ts'
export type * from './types.ts'
export { sessionEventsToTreeNodes } from './session-event-adapter.ts'
export { getSessionTreeSidecar, persistSessionTree, setSessionTreeSidecar, SessionTreeSidecar } from './session-tree-sidecar.ts'
export { isSessionTreeRestoreEvent, sessionTreeMarkerOf, type SessionTreeRestoreMarker } from './session-tree-marker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionTree: SessionTreeService
  }
}

/** Selected-message-surface API added by the repository's optional harness.patch. */
interface SelectedMessageSurfaceSession {
  selectMessageSurface(nodes: readonly number[] | null): void
  messageSurfaceNodes(): readonly number[]
}

/**
 * Whether a live Session exposes the selected-message-surface API shipped by
 * this repository's `harness.patch`. A stock DeepSeek-Harness install (the
 * target of `dsh plugin add`) has no such API: `deriveMessages()` always walks
 * the canonical surface, and unknown `session-tree/*` events cannot be marked
 * `ignorable` through the public append API, so a profile cannot persist them.
 * The tree remains fully browsable and branchable inside the process store in
 * that mode; only the in-place model-surface switch is unavailable.
 */
export function supportsSelectedMessageSurface(
  session: Session,
): session is Session & SelectedMessageSurfaceSession {
  const candidate = session as Partial<SelectedMessageSurfaceSession>
  return typeof candidate.selectMessageSurface === 'function'
    && typeof candidate.messageSurfaceNodes === 'function'
}

/**
 * Whether the running Harness recognizes the durable `session-tree/*` event
 * vocabulary. The event names are registered in the session known-event-types
 * table by `harness.patch`; on stock packages an appended unknown event would
 * make a resumed persisted log unreadable, so callers must skip those appends.
 */
export function supportsDurableSessionTreeEvents(session: Session): boolean {
  return supportsSelectedMessageSurface(session)
}

/** Durable SessionTree event types appended to the owning Session log. */
export type SessionTreeEventType =
  | 'session-tree/node'
  | 'session-tree/cursor'
  | 'session-tree/branch'
  | 'session-tree/selection'
  | 'session-tree/snapshot'

/**
 * Append one durable SessionTree marker when the runtime supports it, and
 * return undefined on stock Harness so callers can skip sequence tracking.
 */
export function appendSessionTreeEvent(
  session: Session,
  type: SessionTreeEventType,
  data: SessionEventMap[SessionTreeEventType],
): SessionEvent<SessionTreeEventType> | undefined {
  if (!supportsDurableSessionTreeEvents(session)) return undefined
  return session.append(type, data)
}

/** Materialize and incrementally synchronize native Harness history. */
export function syncSessionTree(agent: Agent): SessionTree {
  const sessionId = agent.session.id
  const existing = sessionTreeStore.get(sessionId)
  const restored = existing === undefined ? getSessionTreeSidecar().load(sessionId) : undefined
  let tree = existing === undefined
    ? restored ?? new SessionTree(sessionId)
    : new SessionTree(sessionId, existing.snapshot())
  const actualLatestSeq = agent.session.events.at(-1)?.seq ?? -1
  tree.limitSessionEventSeq(actualLatestSeq)
  const lastSeq = tree.lastSessionEventSeq()
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
    if (event.type === 'session-tree/selection') {
      const selected = tree.select(event.data.nodeId)
      if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`)
      continue
    }
    // Explicit session-tree nodes are durable tree records, not model-surface
    // events; they must be projected even though they are absent from surface.
    const isExplicitTreeNode = event.type === 'session-tree/node'
    const isTreeMetadataEvent = event.type === 'tool/call' || event.type === 'request/context'
    // Keep every append-origin and replacement surface event, including nodes
    // shadowed by compaction. Pi's tree is the immutable history graph, not the
    // current flattened model surface.
    if (!isExplicitTreeNode && !isTreeMetadataEvent && !isSurfaceEvent(event)) continue
    const nodes = sessionEventsToTreeNodes([event], nativeParentId)
    if (nodes.length === 0) continue
    const first = nodes[0]
    if (first === undefined) continue
    const projected = isExplicitTreeNode ? first : { ...first, branch: tree.activeBranch }
    const restored = tree.replay([{ seq: tree.list().length, node: projected }])
    if (!restored.ok) throw new Error(`${restored.error.code}: ${restored.error.message}`)
    nativeParentId = projected.nodeId
  }
  const newestSeq = freshEvents[freshEvents.length - 1]?.seq
  if (newestSeq !== undefined) tree.markSessionEventSeq(newestSeq)
  sessionTreeStore.replace(sessionId, tree)
  applyTreeCursorToSession(agent, tree)
  persistSessionTree(tree)
  return tree
}

/** Surface event seqs making up the tree's current root-to-cursor path. */
function selectedSurfaceSeqs(tree: SessionTree, session: Session): number[] {
  const seqs: number[] = []
  for (const node of tree.currentPath()) {
    const seq = node.metadata?.sessionEventSeq
    if (typeof seq !== 'number') continue
    const event = session.events[seq]
    if (event !== undefined && isSurfaceEvent(event)) seqs.push(seq)
  }
  return seqs
}

/** Append the official replacement event that invalidates the stock deriveMessages cache. */
function appendStockCursorEvent(
  session: Session,
  tree: SessionTree,
  currentNodes: readonly number[],
): SessionEvent<'assistant/message'> | undefined {
  if (currentNodes.length === 0) return undefined
  const context = session.requestContext()
  const marker = { kind: 'cursor' as const, nodeId: tree.cursor }
  const data = {
    turn: 0,
    step: 0,
    message: {
      role: 'assistant' as const,
      content: [],
      id: `session-tree-cursor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      source: {
        kind: 'model' as const,
        provider: context?.provider ?? 'session-tree',
        model: context?.model ?? 'cursor',
      },
    },
    treeRestore: marker,
  } as unknown as SessionEventMap['assistant/message']
  return session.append('assistant/message', data, {
    surfaceOp: { op: 'replace', start: currentNodes[0]!, end: currentNodes[currentNodes.length - 1]! },
    sourceEventSeqs: [...currentNodes],
  })
}

/** Rewrite the live stock surface nodes after the replacement generation bump. */
function setStockSurfaceNodes(session: Session, seqs: readonly number[]): void {
  const nodes = session.surface.nodes as unknown as number[]
  if (!Array.isArray(nodes) || Object.isFrozen(nodes)) {
    throw new Error('stock Harness message surface is not writable in this revision')
  }
  nodes.splice(0, nodes.length, ...seqs)
}

/** True when the two ordered seq lists are identical. */
function sameSurfaceNodes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((seq, index) => seq === right[index])
}

/** Defensively flatten any nested seq payloads produced by older Harness surfaces. */
function normalizeSurfaceNodeSeqs(values: readonly unknown[]): number[] {
  const seqs: number[] = []
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const child of value) {
        if (Number.isSafeInteger(child)) seqs.push(child as number)
      }
    } else if (Number.isSafeInteger(value)) {
      seqs.push(value as number)
    }
  }
  return seqs
}

/** Apply the selected tree path to Harness' actual model-visible Session surface. */
export function applyTreeCursorToSession(agent: Agent, tree: SessionTree): void {
  const session = agent.session
  const seqs = selectedSurfaceSeqs(tree, session)
  if (supportsSelectedMessageSurface(session)) {
    session.selectMessageSurface(seqs)
    return
  }
  const stockSession = session as Session
  const currentNodes = normalizeSurfaceNodeSeqs(stockSession.surface.nodes)
  if (sameSurfaceNodes(currentNodes, seqs)) return
  if (process.env.DSH_SESSION_TREE_DEBUG === '1') {
    console.error('[session-tree] stock surface rewrite', { sessionId: stockSession.id, currentNodes, seqs, cursor: tree.cursor })
  }
  const event = appendStockCursorEvent(stockSession, tree, currentNodes)
  if (event !== undefined) tree.markSessionEventSeq(event.seq)
  setStockSurfaceNodes(stockSession, seqs)
  persistSessionTree(tree)
}

/** Remote-only service backing the browser tree panel. */
export class SessionTreeService extends TypertRemoteService {
  /**
   * Register the service under `sessionTree`.
   * @param ctx - owning Cordis Context.
   */
  constructor(ctx: Context) {
    super(ctx, 'sessionTree')
    // Rehydrate the durable cursor before every proposed step, including a
    // resumed Session whose browser has not opened the tree panel yet.
    ctx.on('agent/pre-step', ({ agent }, next) => {
      syncSessionTree(agent)
      return next()
    })
    ctx.on('session/flush', (session) => {
      const tree = sessionTreeStore.get(session.id)
      if (tree !== undefined) persistSessionTree(tree)
    })
  }

  /**
   * Read the current tree view (nodes, branches, cursor) for one agent.
   * The tree is created on first read, so an empty panel is valid.
   * @param agent - owning live agent.
   * @returns the complete view for the panel.
   */
  @Remote('list')
  list(agent: Agent): SessionTreeView {
    return this.synced(agent).view()
  }

  /** Synchronize native history, falling back to the last committed tree when replay fails. */
  private synced(agent: Agent): SessionTree {
    try {
      return syncSessionTree(agent)
    } catch {
      const committed = sessionTreeStore.require(agent.session.id)
      if (!committed.ok) throw new Error(`${committed.error.code}: ${committed.error.message}`)
      return committed.value
    }
  }

  /**
   * Move the SessionTree cursor to an existing node and return its root-to-node
   * path through the context operation. This also selects the same path on
   * Harness' model-visible Session surface, so the next turn genuinely branches
   * from this leaf instead of merely changing the browser projection.
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
      const event = appendSessionTreeEvent(agent.session, 'session-tree/cursor', { nodeId })
      if (event !== undefined) tree.markSessionEventSeq(event.seq)
      if (nodeId !== null) {
        const selected = tree.select(nodeId)
        if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`)
        const selection = appendSessionTreeEvent(agent.session, 'session-tree/selection', { nodeId })
        if (selection !== undefined) tree.markSessionEventSeq(selection.seq)
      }
      applyTreeCursorToSession(agent, tree)
    } catch (error) {
      tree.rollback(checkpoint)
      throw error
    }
    return result.value
  }

  /**
   * Position a named branch at a historical node for the next append.
   * @param agent - owning live agent.
   * @param nodeId - historical node to branch from.
   * @param branch - non-empty branch label.
   * @returns the parked cursor, branch label, and direct-child fork count.
   */
  @Remote('fork')
  fork(agent: Agent, nodeId: string, branch: string): { cursor: string; branch: string; forkCount: number } {
    const branchName = branch === '' ? 'fork' : branch
    const tree = syncSessionTree(agent)
    const checkpoint = tree.checkpoint()
    const result = tree.fork(nodeId, branchName)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    try {
      const selected = tree.select(nodeId)
      if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`)
      const event = appendSessionTreeEvent(agent.session, 'session-tree/branch', { nodeId, branch: result.value.branch })
      if (event !== undefined) tree.markSessionEventSeq(event.seq)
      const selection = appendSessionTreeEvent(agent.session, 'session-tree/selection', { nodeId })
      if (selection !== undefined) tree.markSessionEventSeq(selection.seq)
      applyTreeCursorToSession(agent, tree)
    } catch (error) {
      tree.rollback(checkpoint)
      throw error
    }
    return result.value
  }

  /**
   * Read compact status metadata for the current session tree.
   * @param agent - owning live agent.
   * @returns current tree counts, cursor, branches, and usage metadata.
   */
  @Remote('session')
  session(agent: Agent): SessionTreeSessionInfo {
    return this.synced(agent).info()
  }
}

export default SessionTreeService

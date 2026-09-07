/**
 * Session-tree domain service: the append-only multi-branch conversation
 * tree, one per agent session, served to the browser through the generated
 * `sessionTree` Remote namespace.
 *
 * Design notes
 * - A process-wide store keeps every session's tree; the companion
 *   `@robiteame/dsh-tool-session-tree` plugin shares the same store, so
 *   anything the model appends is immediately visible to the browser panel
 *   and vice versa.
 * - Harness Session events are the durable source of truth; the process-wide
 *   store is an incrementally synchronized projection, while explicit snapshots
 *   remain available for export and full-tree restore.
 * - Every operation answers `{ok, value}|{ok:false,error}` from the domain
 *   layer; the Remote boundary adds its own transport envelope.
 *
 * @module @robiteame/dsh-pi-agent-session-tree
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { isSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session/types'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { SessionTree, sessionTreeStore } from './session-tree.ts'
import { attachToolResult, sessionEventsToTreeNodes, toolResultOf } from './session-event-adapter.ts'
import { getSessionTreeSidecar, persistSessionTree } from './session-tree-sidecar.ts'
import type { JumpView, SessionTreeSessionInfo, SessionTreeView } from './types.ts'

export { SessionTree, SessionTreeStore, sessionTreeStore } from './session-tree.ts'
export type * from './types.ts'
export { attachToolResult, sessionEventsToTreeNodes, toolResultOf, type ProjectedToolResult } from './session-event-adapter.ts'
export { getSessionTreeSidecar, persistSessionTree, setSessionTreeSidecar, SessionTreeSidecar } from './session-tree-sidecar.ts'
export { isSessionTreeRestoreEvent, sessionTreeMarkerOf, type SessionTreeRestoreMarker } from './session-tree-marker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionTree: SessionTreeService
  }
}

/** Selected-message-surface API added by the repository's optional dev/session-branch-surface.patch. */
interface SelectedMessageSurfaceSession {
  selectMessageSurface(nodes: readonly number[] | null): void
  messageSurfaceNodes(): readonly number[]
}

/**
 * Whether a live Session exposes the selected-message-surface API shipped by
 * this repository's `dev/session-branch-surface.patch`. A stock DeepSeek-Harness
 * install (the target of `dsh plugin add`) has no such API: `deriveMessages()`
 * always walks the canonical surface, and unknown `session-tree/*` events
 * cannot be marked `ignorable` through the public append API, so a profile
 * cannot persist them. The tree remains fully browsable and branchable inside
 * the process store in that mode; only the in-place model-surface switch is
 * unavailable.
 */
export function supportsSelectedMessageSurface(
  session: Session,
): session is Session & SelectedMessageSurfaceSession {
  const candidate = session as Partial<SelectedMessageSurfaceSession>
  return typeof candidate.selectMessageSurface === 'function'
    && typeof candidate.messageSurfaceNodes === 'function'
}

/** How cursor movements reach the model-visible Session surface on this build. */
export type SessionTreeSurfaceMode = 'native' | 'stock' | 'projection'

/**
 * Sessions whose live surface could not be rewritten even through the official
 * replace event. They fall back to projection-only navigation: the tree and
 * panel cursor move, but the next model turn keeps the canonical history.
 */
const projectionFallbackSessions = new WeakSet<object>()
/** Sessions already announced in the Host log, so each notice fires once. */
const surfaceNoticesSent = new WeakMap<object, Set<SessionTreeSurfaceMode>>()

/**
 * The active surface mode for one session:
 * - `native` — `dev/session-branch-surface.patch` (or an upstream merge)
 *   provides `Session.selectMessageSurface()`; jump/fork switch the model
 *   history directly.
 * - `stock` — official Harness: the plugin emulates the switch with an official
 *   empty `replace` surface event plus the durable sidecar.
 * - `projection` — the live surface is not writable in this revision;
 *   navigation updates the tree projection and panel only.
 */
export function sessionTreeSurfaceMode(session: Session): SessionTreeSurfaceMode {
  if (supportsSelectedMessageSurface(session)) return 'native'
  return projectionFallbackSessions.has(session) ? 'projection' : 'stock'
}

/** Announce a non-native mode once per session in the Host log. */
function noticeSurfaceMode(
  session: Session,
  mode: Exclude<SessionTreeSurfaceMode, 'native'>,
  detail: string,
): void {
  let sent = surfaceNoticesSent.get(session)
  if (sent === undefined) {
    sent = new Set()
    surfaceNoticesSent.set(session, sent)
  }
  if (sent.has(mode)) return
  sent.add(mode)
  console.warn(`[session-tree] ${String(session.id)}: ${detail}`)
}

/** Mark a session as projection-only after its stock surface rewrite failed. */
function markProjectionFallback(session: Session, cause: unknown): void {
  if (projectionFallbackSessions.has(session)) return
  projectionFallbackSessions.add(session)
  const reason = cause instanceof Error ? cause.message : String(cause)
  noticeSurfaceMode(
    session,
    'projection',
    'projection mode: the live message surface is not writable here '
      + `(${reason}); jump/fork move the tree cursor and panel only, and the next model turn keeps the canonical history. `
      + 'Apply dev/session-branch-surface.patch (or upgrade Harness) for native branch switching.',
  )
}

/**
 * Whether the running Harness recognizes the durable `session-tree/*` event
 * vocabulary. The event names are registered in the session known-event-types
 * table by `dev/session-branch-surface.patch`; on stock packages an appended
 * unknown event would make a resumed persisted log unreadable, so callers must
 * skip those appends.
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
    // A tool call and its result are one interaction: fold the result into the
    // already-projected tool-call node instead of appending a second entry.
    // This covers results that arrive in a later sync batch than their call.
    if (event.type === 'tool/result') {
      const result = toolResultOf(event)
      const callNode = result === undefined ? undefined : tree.findToolCallNode(result.callId)
      if (callNode !== undefined && result !== undefined) {
        const merged = attachToolResult(callNode, result, event.seq)
        const attached = tree.attachToolResult(result.callId, merged)
        if (!attached.ok) throw new Error(`${attached.error.code}: ${attached.error.message}`)
        continue
      }
    }
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
    // A merged tool node carries two native seqs: the call (metadata-only, not
    // a surface event) and the result (a real surface event that must stay on
    // the model-visible path together with its call).
    const nativeSeqs: number[] = []
    const primary = node.metadata?.sessionEventSeq
    if (typeof primary === 'number') nativeSeqs.push(primary)
    const resultSeq = node.metadata?.toolResultEventSeq
    if (typeof resultSeq === 'number') nativeSeqs.push(resultSeq)
    for (const seq of nativeSeqs) {
      const event = session.events[seq]
      if (event !== undefined && isSurfaceEvent(event)) seqs.push(seq)
    }
  }
  return seqs
}

/** Append the official replacement event that invalidates the stock deriveMessages cache. */
function appendStockCursorEvent(
  session: Session,
  tree: SessionTree,
  logSurfaceNodes: readonly number[],
): SessionEvent<'assistant/message'> | undefined {
  if (logSurfaceNodes.length === 0) return undefined
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
  // The replace range must be expressed against the surface a fresh replay of
  // the log would build: the live node list was rewritten in place by earlier
  // navigations, so ranges taken from it reference seqs the replayed surface
  // no longer contains and make the stored session fail resume validation.
  return session.append('assistant/message', data, {
    surfaceOp: { op: 'replace', start: logSurfaceNodes[0]!, end: logSurfaceNodes[logSurfaceNodes.length - 1]! },
    sourceEventSeqs: [...logSurfaceNodes],
  })
}

/**
 * The surface node list a fresh replay of the Session log would produce. The
 * in-memory list is spliced by {@link setStockSurfaceNodes} and therefore
 * diverges from the log after the first navigation; this walk reconstructs the
 * replayed truth so every emitted replace event stays resume-valid.
 */
function canonicalSurfaceNodes(session: Session): number[] {
  const nodes: number[] = []
  for (const event of session.events) {
    if (!isSurfaceEvent(event)) continue
    if (event.surfaceOp === 'append') {
      nodes.push(event.seq)
      continue
    }
    if (event.surfaceOp !== undefined && event.surfaceOp.op === 'replace') {
      const start = nodes.indexOf(event.surfaceOp.start)
      const end = nodes.indexOf(event.surfaceOp.end)
      if (start < 0 || end < start) continue
      nodes.splice(start, end - start + 1, event.seq)
    }
  }
  return nodes
}

/** Announce the stock emulation once per session in the Host log. */
function noticeStockMode(session: Session): void {
  noticeSurfaceMode(
    session,
    'stock',
    'stock-surface mode: this Harness lacks Session.selectMessageSurface(); '
      + 'branch switches use the official replace-surface emulation and the session-tree sidecar for durability',
  )
}

/** Whether the live stock surface node list can be rewritten in place. */
function stockSurfaceIsWritable(session: Session): boolean {
  const nodes: unknown = session.surface.nodes
  return Array.isArray(nodes) && !Object.isFrozen(nodes)
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
  // An unwritable surface must be detected before appending: a replace event
  // without the follow-up node rewrite would leave a truncated live path, so
  // such builds degrade to projection-only navigation instead.
  if (!stockSurfaceIsWritable(stockSession)) {
    markProjectionFallback(stockSession, new Error('surface nodes are not a writable array'))
    persistSessionTree(tree)
    return
  }
  try {
    noticeStockMode(stockSession)
    const logSurfaceNodes = canonicalSurfaceNodes(stockSession)
    // Restore the live surface to the log's replayed truth first: the live
    // array was spliced by earlier navigations, and the append-time
    // provenance check would otherwise accept a replace the resume replay
    // rejects (and vice versa). With live == replayed, both agree forever.
    if (!sameSurfaceNodes(currentNodes, logSurfaceNodes)) {
      setStockSurfaceNodes(stockSession, logSurfaceNodes)
    }
    const event = appendStockCursorEvent(stockSession, tree, logSurfaceNodes)
    if (event !== undefined) tree.markSessionEventSeq(event.seq)
    setStockSurfaceNodes(stockSession, seqs)
  } catch (error) {
    markProjectionFallback(stockSession, error)
  }
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

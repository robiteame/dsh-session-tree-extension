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
import { SessionId as toSessionId } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Session } from '@deepseek-ai/dsh-session'
import { isSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session/types'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { SessionTree, sessionTreeStore } from './session-tree.ts'
import { attachToolResult, sessionEventsToTreeNodes, toolResultOf } from './session-event-adapter.ts'
import { getSessionTreeSidecar, persistSessionTree } from './session-tree-sidecar.ts'
import type {
  JumpView,
  SessionTreeForkView,
  SessionTreeSessionInfo,
  SessionTreeView,
  TreeNode,
} from './types.ts'

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

/** Event types needed to keep a copied path replayable without conversation noise. */
const STRUCTURAL_EVENT_TYPES = new Set<SessionEvent['type']>([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'request/header',
])

/** Source seqs represented by one tree node, including merged tool results. */
function sourceSeqsOf(node: TreeNode): number[] {
  const seqs: number[] = []
  const primary = node.metadata?.sessionEventSeq
  if (typeof primary === 'number') seqs.push(primary)
  const result = node.metadata?.toolResultEventSeq
  if (typeof result === 'number') seqs.push(result)
  return seqs
}

/**
 * The Session event log across Harness builds. The agent-facing Session
 * wrapper exposes an `events` array, while the persisted core Session shipped
 * in published Harness builds only offers `snapshotEvents()`; code paths that
 * must run in both hosts read the log through this accessor. An unreadable
 * log yields an empty array so tree sync degrades instead of throwing inside
 * the gateway.
 */
function sessionEvents(session: Session): readonly SessionEvent[] {
  const candidate = session as Session & {
    events?: readonly SessionEvent[]
    snapshotEvents?: () => readonly SessionEvent[]
  }
  if (Array.isArray(candidate.events)) return candidate.events
  if (typeof candidate.snapshotEvents === 'function') {
    const snapshot = candidate.snapshotEvents()
    if (Array.isArray(snapshot)) return snapshot
  }
  return []
}

/**
 * Build a fresh-session seed from only the selected root-to-node path.
 *
 * The source Session is read through its immutable event snapshot; no append,
 * cursor, or surface method is called. Structural events keep copied turns
 * replayable, while events from sibling branches and messages after the
 * selected user prompt are deliberately omitted. Sequence numbers are rebuilt
 * contiguously because Agent creation requires a valid independent log.
 */
export function sessionPathForkSeed(
  source: Session,
  path: readonly TreeNode[],
): readonly SessionEvent[] {
  const wanted = new Set<number>()
  let anchorSeq = -1
  for (const node of path) {
    const seqs = sourceSeqsOf(node)
    for (const seq of seqs) wanted.add(seq)
    anchorSeq = Math.max(anchorSeq, ...seqs)
  }
  if (anchorSeq < 0) return []

  // Keep the enclosing turn boundary (if any) so a user-only path remains a
  // balanced, durable Session seed; filtering removes its assistant content.
  const events = sessionEvents(source)
  const boundary = events.find(event => event.seq >= anchorSeq && event.type === 'turn/end')?.seq ?? anchorSeq
  const kept: SessionEvent[] = []
  for (const event of events) {
    if (event.seq > boundary) break
    const isWanted = wanted.has(event.seq)
      || (event.type === 'session-tree/node' && sourceSeqsOf(event.data.node).some(seq => wanted.has(seq)))
    if (isWanted || STRUCTURAL_EVENT_TYPES.has(event.type)) kept.push(event)
  }

  const seedIndexBySourceSeq = new Map<number, number>()
  return kept.map((event, index) => {
    seedIndexBySourceSeq.set(event.seq, index)
    const record = JSON.parse(JSON.stringify(event)) as SessionEvent
    record.seq = index
    // A copied subset cannot keep replace ranges that point at omitted source
    // seqs. All retained path events become appends in the target's own space.
    if (isSurfaceEvent(record)) {
      record.surfaceOp = 'append'
      delete record.sourceEventSeqs
    }
    if (record.type === 'session-tree/node') {
      const metadata = record.data.node.metadata
      const primary = typeof metadata?.sessionEventSeq === 'number' ? metadata.sessionEventSeq : undefined
      const mappedPrimary = primary === undefined ? undefined : seedIndexBySourceSeq.get(primary)
      const resultSeq = typeof metadata?.toolResultEventSeq === 'number' ? metadata.toolResultEventSeq : undefined
      const mappedResult = resultSeq === undefined ? undefined : seedIndexBySourceSeq.get(resultSeq)
      record.data = {
        ...record.data,
        node: {
          ...record.data.node,
          metadata: {
            ...metadata,
            ...(mappedPrimary === undefined ? {} : { sessionEventSeq: mappedPrimary, sourceEventSeq: mappedPrimary }),
            ...(mappedResult === undefined ? {} : { toolResultEventSeq: mappedResult }),
          },
        },
      }
    }
    return record
  })
}

/**
 * Project an independent target tree from path envelopes. `nativeEventSeq`
 * pins the target's replay watermark to its freshly renumbered seed, so the
 * target never re-projects the source's original sequence space.
 */
function createForkTargetTree(
  targetId: SessionId,
  path: readonly TreeNode[],
  branchName: string,
  seedLength: number,
): SessionTree {
  const tree = new SessionTree(targetId)
  const replay = tree.replay(path.map((node, index) => ({ seq: index, node })))
  if (!replay.ok) throw new Error(`${replay.error.code}: ${replay.error.message}`)
  if (seedLength > 0) tree.markSessionEventSeq(seedLength - 1)
  const tail = path[path.length - 1]?.nodeId ?? ''
  const selected = tree.select(tail)
  if (!selected.ok) throw new Error(`${selected.error.code}: ${selected.error.message}`)
  const branched = tree.branch(tail, branchName)
  if (!branched.ok) throw new Error(`${branched.error.code}: ${branched.error.message}`)
  return tree
}

/** Extract the complete editable text of a projected user prompt. */
function promptTextOf(node: TreeNode): string {
  const parts = (node.content ?? [])
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
  const text = parts.join('\n').trim()
  return text === '' ? node.message?.content ?? node.summary : text
}

/** Optional side-effect controls for callers that only need to inspect history. */
export interface SyncSessionTreeOptions {
  /** Apply the tree cursor to the model-visible Session surface (default true). */
  readonly applySurface?: boolean
  /** Persist the projected tree sidecar (default true). */
  readonly persist?: boolean
}

/** Materialize and incrementally synchronize native Harness history. */
export function syncSessionTree(agent: Agent, options: SyncSessionTreeOptions = {}): SessionTree {
  const sessionId = agent.session.id
  const existing = sessionTreeStore.get(sessionId)
  const restored = existing === undefined ? getSessionTreeSidecar().load(sessionId) : undefined
  let tree = existing === undefined
    ? restored ?? new SessionTree(sessionId)
    : new SessionTree(sessionId, existing.snapshot())
  const actualLatestSeq = sessionEvents(agent.session).at(-1)?.seq ?? -1
  tree.limitSessionEventSeq(actualLatestSeq)
  const lastSeq = tree.lastSessionEventSeq()
  const freshEvents = sessionEvents(agent.session).filter(event => event.seq > lastSeq)
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
  if (options.applySurface !== false) applyTreeCursorToSession(agent, tree)
  if (options.persist !== false) persistSessionTree(tree)
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
      const event = sessionEvents(session)[seq]
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
  for (const event of sessionEvents(session)) {
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
   * Remote methods receive an `agentId` and resolve it through `ctx.agents`.
   * Declare the dependency so the lookup runs in this plugin's own fiber.
   */
  static inject = ['agents']

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

  /** Read the projected tree without mutating the source Session surface. */
  private readOnlyTree(agent: Agent): SessionTree {
    return syncSessionTree(agent, { applySurface: false, persist: false })
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
   * Copy only the selected user-node root path into a brand-new Session.
   * @param agent - owning live source agent.
   * @param nodeId - selected user-message node.
   * @param branch - branch label installed on the independent copy.
   * @returns the source fork point plus target session and editable prompt.
   */
  @Remote('forkSession')
  async forkSession(agent: Agent, nodeId: string, branch: string): Promise<SessionTreeForkView> {
    const branchName = branch === '' ? 'fork' : branch
    // Independent forks must not invoke jump/branch/surface methods on the
    // source: the source JSONL remains byte-for-byte unchanged.
    const tree = this.readOnlyTree(agent)
    const selectedNode = tree.list().find(node => node.nodeId === nodeId)
    if (selectedNode === undefined) throw new Error('NODE_NOT_FOUND: node was not found')
    if (selectedNode?.message?.role !== 'user') {
      throw new Error('INVALID_ARGUMENT: forkSession requires a user-message node')
    }
    const path = tree.currentPath(nodeId)
    if (path[path.length - 1]?.nodeId !== nodeId) {
      throw new Error('NODE_NOT_FOUND: fork path could not be reconstructed')
    }
    const source = agent.session
    const targetId = toSessionId(`${source.id}-fork-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
    const seed = sessionPathForkSeed(source, path)
    const targetTree = createForkTargetTree(targetId, path, branchName, seed.length)
    try {
      await this.ctx.agents.create({
        sessionId: targetId,
        ...(seed.length === 0 ? {} : { seed }),
        meta: {
          parentSession: source.id,
          seedLength: seed.length,
          // Harness history/list only serves ordinary Sessions with a cwd.
          // Inherit the source project so the fork is a usable real Session
          // instead of a store-only id that fails session/not-found.
          cwd: source.header.cwd ?? process.cwd(),
          ...(source.header.agentPreset === undefined ? {} : { agentPreset: source.header.agentPreset }),
        },
        agentOptions: agent.options,
      })
    } catch (error) {
      // Standalone hosts may not mount the loop-owned Agent factory. Real
      // Harness creates the live Session above; any other failure is real.
      if (!(error instanceof Error) || !error.message.includes('no agent factory registered')) throw error
    }
    // Publish the projected tree only after the independent Session has been
    // accepted. A failed factory call therefore leaves no fork sidecar/store
    // entry behind, while the no-factory test/runtime fallback still exposes
    // the fully materialized target tree.
    sessionTreeStore.replace(targetId, targetTree)
    persistSessionTree(targetTree)
    // Unlike legacy fork(), the source tree is not branched or selected.
    const forkCount = tree.list().filter(node => node.parentId === nodeId).length
    const previousUser = path
      .slice(0, -1)
      .reverse()
      .find(node => node.message?.role === 'user')
    return {
      cursor: nodeId,
      branch: branchName,
      forkCount,
      sessionId: targetId,
      prompt: promptTextOf(selectedNode),
      ...(previousUser === undefined ? {} : { previousUserPrompt: promptTextOf(previousUser) }),
    }
  }

  /**
   * Legacy in-tree branch primitive retained for API compatibility. Prefer
   * {@link fork} in user-facing flows: it creates an isolated Session copy.
   */
  branchInPlace(agent: Agent, nodeId: string, branch: string): { cursor: string; branch: string; forkCount: number } {
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

/**
 * Read-only projection of a Session lineage into one merged node graph.
 *
 * Session-level topology comes from the native Session list. Node-level
 * topology comes from each Session's own tree view. Native forks copy the
 * source log prefix with event sequence numbers intact, so the deepest shared
 * root-path prefix is the fork anchor. Only that prefix is deduplicated; every
 * branch-specific node keeps a session-qualified identity.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionTreeView, TreeNode } from '@robiteame/dsh-pi-agent-session-tree/client'
import type { ForkLineageEntry } from './fork-lineage.ts'

/** Which kind of Session a row represents. */
export type BranchTreeBadge = 'main' | 'fork' | 'clone'

/** One Session in the derived lineage. */
export interface BranchTreeRow {
  readonly sessionId: SessionId
  readonly parentId: SessionId | undefined
  readonly title: string
  /** 0 is the trunk root; each nesting level adds one. */
  readonly depth: number
  /** Last sibling stops the parent rail below its elbow. */
  readonly isLast: boolean
  /** Per ancestor level above the parent: whether its rail continues below. */
  readonly railContinues: readonly boolean[]
  readonly childCount: number
  readonly running: boolean
  /** The Session the UI currently has open. */
  readonly current: boolean
  /** On the root-to-current chain. */
  readonly onActivePath: boolean
  readonly badge: BranchTreeBadge
  readonly branchLabel: string | undefined
}

/** Derived Session-level lineage in DFS pre-order. */
export interface BranchTreeModel {
  readonly rows: readonly BranchTreeRow[]
  readonly rootId: SessionId
  readonly highlightedId: SessionId
  readonly activeAncestors: ReadonlySet<SessionId>
}

/** Read-only projection input shared by the graph builder and tests. */
export interface BranchTreeListState {
  readonly ids?: readonly SessionId[]
  readonly byId?: Readonly<Record<SessionId, unknown>> | undefined
  readonly current?: SessionId | undefined
}

interface SessionRowView {
  readonly parentId: SessionId | undefined
  readonly displayTitle: string | undefined
  readonly running: boolean
  readonly updatedAt: number
  readonly subagent: boolean
}

/** One badge rendered where a Session branch starts. */
export interface SessionGraphBadge {
  readonly sessionId: SessionId
  readonly kind: BranchTreeBadge
  readonly branchLabel: string | undefined
  readonly title: string
  readonly running: boolean
  readonly current: boolean
  /** Stable identity for independently collapsing this Session branch. */
  readonly collapseKey: string
  /** Whether collapsing this badge can hide at least one branch-owned row. */
  readonly hasChildren: boolean
}

/** Why a Session has a synthetic placeholder row instead of its nodes. */
export type SessionGraphPlaceholder = 'loading' | 'error' | 'empty'

/** One render-ready node row in the merged graph. */
export interface SessionGraphRow {
  /** Session-qualified key for unique nodes; the shared key for a copied prefix. */
  readonly key: string
  readonly parentKey: string | null
  readonly node: TreeNode
  readonly owners: readonly SessionId[]
  readonly badges: readonly SessionGraphBadge[]
  readonly lane: number
  readonly parentLane: number | null
  readonly continues: readonly number[]
  readonly hasChildren: boolean
  /** Branch-owned rows hidden by this row's branch collapse keys. */
  readonly branchKeys: readonly string[]
  /** The current Session's selected node. */
  readonly active: boolean
  /** On the current Session's selected-node path. */
  readonly onActivePath: boolean
  readonly placeholder: SessionGraphPlaceholder | undefined
}

/** Complete merged graph plus the keys needed for reveal-on-open behavior. */
export interface SessionGraphModel {
  readonly rows: readonly SessionGraphRow[]
  readonly sessionIds: readonly SessionId[]
  readonly failedSessionIds: readonly SessionId[]
  readonly highlightedId: SessionId
  readonly activePathKeys: ReadonlySet<string>
  readonly activeBranchKeys: ReadonlySet<string>
}

interface MutableGraphNode {
  readonly key: string
  readonly node: TreeNode
  parentKey: string | null
  readonly owners: Set<SessionId>
  readonly badges: SessionGraphBadge[]
  readonly branchKeys: Set<string>
  order: number
  readonly placeholder: SessionGraphPlaceholder | undefined
}

function rowViewOf(summary: unknown): SessionRowView {
  const row = (summary ?? {}) as {
    parentId?: unknown
    displayTitle?: unknown
    running?: unknown
    updatedAt?: unknown
    origin?: unknown
  }
  return {
    parentId: typeof row.parentId === 'string' ? row.parentId as SessionId : undefined,
    displayTitle: typeof row.displayTitle === 'string' && row.displayTitle !== '' ? row.displayTitle : undefined,
    running: row.running === true,
    updatedAt: typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) ? row.updatedAt : 0,
    subagent: row.origin === 'subagent',
  }
}

/**
 * Flatten one Session lineage into ordered worktree rows. The trunk is the
 * oldest ancestor of `sessionId` still present in the live list; children
 * nest under their parent ordered by creation, then list order. Cycles and
 * missing rows are skipped, never followed.
 */
export function buildBranchTreeModel(
  sessionId: SessionId,
  state: BranchTreeListState,
  entries: ReadonlyMap<SessionId, ForkLineageEntry>,
): BranchTreeModel | null {
  const byId = state.byId ?? {}
  if (!Object.prototype.hasOwnProperty.call(byId, sessionId)) return null

  const viewOf = (id: SessionId): SessionRowView | undefined =>
    Object.prototype.hasOwnProperty.call(byId, id) ? rowViewOf(byId[id]) : undefined

  const parentOf = (id: SessionId): SessionId | undefined => {
    const parentId = viewOf(id)?.parentId
    if (parentId === undefined || parentId === id) return undefined
    return viewOf(parentId) === undefined ? undefined : parentId
  }

  const rootChain: SessionId[] = []
  const walkSeen = new Set<SessionId>()
  for (let cursor: SessionId | undefined = sessionId; cursor !== undefined && !walkSeen.has(cursor); ) {
    walkSeen.add(cursor)
    rootChain.push(cursor)
    cursor = parentOf(cursor)
  }
  const rootId: SessionId = rootChain[rootChain.length - 1]!

  const ids = state.ids ?? (Object.keys(byId) as SessionId[])
  const orderOf = (id: SessionId): number => {
    const index = ids.indexOf(id)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  const createdAtOf = (id: SessionId): number => entries.get(id)?.createdAt ?? viewOf(id)?.updatedAt ?? 0

  const childIds = new Map<SessionId, SessionId[]>()
  for (const id of Object.keys(byId) as SessionId[]) {
    const view = viewOf(id)
    if (view?.subagent === true) continue
    const parentId = parentOf(id)
    if (parentId === undefined) continue
    const siblings = childIds.get(parentId)
    if (siblings === undefined) childIds.set(parentId, [id])
    else siblings.push(id)
  }
  const siblingsOf = (parentId: SessionId): readonly SessionId[] =>
    (childIds.get(parentId) ?? []).slice().sort((a, b) => createdAtOf(a) - createdAtOf(b) || orderOf(a) - orderOf(b))

  interface TopologyRow {
    id: SessionId
    depth: number
    isLast: boolean
    railContinues: readonly boolean[]
  }
  const topology: TopologyRow[] = []
  const subtree = new Set<SessionId>()
  const visit = (
    siblings: readonly SessionId[],
    depth: number,
    railContinues: readonly boolean[],
    ancestors: ReadonlySet<SessionId>,
  ): void => {
    siblings.forEach((id, index) => {
      if (ancestors.has(id)) return
      const isLast = index === siblings.length - 1
      topology.push({ id, depth, isLast, railContinues })
      subtree.add(id)
      const nextAncestors = new Set(ancestors)
      nextAncestors.add(id)
      visit(siblingsOf(id), depth + 1, [...railContinues, !isLast], nextAncestors)
    })
  }
  visit([rootId], 0, [], new Set())

  const highlightedId: SessionId = state.current !== undefined && subtree.has(state.current) ? state.current : sessionId
  const activeAncestors = new Set<SessionId>()
  for (let cursor = highlightedId; cursor !== rootId; ) {
    const parentId = parentOf(cursor)
    if (parentId === undefined || activeAncestors.has(parentId)) break
    activeAncestors.add(parentId)
    cursor = parentId
  }

  const rows: BranchTreeRow[] = topology.map(({ id, depth, isLast, railContinues }) => {
    const entry = entries.get(id)
    const view = viewOf(id)
    return {
      sessionId: id,
      parentId: parentOf(id),
      title: entry?.summary ?? view?.displayTitle ?? id,
      depth,
      isLast,
      railContinues,
      childCount: siblingsOf(id).length,
      running: view?.running === true,
      current: id === highlightedId,
      onActivePath: id === highlightedId || activeAncestors.has(id),
      badge: depth === 0 ? 'main' : entry !== undefined ? 'fork' : 'clone',
      branchLabel: entry?.branch,
    }
  })
  return { rows, rootId, highlightedId, activeAncestors }
}

/** Pre-order rows minus the descendants of collapsed rows. */
export function visibleBranchRows(
  rows: readonly BranchTreeRow[],
  collapsed: ReadonlySet<SessionId>,
): BranchTreeRow[] {
  const visible: BranchTreeRow[] = []
  let skipDepth = 0
  for (const row of rows) {
    if (skipDepth > 0 && row.depth >= skipDepth) continue
    skipDepth = 0
    visible.push(row)
    if (collapsed.has(row.sessionId)) skipDepth = row.depth + 1
  }
  return visible
}

function nodeSequence(node: TreeNode): number | undefined {
  const primary = node.metadata?.sessionEventSeq
  if (typeof primary === 'number' && Number.isSafeInteger(primary)) return primary
  const source = node.metadata?.sourceEventSeq
  return typeof source === 'number' && Number.isSafeInteger(source) ? source : undefined
}

function matchKey(node: TreeNode): string {
  const seq = nodeSequence(node)
  return `${node.nodeId}\u0000${seq === undefined ? '' : String(seq)}`
}

function sameNode(left: TreeNode, right: TreeNode): boolean {
  return matchKey(left) === matchKey(right)
}

/** Root-to-selected/cursor path, with defensive fallback for sparse views. */
function pathToNode(view: SessionTreeView): TreeNode[] {
  const byId = new Map(view.nodes.map(node => [node.nodeId, node]))
  const preferred = view.selectedNodeId
  let current = typeof preferred === 'string' && byId.has(preferred)
    ? preferred
    : view.cursor !== null && byId.has(view.cursor)
      ? view.cursor
      : view.nodes.at(-1)?.nodeId ?? null
  const path: TreeNode[] = []
  const seen = new Set<string>()
  while (current !== null && !seen.has(current)) {
    seen.add(current)
    const node = byId.get(current)
    if (node === undefined) break
    path.push(node)
    current = node.parentId
  }
  return path.reverse()
}

function placeholderNode(row: BranchTreeRow, kind: SessionGraphPlaceholder): TreeNode {
  return {
    nodeId: `__session-tree-${kind}__`,
    parentId: null,
    branch: 'main',
    type: 'custom',
    summary: row.title,
    createdAt: '',
    metadata: { sessionGraphPlaceholder: kind },
  }
}

function branchKey(sessionId: SessionId, anchorNodeId: string): string {
  return `${sessionId}:${anchorNodeId}`
}

function orderedViewNodes(view: SessionTreeView): readonly TreeNode[] {
  return view.nodes.slice().sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.nodeId.localeCompare(right.nodeId),
  )
}

/**
 * Merge every available Session view into one tree. The first Session row is
 * the trunk. Each child reconnects to the deepest matching root-path prefix
 * on its Session parent; that matched node is the fork point. A child whose
 * view is unavailable contributes one placeholder row and never fails the
 * rest of the graph.
 */
export function buildSessionGraphModel(
  topology: BranchTreeModel,
  views: ReadonlyMap<SessionId, SessionTreeView>,
  failed: ReadonlySet<SessionId>,
): SessionGraphModel {
  const graph = new Map<string, MutableGraphNode>()
  const sessionMaps = new Map<SessionId, ReadonlyMap<string, string>>()
  const sessionTails = new Map<SessionId, string>()
  const sessionBranchKeys = new Map<SessionId, readonly string[]>()
  const branchKeyBySession = new Map<SessionId, string>()
  const rowOrder = new Map(topology.rows.map((row, index) => [row.sessionId, index]))
  const failedSessionIds: SessionId[] = []

  const addNode = (
    key: string,
    node: TreeNode,
    parentKey: string | null,
    order: number,
    placeholder: SessionGraphPlaceholder | undefined,
  ): MutableGraphNode => {
    const existing = graph.get(key)
    if (existing !== undefined) {
      existing.order = Math.min(existing.order, order)
      return existing
    }
    const created: MutableGraphNode = {
      key,
      node,
      parentKey,
      owners: new Set(),
      badges: [],
      branchKeys: new Set(),
      order,
      placeholder,
    }
    graph.set(key, created)
    return created
  }

  const addOwner = (key: string, sessionId: SessionId): void => {
    graph.get(key)?.owners.add(sessionId)
  }

  const addBranchKeys = (key: string, keys: readonly string[]): void => {
    const target = graph.get(key)
    if (target === undefined) return
    for (const value of keys) target.branchKeys.add(value)
  }

  const addBadge = (
    key: string,
    row: BranchTreeRow,
    collapseKey: string,
    hasChildren: boolean,
  ): void => {
    const target = graph.get(key)
    if (target === undefined) return
    target.badges.push({
      sessionId: row.sessionId,
      kind: row.badge,
      branchLabel: row.branchLabel,
      title: row.title,
      running: row.running,
      current: row.current,
      collapseKey,
      hasChildren,
    })
  }

  const mergeSession = (row: BranchTreeRow, order: number): void => {
    const nodeKeys = new Map<string, string>()
    const view = views.get(row.sessionId)
    const parentId = row.parentId
    const parentView = parentId === undefined ? undefined : views.get(parentId)
    const parentKeys = parentId === undefined ? undefined : sessionMaps.get(parentId)
    const fallbackParentKey = parentId === undefined ? null : sessionTails.get(parentId) ?? null
    const inheritedBranchKeys = parentId === undefined ? [] : sessionBranchKeys.get(parentId) ?? []

    if (view === undefined || failed.has(row.sessionId)) {
      const kind: SessionGraphPlaceholder = failed.has(row.sessionId) ? 'error' : 'loading'
      const key = `${row.sessionId}:__session-tree-${kind}__`
      const node = placeholderNode(row, kind)
      const collapseKey = branchKey(row.sessionId, node.nodeId)
      addNode(key, node, fallbackParentKey, order, kind)
      addOwner(key, row.sessionId)
      addBranchKeys(key, [...inheritedBranchKeys, collapseKey])
      addBadge(key, row, collapseKey, false)
      sessionMaps.set(row.sessionId, new Map([[node.nodeId, key]]))
      sessionTails.set(row.sessionId, key)
      sessionBranchKeys.set(row.sessionId, [...inheritedBranchKeys, collapseKey])
      branchKeyBySession.set(row.sessionId, collapseKey)
      if (kind === 'error') failedSessionIds.push(row.sessionId)
      return
    }

    const childPath = pathToNode(view)
    const sharedChildIds = new Set<string>()
    const sharedParentKeys = new Map<string, string>()
    if (parentView !== undefined && parentKeys !== undefined) {
      const parentPath = pathToNode(parentView)
      const count = Math.min(childPath.length, parentPath.length)
      for (let index = 0; index < count; index++) {
        const childNode = childPath[index]!
        const parentNode = parentPath[index]!
        if (!sameNode(childNode, parentNode)) break
        const parentKey = parentKeys.get(parentNode.nodeId)
        if (parentKey === undefined) break
        sharedChildIds.add(childNode.nodeId)
        sharedParentKeys.set(childNode.nodeId, parentKey)
      }
    }

    for (const node of view.nodes) {
      nodeKeys.set(node.nodeId, sharedParentKeys.get(node.nodeId) ?? `${row.sessionId}:${node.nodeId}`)
    }

    const anchorNodeId = childPath.at(-1) !== undefined && sharedChildIds.has(childPath.at(-1)!.nodeId)
      ? childPath.filter(node => sharedChildIds.has(node.nodeId)).at(-1)?.nodeId
      : undefined
    const rootAnchorNodeId = childPath[0]?.nodeId ?? orderedViewNodes(view)[0]?.nodeId ?? '__root__'
    const ownBranchKey = branchKey(row.sessionId, anchorNodeId ?? rootAnchorNodeId)
    const branchKeys = [...inheritedBranchKeys, ownBranchKey]
    sessionBranchKeys.set(row.sessionId, branchKeys)
    branchKeyBySession.set(row.sessionId, ownBranchKey)

    for (const node of view.nodes) {
      const key = nodeKeys.get(node.nodeId)
      if (key === undefined) continue
      const parentKey = node.parentId === null
        ? fallbackParentKey
        : nodeKeys.get(node.parentId) ?? fallbackParentKey
      addNode(
        key,
        node,
        sharedParentKeys.has(node.nodeId) ? graph.get(key)?.parentKey ?? parentKey : parentKey,
        order,
        undefined,
      )
      addOwner(key, row.sessionId)
      if (!sharedChildIds.has(node.nodeId)) addBranchKeys(key, branchKeys)
    }

    if (view.nodes.length === 0) {
      const kind: SessionGraphPlaceholder = 'empty'
      const key = `${row.sessionId}:__session-tree-empty__`
      const node = placeholderNode(row, kind)
      const collapseKey = branchKey(row.sessionId, node.nodeId)
      addNode(key, node, fallbackParentKey, order, kind)
      addOwner(key, row.sessionId)
      addBranchKeys(key, [...branchKeys, collapseKey])
      addBadge(key, row, collapseKey, false)
      sessionMaps.set(row.sessionId, new Map([[node.nodeId, key]]))
      sessionTails.set(row.sessionId, key)
      sessionBranchKeys.set(row.sessionId, [...branchKeys, collapseKey])
      branchKeyBySession.set(row.sessionId, collapseKey)
      return
    }

    const unsharedNodes = view.nodes.filter(node => !sharedChildIds.has(node.nodeId))
    const badgeNode = row.parentId === undefined
      ? childPath[0] ?? orderedViewNodes(view)[0]
      : childPath.find(node => !sharedChildIds.has(node.nodeId))
        ?? orderedViewNodes(view).find(node => !sharedChildIds.has(node.nodeId))
        ?? childPath.at(-1)
    const badgeKey = badgeNode === undefined ? undefined : nodeKeys.get(badgeNode.nodeId)
    const collapseKey = ownBranchKey ?? branchKey(row.sessionId, badgeNode?.nodeId ?? '__root__')
    if (badgeKey !== undefined) addBadge(badgeKey, row, collapseKey, unsharedNodes.length > 0)

    const tailNode = childPath.at(-1) ?? orderedViewNodes(view).at(-1)
    const tailKey = tailNode === undefined ? fallbackParentKey : nodeKeys.get(tailNode.nodeId) ?? fallbackParentKey
    sessionMaps.set(row.sessionId, nodeKeys)
    sessionTails.set(row.sessionId, tailKey ?? fallbackParentKey ?? `${row.sessionId}:__session-tree-empty__`)
  }

  topology.rows.forEach((row, order) => { mergeSession(row, order) })

  const children = new Map<string, string[]>()
  const rootKeys = new Set<string>()
  for (const node of graph.values()) {
    if (node.parentKey === null || !graph.has(node.parentKey)) {
      rootKeys.add(node.key)
      continue
    }
    const siblings = children.get(node.parentKey)
    if (siblings === undefined) children.set(node.parentKey, [node.key])
    else siblings.push(node.key)
  }
  const compareKeys = (leftKey: string, rightKey: string): number => {
    const left = graph.get(leftKey)!
    const right = graph.get(rightKey)!
    return left.order - right.order
      || left.node.createdAt.localeCompare(right.node.createdAt)
      || left.key.localeCompare(right.key)
  }
  for (const siblings of children.values()) siblings.sort(compareKeys)
  const sortedRoots = [...rootKeys].sort(compareKeys)

  const currentView = views.get(topology.highlightedId)
  const currentKeys = sessionMaps.get(topology.highlightedId)
  const activePathKeys = new Set<string>()
  if (currentView !== undefined && currentKeys !== undefined) {
    for (const node of pathToNode(currentView)) {
      const key = currentKeys.get(node.nodeId)
      if (key !== undefined) activePathKeys.add(key)
    }
  }

  const laneFor = (index: number): number => ((index % 5) + 5) % 5
  const rows: SessionGraphRow[] = []
  const visited = new Set<string>()
  const visit = (
    key: string,
    lane: number,
    parentLane: number | null,
    inheritedRails: readonly number[],
    ancestors: ReadonlySet<string>,
  ): void => {
    if (visited.has(key) || ancestors.has(key)) return
    const node = graph.get(key)
    if (node === undefined) return
    const nodeChildren = children.get(key) ?? []
    const continues = [...new Set(inheritedRails)].filter(value => value !== lane)
    const currentSelected = currentView?.selectedNodeId ?? currentView?.cursor ?? null
    rows.push({
      key,
      parentKey: node.parentKey,
      node: node.node,
      owners: [...node.owners].sort((a, b) => (rowOrder.get(a) ?? 0) - (rowOrder.get(b) ?? 0)),
      badges: node.badges,
      lane,
      parentLane,
      continues,
      hasChildren: nodeChildren.length > 0,
      branchKeys: [...node.branchKeys],
      active: node.owners.has(topology.highlightedId)
        && currentSelected !== null
        && node.node.nodeId === currentSelected,
      onActivePath: activePathKeys.has(key)
        || (node.placeholder !== undefined && node.owners.has(topology.highlightedId)),
      placeholder: node.placeholder,
    })
    visited.add(key)
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(key)
    nodeChildren.forEach((childKey, index) => {
      const childLane = index === 0 ? lane : laneFor(lane + index)
      const laterRails = nodeChildren
        .slice(index + 1)
        .map((_, siblingIndex) => laneFor(lane + index + siblingIndex + 1))
      visit(
        childKey,
        childLane,
        lane,
        [
          ...inheritedRails,
          ...(index < nodeChildren.length - 1 ? [lane] : []),
          ...laterRails,
        ],
        nextAncestors,
      )
    })
  }
  sortedRoots.forEach((key, index) => { visit(key, laneFor(index), null, [], new Set()) })

  const activeBranchKeys = new Set<string>()
  for (const sessionId of [...topology.activeAncestors, topology.highlightedId]) {
    const key = branchKeyBySession.get(sessionId)
    if (key !== undefined) activeBranchKeys.add(key)
  }

  return {
    rows,
    sessionIds: topology.rows.map(row => row.sessionId),
    failedSessionIds,
    highlightedId: topology.highlightedId,
    activePathKeys,
    activeBranchKeys,
  }
}

/**
 * SessionTreePanel fills DeepSeek Harness' right details sidebar.
 *
 * The modern host path merges every Session in the current lineage into one
 * git-style graph. Selector mode and older hosts keep the original
 * single-Session view. Both paths use a fixed-width graph gutter, so tree
 * depth can never increase the panel's horizontal width.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  LlmRole,
  SessionTreeForkView,
  SessionTreeView,
  TreeNode,
} from '@robiteame/dsh-pi-agent-session-tree/client'
import type { SessionTreeViewProps } from './slots.ts'
import type { SessionTreeKey } from './locales.ts'
import { isInjectedUserNode, nodeFullText } from './node-text.ts'
import {
  buildBranchTreeModel,
  buildSessionGraphModel,
  type SessionGraphBadge,
  type SessionGraphPlaceholder,
  type SessionGraphRow,
} from './session-graph.ts'
import css from './SessionTreePanel.module.css'

const ROLE_LABELS: Record<LlmRole, SessionTreeKey> = {
  system: 'node.role.system',
  user: 'node.role.user',
  assistant: 'node.role.assistant',
  tool: 'node.role.tool',
}
const GRAPH_LANES = 5
const LANE_X = [6, 14, 22, 30, 38] as const
const FAN_OUT_DEBOUNCE_MS = 80

const EMPTY_MODE_SNAPSHOT = { selectorOpen: false } as const
const NOOP_SUBSCRIBE = (_listener: () => void): (() => void) => () => {}
const NOOP_GET_MODE_SNAPSHOT = (): typeof EMPTY_MODE_SNAPSHOT => EMPTY_MODE_SNAPSHOT
const EMPTY_LINEAGE = new Map<SessionId, never>()
const EMPTY_LINEAGE_SNAPSHOT = (): typeof EMPTY_LINEAGE => EMPTY_LINEAGE
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set()

interface GraphRow {
  readonly node: TreeNode
  readonly lane: number
  readonly parentLane: number | null
  readonly continues: readonly number[]
}

/** Flatten the topology once. Lanes are bounded and reused; depth never becomes padding. */
function graphRows(nodes: readonly TreeNode[]): GraphRow[] {
  const children = new Map<string | null, TreeNode[]>()
  for (const node of nodes) {
    const siblings = children.get(node.parentId)
    if (siblings === undefined) children.set(node.parentId, [node])
    else siblings.push(node)
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.nodeId.localeCompare(b.nodeId))
  }
  const rows: GraphRow[] = []
  const visit = (
    parentId: string | null,
    parentLane: number | null,
    lane: number,
    ancestors: ReadonlySet<string>,
  ): void => {
    const siblings = children.get(parentId) ?? []
    siblings.forEach((node, index) => {
      if (ancestors.has(node.nodeId)) return
      const nodeLane = parentId === null ? 0 : index === 0 ? lane : (lane + index) % GRAPH_LANES
      const next = new Set(ancestors)
      next.add(node.nodeId)
      const continues = parentLane === null ? [] : [parentLane]
      rows.push({ node, lane: nodeLane, parentLane, continues })
      visit(node.nodeId, nodeLane, nodeLane, next)
    })
  }
  visit(null, null, 0, new Set())
  return rows
}

/** Whether one node is a typed human prompt the fork selector may target. */
function isUserPromptNode(node: TreeNode): boolean {
  return node.message?.role === 'user' && !isInjectedUserNode(node)
}

/**
 * Remove hidden entries while preserving the visible tree topology: children
 * of a removed node reconnect to its nearest visible ancestor. The default
 * predicate drops harness-injected context; the fork selector passes its
 * prompts-only predicate so a prompt whose answer parent is filtered out
 * still hangs off the previous prompt instead of becoming unreachable.
 */
function projectVisibleNodes(
  nodes: readonly TreeNode[],
  isVisible: (node: TreeNode) => boolean = node => !isInjectedUserNode(node),
): readonly TreeNode[] {
  if (nodes.every(isVisible)) return nodes
  const byId = new Map(nodes.map(node => [node.nodeId, node]))
  const visibleIds = new Set(nodes.filter(isVisible).map(node => node.nodeId))
  const resolveParent = (node: TreeNode): string | null => {
    const seen = new Set<string>()
    let parentId = node.parentId
    while (parentId !== null && !seen.has(parentId)) {
      if (visibleIds.has(parentId)) return parentId
      seen.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
    return null
  }
  return nodes
    .filter(isVisible)
    .map(node => node.parentId === null ? node : { ...node, parentId: resolveParent(node) })
}

/** Project one Session view without mutating the payload returned by load(). */
function projectVisibleView(view: SessionTreeView): SessionTreeView {
  const nodes = projectVisibleNodes(view.nodes)
  if (nodes === view.nodes) return view
  const nodeIds = new Set(nodes.map(node => node.nodeId))
  return {
    ...view,
    nodes,
    branches: view.branches.map(branch => ({
      ...branch,
      nodeIds: branch.nodeIds.filter(nodeId => nodeIds.has(nodeId)),
    })),
  }
}

function placeholderKey(kind: SessionGraphPlaceholder): SessionTreeKey {
  return kind === 'error'
    ? 'panel.graph.error'
    : kind === 'empty'
      ? 'panel.graph.empty'
      : 'panel.graph.loading'
}

/** The tool name carried by a tool-call node, used as the role label before its result lands. */
function toolNameOf(node: TreeNode): string | undefined {
  for (const part of node.content ?? []) {
    if (part.type === 'tool_call') return part.name
  }
  return undefined
}

/** Whether one node is a tool interaction entry (call, result, or merged pair). */
function isToolNode(node: TreeNode): boolean {
  return node.type === 'tool_call' || node.type === 'tool_result' || node.message?.role === 'tool'
}

/** Whether a node records a failed call — the row is marked red. */
function nodeHasError(node: TreeNode): boolean {
  return node.error !== undefined
    || node.content?.some(part => part.type === 'tool_result' && part.isError === true) === true
}

/** Fixed-width IDEA-style graph gutter shared by legacy and merged modes. */
function Graph({
  row,
  selected,
  onActivePath,
}: {
  row: GraphRow
  selected: boolean
  onActivePath: boolean
}) {
  const x = LANE_X[row.lane] ?? LANE_X[0]
  const px = row.parentLane === null ? x : LANE_X[row.parentLane] ?? LANE_X[0]
  const edgeClass = [css.edge, onActivePath ? css.edgeActive : undefined].filter(Boolean).join(' ')
  const railClass = [css.rail, onActivePath ? css.railActive : undefined].filter(Boolean).join(' ')
  return (
    <svg className={css.graph} viewBox="0 0 44 38" aria-hidden="true">
      {row.continues.map(lane => (
        <path key={lane} className={railClass} d={`M ${LANE_X[lane]} 0 V 38`} />
      ))}
      {row.parentLane === null
        ? <path className={edgeClass} d={`M ${x} 19 V 38`} />
        : <path className={edgeClass} d={`M ${px} 0 V 9 Q ${px} 19 ${x} 19 V 38`} />}
      <circle className={selected ? css.dotActive : css.dot} cx={x} cy="19" r={selected ? 5 : 4} />
      <circle className={css.dotCore} cx={x} cy="19" r="1.5" />
    </svg>
  )
}

function badgeText(badge: SessionGraphBadge, t: (key: SessionTreeKey) => string): string {
  return badge.kind === 'main'
    ? t('branch.tree.main')
    : badge.kind === 'fork'
      ? t('branch.node.forkBadge')
      : t('branch.tree.cloneBadge')
}

function badgeClass(badge: SessionGraphBadge): string | undefined {
  return badge.kind === 'main'
    ? css.mainBadge
    : badge.kind === 'fork'
      ? css.forkBadge
      : css.cloneBadge
}

function PlaceholderText({
  kind,
  t,
}: {
  kind: SessionGraphPlaceholder
  t: (key: SessionTreeKey) => string
}) {
  return <>{t(placeholderKey(kind))}</>
}

/**
 * One render-ready row. Badge controls live in a separate content wrapper
 * above the node-selection button so controls never nest inside each other.
 */
function NodeRow({
  rowKey,
  node,
  lane,
  parentLane,
  continues,
  owners,
  badges,
  placeholder,
  selected,
  onActivePath,
  branchHeads,
  hasChildren,
  expanded,
  messageOpen,
  selectorMode,
  pending,
  showFork,
  branchCollapsed,
  onToggleNode,
  onToggleBranch,
  onSelect,
  onFork,
  onForkUserPrompt,
  t,
}: {
  rowKey: string
  node: TreeNode
  lane: number
  parentLane: number | null
  continues: readonly number[]
  owners: readonly SessionId[]
  badges: readonly SessionGraphBadge[]
  placeholder: SessionGraphPlaceholder | undefined
  selected: boolean
  onActivePath: boolean
  branchHeads: Record<string, string> | undefined
  hasChildren: boolean
  expanded: boolean
  messageOpen: boolean
  selectorMode: boolean
  pending: boolean
  showFork: boolean
  branchCollapsed: ReadonlySet<string>
  onToggleNode: (key: string) => void
  onToggleBranch: (key: string) => void
  onSelect: (rowKey: string, node: TreeNode) => void
  onFork: (node: TreeNode) => void
  onForkUserPrompt: (node: TreeNode) => void
  t: (key: SessionTreeKey) => string
}) {
  const heads = Object.entries(branchHeads ?? {})
    .filter(([, id]) => id === node.nodeId)
    .map(([name]) => name)
  const failed = nodeHasError(node) || placeholder === 'error'
  const kindClass = failed
    ? css.nodeError
    : isToolNode(node)
      ? css.nodeTool
      : placeholder !== undefined
        ? css.nodePlaceholder
        : undefined
  const classes = [
    css.node,
    selected ? css.nodeSelected : onActivePath ? css.nodePath : undefined,
    messageOpen ? css.nodeMessageOpen : undefined,
    kindClass,
  ].filter(Boolean).join(' ')
  const role = node.message === undefined
    ? toolNameOf(node) ?? t('node.noMessage')
    : t(ROLE_LABELS[node.message.role])
  const fullText = nodeFullText(node)
  const toggleLabel = expanded ? t('node.collapse') : t('node.expand')
  const primaryOwner = owners.at(-1) ?? owners[0]

  return (
    <div
      className={classes}
      data-node-id={node.nodeId}
      data-session-tree-row={rowKey}
      data-session-owners={owners.join(' ')}
      data-session-owner={primaryOwner}
      data-placeholder={placeholder}
    >
      {hasChildren ? (
        <button
          type="button"
          className={css.expander}
          aria-expanded={expanded}
          aria-label={`${toggleLabel} — ${node.summary}`}
          title={toggleLabel}
          onClick={() => { onToggleNode(rowKey) }}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <span className={css.expanderPlaceholder} aria-hidden="true" />
      )}
      <Graph row={{ node, lane, parentLane, continues }} selected={selected} onActivePath={onActivePath} />
      <div className={css.nodeContent}>
        {badges.map(badge => {
          const branchExpanded = !branchCollapsed.has(badge.collapseKey)
          const branchToggleLabel = branchExpanded ? t('branch.tree.collapse') : t('branch.tree.expand')
          const badgeContents = (
            <>
              <span className={badgeClass(badge)}>{badgeText(badge, t)}</span>
              {badge.branchLabel === undefined ? null : <span className={css.branchChip}>{badge.branchLabel}</span>}
              {badge.current ? <span className={css.currentChip}>{t('branch.tree.current')}</span> : null}
              {badge.running ? <span className={css.runningDot} /> : null}
            </>
          )
          return (
            <div className={css.branchBadgeLine} key={`${badge.sessionId}:${badge.collapseKey}`}>
              {badge.hasChildren ? (
                <button
                  type="button"
                  className={css.branchBadgeButton}
                  aria-expanded={branchExpanded}
                  aria-label={`${branchToggleLabel} — ${badge.title}`}
                  title={branchToggleLabel}
                  onClick={() => { onToggleBranch(badge.collapseKey) }}
                >
                  {badgeContents}
                </button>
              ) : (
                <span className={css.branchBadgeStatic}>{badgeContents}</span>
              )}
            </div>
          )
        })}
        <button
          type="button"
          className={css.select}
          disabled={pending || placeholder !== undefined}
          aria-pressed={selectorMode ? undefined : selected}
          aria-label={`${selectorMode ? t('fork.selector.select') : t('panel.select')} — ${node.summary}`}
          title={`${selectorMode ? t('fork.selector.select') : t('panel.select')} — ${node.nodeId}`}
          onClick={() => {
            if (selectorMode) onForkUserPrompt(node)
            else onSelect(rowKey, node)
          }}
        >
          <span className={css.nodeTopline}>
            <span className={css.role}>{role}</span>
            <span className={css.branch}>{node.branch}</span>
            {heads.length > 0 ? <span className={css.head}>{heads.join(', ')}</span> : null}
          </span>
          <span className={css.summary}>
            {placeholder === undefined ? fullText : <PlaceholderText kind={placeholder} t={t} />}
          </span>
        </button>
      </div>
      {showFork ? (
        <button
          type="button"
          className={css.forkAction}
          disabled={pending || selectorMode}
          title={t('panel.fork')}
          aria-label={`${t('panel.fork')} — ${node.nodeId}`}
          onClick={() => { onFork(node) }}
        >
          ⑂
        </button>
      ) : <span className={css.forkActionPlaceholder} aria-hidden="true" />}
    </div>
  )
}

function PanelHeader({
  title,
  branchCount,
  nodeCount,
  pending,
  onRefresh,
  onClose,
  t,
}: {
  title: string
  branchCount: number
  nodeCount: number
  pending: boolean
  onRefresh: () => void
  onClose?: () => void
  t: (key: SessionTreeKey) => string
}) {
  return (
    <header className={css.header}>
      <div className={css.heading}>
        <span className={css.title}>{title}</span>
        <span className={css.stats}>{branchCount} {t('panel.branch')} · {nodeCount} {t('panel.nodes')}</span>
      </div>
      <div className={css.headerActions}>
        <button type="button" className={css.refresh} disabled={pending} onClick={onRefresh}>
          {t('panel.refresh')}
        </button>
        {onClose === undefined ? null : (
          <button type="button" className={css.close} aria-label={t('panel.close')} onClick={onClose}>×</button>
        )}
      </div>
    </header>
  )
}

type MergedSessionTreePanelProps = SessionTreeViewProps & PropsLocale<'session-tree'> & {
  readonly useSessions: NonNullable<SessionTreeViewProps['useSessions']>
  readonly openSession: NonNullable<SessionTreeViewProps['openSession']>
  readonly jumpSession: NonNullable<SessionTreeViewProps['jumpSession']>
}

function MergedSessionTreePanel({
  closeDetails = () => {},
  sessionId,
  load,
  jump,
  jumpSession,
  select,
  fork,
  forkUserPrompt,
  onRefresh,
  useSessions,
  openSession,
  onForkCompleted,
  lineage,
  t,
}: MergedSessionTreePanelProps) {
  const listState = useSessions(state => state)
  const entries = useSyncExternalStore(
    lineage?.subscribe ?? NOOP_SUBSCRIBE,
    lineage?.getSnapshot ?? EMPTY_LINEAGE_SNAPSHOT,
    lineage?.getSnapshot ?? EMPTY_LINEAGE_SNAPSHOT,
  )
  const [views, setViews] = useState<ReadonlyMap<SessionId, SessionTreeView>>(() => new Map())
  const [failed, setFailed] = useState<ReadonlySet<SessionId>>(() => new Set())
  const [nodeCollapsed, setNodeCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [branchCollapsed, setBranchCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedMessages, setExpandedMessages] = useState<ReadonlySet<string>>(() => new Set())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const topology = useMemo(
    () => buildBranchTreeModel(sessionId, listState, entries),
    [sessionId, listState, entries],
  )
  const projectedViews = useMemo(
    () => new Map([...views].map(([id, view]) => [id, projectVisibleView(view)])),
    [views],
  )
  const model = useMemo(
    () => topology === null ? null : buildSessionGraphModel(topology, projectedViews, failed),
    [topology, projectedViews, failed],
  )

  const reload = useCallback(async (ids: readonly SessionId[]): Promise<void> => {
    if (ids.length === 0) return
    const token = ++generation.current
    setFailed(new Set())
    const settled = await Promise.allSettled(ids.map(id => load(id)))
    if (token !== generation.current) return

    const nextViews = new Map<SessionId, SessionTreeView>()
    const nextFailed = new Set<SessionId>()
    settled.forEach((result, index) => {
      const id = ids[index]
      if (id === undefined) return
      if (result.status === 'fulfilled') nextViews.set(id, result.value)
      else nextFailed.add(id)
    })
    setViews(current => {
      const next = new Map(current)
      for (const [id, view] of nextViews) next.set(id, view)
      return next
    })
    setFailed(nextFailed)
  }, [load])

  // Session-list or lineage identity changes invalidate the pending token,
  // debounce, then fan out one load per Session.
  useEffect(() => {
    if (topology === null) return
    const ids = topology.rows.map(row => row.sessionId)
    const timer = window.setTimeout(() => { void reload(ids) }, FAN_OUT_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      generation.current += 1
    }
  }, [entries, topology, reload])

  useEffect(() => onRefresh?.(() => {
    if (topology === null) return
    void reload(topology.rows.map(row => row.sessionId))
  }), [onRefresh, reload, topology])

  // A newly arrived Session/branch starts expanded. Collapse state is a view
  // preference, so it is safe to reset when the graph gains new topology.
  const previousSessionKey = useRef<string | null>(null)
  useEffect(() => {
    if (model === null) return
    const nextKey = model.sessionIds.join('\u0000')
    const previous = previousSessionKey.current
    previousSessionKey.current = nextKey
    if (previous === null || previous === nextKey) return
    const previousIds = new Set(previous === '' ? [] : previous.split('\u0000'))
    if (!model.sessionIds.some(id => !previousIds.has(id))) return
    setNodeCollapsed(new Set())
    setBranchCollapsed(new Set())
  }, [model])

  const previousLineageSize = useRef(entries.size)
  useEffect(() => {
    const previous = previousLineageSize.current
    previousLineageSize.current = entries.size
    if (entries.size <= previous) return
    setNodeCollapsed(new Set())
    setBranchCollapsed(new Set())
  }, [entries])

  // Switching the open Session reveals its ancestor branches without user
  // action, so the new active path is always visible.
  const previousHighlighted = useRef<SessionId | undefined>(undefined)
  useEffect(() => {
    if (model === null) return
    const previous = previousHighlighted.current
    previousHighlighted.current = model.highlightedId
    if (previous === undefined || previous === model.highlightedId) return
    setBranchCollapsed(current => {
      const next = new Set(current)
      let changed = false
      for (const key of model.activeBranchKeys) {
        if (next.delete(key)) changed = true
      }
      return changed ? next : current
    })
    setNodeCollapsed(current => {
      const next = new Set(current)
      let changed = false
      for (const key of model.activePathKeys) {
        if (next.delete(key)) changed = true
      }
      return changed ? next : current
    })
  }, [model])

  const toggleNode = useCallback((key: string): void => {
    setNodeCollapsed(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const toggleBranch = useCallback((key: string): void => {
    setBranchCollapsed(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const visibleRows = useMemo(() => {
    if (model === null) return []
    const rowByKey = new Map(model.rows.map(row => [row.key, row]))
    const hiddenByNodeCollapse = (row: SessionGraphRow): boolean => {
      const seen = new Set<string>()
      let parentKey = row.parentKey
      while (parentKey !== null && !seen.has(parentKey)) {
        if (nodeCollapsed.has(parentKey)) return true
        seen.add(parentKey)
        parentKey = rowByKey.get(parentKey)?.parentKey ?? null
      }
      return false
    }
    return model.rows.filter(row => {
      if (hiddenByNodeCollapse(row)) return false
      for (const collapseKey of branchCollapsed) {
        const keepsBranchAnchorVisible = row.badges.some(badge => badge.collapseKey === collapseKey)
        if (!keepsBranchAnchorVisible && row.branchKeys.includes(collapseKey)) return false
      }
      return true
    })
  }, [branchCollapsed, model, nodeCollapsed])

  const reloadCurrent = useCallback((): void => {
    if (model === null) return
    void reload(model.sessionIds)
  }, [model, reload])

  const handleSelect = useCallback(async (rowKey: string, node: TreeNode): Promise<void> => {
    if (pending || node.nodeId.startsWith('__session-tree-')) return
    setExpandedMessages(current => {
      const next = new Set(current)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      return next
    })
    if (model === null) return
    const row = model.rows.find(candidate => candidate.key === rowKey)
    if (row === undefined || row.placeholder !== undefined) return
    const targetSessionId = row.badges.at(-1)?.sessionId ?? row.owners.at(-1)
    if (targetSessionId === undefined) return

    setPending(true)
    setError(null)
    try {
      if (targetSessionId === model.highlightedId) {
        if (select !== undefined) await select(node.nodeId)
        await jump(node.nodeId)
      } else {
        openSession(targetSessionId)
        await jumpSession(targetSessionId, node.nodeId)
      }
      reloadCurrent()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }, [jump, jumpSession, model, openSession, pending, reloadCurrent, select])

  const handleFork = useCallback(async (node: TreeNode): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result: SessionTreeForkView = await fork(node.nodeId, `fork-${Date.now().toString(36)}`)
      onForkCompleted?.(result)
      reloadCurrent()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }, [fork, onForkCompleted, pending, reloadCurrent])

  const handleForkUserPrompt = useCallback(async (node: TreeNode): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      if (forkUserPrompt === undefined) throw new Error('native fork action is unavailable')
      await forkUserPrompt(node)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }, [forkUserPrompt, pending])

  if (model === null) return null

  return (
    <section className={css.panel} aria-label={t('panel.title')}>
      <PanelHeader
        title={t('panel.title')}
        branchCount={model.sessionIds.length}
        nodeCount={model.rows.length}
        pending={pending}
        onRefresh={reloadCurrent}
        onClose={closeDetails}
        t={t}
      />
      <div className={css.legend}><span className={css.legendDot} />{t('panel.selectedHint')}</div>
      <div
        className={css.body}
        aria-busy={model.rows.some(row => row.placeholder === 'loading') || pending}
      >
        {error === null ? null : <p className={css.error}>{t('panel.error')}: {error}</p>}
        {model.rows.length === 0 ? <p className={css.empty}>{t('panel.empty')}</p> : null}
        {visibleRows.map(row => (
          <NodeRow
            key={row.key}
            rowKey={row.key}
            node={row.node}
            lane={row.lane}
            parentLane={row.parentLane}
            continues={row.continues}
            owners={row.owners}
            badges={row.badges}
            placeholder={row.placeholder}
            selected={row.active}
            onActivePath={row.onActivePath}
            branchHeads={views.get(row.owners.at(-1) ?? model.highlightedId)?.branchHeads}
            hasChildren={row.hasChildren}
            expanded={!nodeCollapsed.has(row.key)}
            messageOpen={expandedMessages.has(row.key)}
            selectorMode={false}
            pending={pending}
            showFork={row.placeholder === undefined && row.owners.includes(model.highlightedId)}
            branchCollapsed={branchCollapsed}
            onToggleNode={toggleNode}
            onToggleBranch={toggleBranch}
            onSelect={handleSelect}
            onFork={node => { void handleFork(node) }}
            onForkUserPrompt={node => { void handleForkUserPrompt(node) }}
            t={t}
          />
        ))}
      </div>
    </section>
  )
}

function LegacySessionTreePanel({
  closeDetails = () => {},
  sessionId,
  load,
  jump,
  select,
  fork,
  forkUserPrompt,
  onRefresh,
  useSessions,
  onForkCompleted,
  selectorMode,
  t,
}: SessionTreeViewProps & PropsLocale<'session-tree'> & { selectorMode: boolean }) {
  const [view, setView] = useState<SessionTreeView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [expandedMessages, setExpandedMessages] = useState<ReadonlySet<string>>(() => new Set<string>())

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setView(await load(sessionId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [load, sessionId])

  const sessionListRevision = useSessions?.(state => {
    const ids = Array.isArray(state.ids) ? state.ids : []
    const byId = state.byId ?? {}
    return [
      state.phase ?? '',
      state.current ?? '',
      ids.join('\n'),
      ids.map(id => {
        const row = byId[id]
        return row === undefined ? '' : [row.displayTitle, row.blank, row.running, row.updatedAt].join(':')
      }).join('\n'),
    ].join('|')
  })

  useEffect(() => {
    if (sessionListRevision !== undefined) return
    void refresh()
  }, [refresh, sessionListRevision])
  useEffect(() => onRefresh?.(() => { void refresh() }), [onRefresh, refresh])
  useEffect(() => {
    if (sessionListRevision === undefined) return
    void refresh()
  }, [refresh, sessionListRevision])

  const visibleNodes = useMemo(() => projectVisibleNodes(view?.nodes ?? []), [view?.nodes])
  const displayedNodes = useMemo(
    () => selectorMode ? projectVisibleNodes(visibleNodes, isUserPromptNode) : visibleNodes,
    [selectorMode, visibleNodes],
  )
  const rows = useMemo(() => graphRows(displayedNodes), [displayedNodes])
  const childIds = useMemo(() => {
    const children = new Map<string, string[]>()
    for (const node of displayedNodes) {
      const parentId = node.parentId
      if (parentId === null) continue
      const siblings = children.get(parentId)
      if (siblings === undefined) children.set(parentId, [node.nodeId])
      else siblings.push(node.nodeId)
    }
    return children
  }, [displayedNodes])

  const visibleRows = useMemo(() => {
    if (selectorMode) return rows
    const byId = new Map(displayedNodes.map(node => [node.nodeId, node]))
    const hidden = (node: TreeNode): boolean => {
      const seen = new Set<string>()
      let parentId = node.parentId
      while (parentId !== null && !seen.has(parentId)) {
        if (collapsed.has(parentId)) return true
        seen.add(parentId)
        parentId = byId.get(parentId)?.parentId ?? null
      }
      return false
    }
    return rows.filter(row => !hidden(row.node))
  }, [collapsed, displayedNodes, rows, selectorMode])

  const panelTitle = selectorMode ? t('fork.selector.title') : t('panel.title')
  const handleSelect = useCallback(async (rowKey: string, node: TreeNode) => {
    if (selectorMode) {
      if (pending) return
      setPending(true)
      setError(null)
      try {
        if (forkUserPrompt === undefined) throw new Error('native fork action is unavailable')
        await forkUserPrompt(node)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setPending(false)
      }
      return
    }
    setExpandedMessages(current => {
      const next = new Set(current)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      return next
    })
    if (pending) return
    setPending(true)
    setError(null)
    try {
      if (select !== undefined) await select(node.nodeId)
      await jump(node.nodeId)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }, [forkUserPrompt, jump, pending, refresh, select, selectorMode])

  const handleFork = useCallback(async (node: TreeNode) => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result: SessionTreeForkView = await fork(node.nodeId, `fork-${Date.now().toString(36)}`)
      onForkCompleted?.(result)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }, [fork, onForkCompleted, pending, refresh])

  const toggleNode = useCallback((nodeId: string) => {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  return (
    <section className={css.panel} aria-label={panelTitle}>
      <PanelHeader
        title={panelTitle}
        branchCount={view?.branches.length ?? 0}
        nodeCount={displayedNodes.length}
        pending={pending}
        onRefresh={() => { void refresh() }}
        onClose={closeDetails}
        t={t}
      />
      <div className={css.legend}><span className={css.legendDot} />{t('panel.selectedHint')}</div>
      <div className={css.body} aria-busy={pending}>
        {error === null ? null : <p className={css.error}>{t('panel.error')}: {error}</p>}
        {view !== null && (selectorMode ? displayedNodes.length === 0 : rows.length === 0)
          ? <p className={css.empty}>{selectorMode ? t('fork.selector.empty') : t('panel.empty')}</p>
          : null}
        {visibleRows.map(row => (
          <NodeRow
            key={row.node.nodeId}
            rowKey={row.node.nodeId}
            node={row.node}
            lane={row.lane}
            parentLane={row.parentLane}
            continues={row.continues}
            owners={[]}
            badges={[]}
            placeholder={undefined}
            selected={row.node.nodeId === view?.selectedNodeId}
            onActivePath={false}
            branchHeads={view?.branchHeads}
            hasChildren={(childIds.get(row.node.nodeId)?.length ?? 0) > 0}
            expanded={!collapsed.has(row.node.nodeId)}
            messageOpen={expandedMessages.has(row.node.nodeId)}
            selectorMode={selectorMode}
            pending={pending}
            showFork={!selectorMode}
            branchCollapsed={EMPTY_COLLAPSED}
            onToggleNode={toggleNode}
            onToggleBranch={() => {}}
            onSelect={handleSelect}
            onFork={node => { void handleFork(node) }}
            onForkUserPrompt={node => { void handleSelect(row.node.nodeId, node) }}
            t={t}
          />
        ))}
      </div>
    </section>
  )
}

export function SessionTreePanel(props: SessionTreeViewProps & PropsLocale<'session-tree'>) {
  const modeSnapshot = useSyncExternalStore(
    props.modeController?.subscribe ?? NOOP_SUBSCRIBE,
    props.modeController?.getSnapshot ?? NOOP_GET_MODE_SNAPSHOT,
    props.modeController?.getSnapshot ?? NOOP_GET_MODE_SNAPSHOT,
  )
  const selectorMode = props.mode === 'selectUserPrompt' || modeSnapshot.selectorOpen
  const { useSessions, openSession, jumpSession } = props
  if (!selectorMode && useSessions !== undefined && openSession !== undefined && jumpSession !== undefined) {
    return (
      <MergedSessionTreePanel
        {...props}
        useSessions={useSessions}
        openSession={openSession}
        jumpSession={jumpSession}
      />
    )
  }
  return <LegacySessionTreePanel {...props} selectorMode={selectorMode} />
}

export function SessionTreeDock(props: SessionTreeViewProps & PropsLocale<'session-tree'>) {
  return <SessionTreePanel {...props} />
}

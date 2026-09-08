/**
 * SessionTreePanel fills DeepSeek Harness' right details sidebar. It uses a
 * fixed-width graph gutter (IDEA Git-log style) and a vertically ordered row
 * list, so tree depth can never increase the panel's horizontal width.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionTreeForkView, TreeNode, LlmRole, SessionTreeView } from '@robiteame/dsh-pi-agent-session-tree/client'
import type { SessionTreeViewProps } from './slots.ts'
import type { SessionTreeKey } from './locales.ts'
import css from './SessionTreePanel.module.css'

const ROLE_LABELS: Record<LlmRole, SessionTreeKey> = {
  system: 'node.role.system', user: 'node.role.user', assistant: 'node.role.assistant', tool: 'node.role.tool',
}
const GRAPH_LANES = 3
const LANE_X = [8, 22, 36] as const

interface GraphRow { node: TreeNode; lane: number; parentLane: number | null; continues: readonly number[] }

const EMPTY_MODE_SNAPSHOT = { selectorOpen: false } as const
const NOOP_SUBSCRIBE = (_listener: () => void): (() => void) => () => {}
const NOOP_GET_MODE_SNAPSHOT = (): typeof EMPTY_MODE_SNAPSHOT => EMPTY_MODE_SNAPSHOT

/** Flatten the topology once. Lanes are bounded and reused; depth never becomes padding. */
function graphRows(nodes: readonly TreeNode[]): GraphRow[] {
  const children = new Map<string | null, TreeNode[]>()
  for (const node of nodes) {
    const siblings = children.get(node.parentId)
    if (siblings === undefined) children.set(node.parentId, [node])
    else siblings.push(node)
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const rows: GraphRow[] = []
  const visit = (parentId: string | null, parentLane: number | null, lane: number, ancestors: ReadonlySet<string>) => {
    const siblings = children.get(parentId) ?? []
    siblings.forEach((node, index) => {
      if (ancestors.has(node.nodeId)) return
      const nodeLane = parentId === null ? 0 : index === 0 ? lane : (lane + index) % GRAPH_LANES
      const next = new Set(ancestors); next.add(node.nodeId)
      const continues = parentLane === null ? [] : [parentLane]
      rows.push({ node, lane: nodeLane, parentLane, continues })
      visit(node.nodeId, nodeLane, nodeLane, next)
    })
  }
  visit(null, null, 0, new Set())
  return rows
}

function Graph({ row, active }: { row: GraphRow; active: boolean }) {
  const x = LANE_X[row.lane] ?? LANE_X[0]
  const px = row.parentLane === null ? x : LANE_X[row.parentLane] ?? LANE_X[0]
  return (
    <svg className={css.graph} viewBox="0 0 44 38" aria-hidden="true">
      {row.continues.map(lane => <path key={lane} className={css.rail} d={`M ${LANE_X[lane]} 0 V 38`} />)}
      {row.parentLane === null
        ? <path className={css.edge} d={`M ${x} 19 V 38`} />
        : <path className={css.edge} d={`M ${px} 0 V 9 Q ${px} 19 ${x} 19 V 38`} />}
      <circle className={active ? css.dotActive : css.dot} cx={x} cy="19" r={active ? 5 : 4} />
      <circle className={css.dotCore} cx={x} cy="19" r="1.5" />
    </svg>
  )
}

/** The node's complete message text: structured content parts beat the capped summary. */
function nodeFullText(node: TreeNode): string {
  const parts = node.content
  if (parts === undefined || parts.length === 0) return node.message?.content ?? node.summary
  const lines: string[] = []
  for (const part of parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      const text = part.text.trim()
      if (text !== '') lines.push(text)
    } else if (part.type === 'tool_call') {
      lines.push(`${part.name}(${typeof part.arguments === 'string' ? part.arguments : JSON.stringify(part.arguments)})`)
    } else if (part.type === 'tool_result') {
      const text = part.content.trim()
      if (text !== '') lines.push(text)
    }
  }
  const text = lines.join('\n')
  return text === '' ? node.message?.content ?? node.summary : text
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
  return node.error !== undefined || node.content?.some(part => part.type === 'tool_result' && part.isError === true) === true
}

/** One node row in the right details sidebar: graph dot, role, branch chip,
 * head chip, and a compact one-line preview. Tool interactions render as quiet
 *  gray rows; only a failed call is highlighted, in error red. Hover/focus
 *  expands the preview into a scrollable view of the complete node content. */
function NodeRow({
  row, selected, pending, branchHeads, hasChildren, expanded, selectorMode, onToggle, onSelect, onFork, t,
}: {
  row: GraphRow
  selected: boolean
  pending: boolean
  branchHeads: Record<string, string> | undefined
  hasChildren: boolean
  expanded: boolean
  selectorMode: boolean
  onToggle: (nodeId: string) => void
  onSelect: (node: TreeNode) => void
  onFork: (nodeId: string) => void
  t: (key: SessionTreeKey) => string
}) {
  const { node } = row
  const heads = Object.entries(branchHeads ?? {}).filter(([, id]) => id === node.nodeId).map(([name]) => name)
  const failed = nodeHasError(node)
  const kindClass = failed ? css.nodeError : isToolNode(node) ? css.nodeTool : undefined
  const classes = [css.node, selected ? css.nodeSelected : undefined, kindClass].filter(Boolean).join(' ')
  const role = node.message === undefined ? toolNameOf(node) ?? t('node.noMessage') : t(ROLE_LABELS[node.message.role])
  const fullText = nodeFullText(node)
  return (
    <div className={classes} data-node-id={node.nodeId}>
      {hasChildren ? (
        <button
          type="button"
          className={css.expander}
          aria-expanded={expanded}
          aria-label={`${expanded ? t('node.collapse') : t('node.expand')} — ${node.summary}`}
          title={expanded ? t('node.collapse') : t('node.expand')}
          onClick={() => { onToggle(node.nodeId) }}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <span className={css.expanderPlaceholder} aria-hidden="true" />
      )}
      <Graph row={row} active={selected} />
      <button
        type="button" className={css.select} disabled={pending}
        aria-pressed={selectorMode ? undefined : selected}
        aria-label={`${selectorMode ? t('fork.selector.select') : t('panel.select')} — ${node.summary}`}
        title={`${selectorMode ? t('fork.selector.select') : t('panel.select')} — ${node.nodeId}`}
        onClick={() => { selectorMode ? onFork(node.nodeId) : onSelect(node) }}
      >
        <span className={css.nodeTopline}>
          <span className={css.role}>{role}</span>
          <span className={css.branch}>{node.branch}</span>
          {heads.length > 0 ? <span className={css.head}>{heads.join(', ')}</span> : null}
        </span>
        <span className={css.summary} title={fullText}>{fullText}</span>
      </button>
      <button
        type="button" className={css.forkAction} disabled={pending || selectorMode}
        title={t('panel.fork')} aria-label={`${t('panel.fork')} — ${node.nodeId}`}
        onClick={() => { onFork(node.nodeId) }}
      >⑂</button>
    </div>
  )
}

export function SessionTreePanel({
  closeDetails = () => {},
  sessionId,
  load,
  jump,
  select,
  fork,
  onRefresh,
  mode = 'tree',
  modeController,
  useSessions,
  onForkCompleted,
  t,
}: SessionTreeViewProps & PropsLocale<'session-tree'>) {
  const [view, setView] = useState<SessionTreeView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>())
  const modeSnapshot = useSyncExternalStore(
    modeController?.subscribe ?? NOOP_SUBSCRIBE,
    modeController?.getSnapshot ?? NOOP_GET_MODE_SNAPSHOT,
    modeController?.getSnapshot ?? NOOP_GET_MODE_SNAPSHOT,
  )
  const selectorMode = mode === 'selectUserPrompt' || modeSnapshot.selectorOpen

  const refresh = useCallback(async () => {
    setError(null)
    try { setView(await load(sessionId)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [load, sessionId])

  // Session additions, removals, renames, and activity arrive on the Session
  // list store. A revision string keeps this panel subscribed without letting
  // tree payload identity bypass the normal load() error handling.
  const sessionListRevision = useSessions?.(state => {
    // Optional guards keep older host adapters that only exposed current/byId
    // usable; the current SessionListState always supplies both collections.
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
    // The Session-list revision effect below owns the initial load whenever
    // the reactive store is available; legacy direct consumers without it keep
    // the original one-shot refresh behavior.
    if (sessionListRevision !== undefined) return
    void refresh()
  }, [refresh, sessionListRevision])
  useEffect(() => onRefresh?.(() => { void refresh() }), [onRefresh, refresh])
  useEffect(() => {
    // The first run shares refresh() above; later store revisions force a load.
    if (sessionListRevision === undefined) return
    void refresh()
  }, [refresh, sessionListRevision])

  const rows = useMemo(() => graphRows(view?.nodes ?? []), [view?.nodes])
  const childIds = useMemo(() => {
    const children = new Map<string, string[]>()
    for (const node of view?.nodes ?? []) {
      const parentId = node.parentId
      if (parentId === null) continue
      const siblings = children.get(parentId)
      if (siblings === undefined) children.set(parentId, [node.nodeId])
      else siblings.push(node.nodeId)
    }
    return children
  }, [view?.nodes])

  const visibleRows = useMemo(() => {
    if (!selectorMode) return rows
    return rows.filter(row => row.node.message?.role === 'user')
  }, [rows, selectorMode])
  const panelTitle = selectorMode ? t('fork.selector.title') : t('panel.title')

  const hasCollapsedAncestor = useCallback((node: TreeNode): boolean => {
    let parent = node.parentId
    while (parent !== null) {
      if (collapsed.has(parent)) return true
      parent = view?.nodes.find(candidate => candidate.nodeId === parent)?.parentId ?? null
    }
    return false
  }, [collapsed, view?.nodes])

  const handleSelect = useCallback(async (node: TreeNode) => {
    if (pending) return
    setPending(true); setError(null)
    try { if (select !== undefined) await select(node.nodeId); await jump(node.nodeId); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }, [jump, pending, refresh])
  const handleFork = useCallback(async (nodeId: string) => {
    if (pending) return
    setPending(true); setError(null)
    try {
      const result: SessionTreeForkView = await fork(nodeId, `fork-${Date.now().toString(36)}`)
      onForkCompleted?.(result)
      await refresh()
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
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
      <header className={css.header}>
        <div className={css.heading}>
          <span className={css.title}>{panelTitle}</span>
          <span className={css.stats}>{view?.branches.length ?? 0} {t('panel.branch')} · {view?.nodes.length ?? 0} {t('panel.nodes')}</span>
        </div>
        <div className={css.headerActions}>
          <button type="button" className={css.refresh} disabled={pending} onClick={() => { void refresh() }}>{t('panel.refresh')}</button>
          <button type="button" className={css.close} aria-label={t('panel.close')} onClick={closeDetails}>×</button>
        </div>
      </header>
      <div className={css.legend}><span className={css.legendDot} />{t('panel.selectedHint')}</div>
      <div className={css.body} aria-busy={pending}>
        {error !== null ? <p className={css.error}>{t('panel.error')}: {error}</p> : null}
        {view !== null && (selectorMode
          ? !visibleRows.some(row => row.node.message?.role === 'user')
          : rows.length === 0)
          ? <p className={css.empty}>{selectorMode ? t('fork.selector.empty') : t('panel.empty')}</p>
          : null}
        {visibleRows.filter(row => selectorMode || !hasCollapsedAncestor(row.node)).map((row: GraphRow) => (
          <NodeRow key={row.node.nodeId} row={row} selected={row.node.nodeId === view?.selectedNodeId} pending={pending}
            branchHeads={view?.branchHeads} onSelect={node => { void handleSelect(node) }}
            hasChildren={(childIds.get(row.node.nodeId)?.length ?? 0) > 0}
            expanded={!collapsed.has(row.node.nodeId)}
            selectorMode={selectorMode}
            onToggle={toggleNode}
            onFork={nodeId => { void handleFork(nodeId) }} t={t} />
        ))}
      </div>
    </section>
  )
}

export function SessionTreeDock(props: SessionTreeViewProps & PropsLocale<'session-tree'>) {
  return <SessionTreePanel {...props} />
}

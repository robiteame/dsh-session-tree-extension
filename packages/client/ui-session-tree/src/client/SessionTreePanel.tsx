/**
 * SessionTreePanel fills DeepSeek Harness' right details sidebar. It uses a
 * fixed-width graph gutter (IDEA Git-log style) and a vertically ordered row
 * list, so tree depth can never increase the panel's horizontal width.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { LlmRole, TreeNode, SessionTreeView } from '@deepseek-ai/dsh-pi-agent-session-tree/client'
import type { SessionTreeViewProps } from './slots.ts'
import type { SessionTreeKey } from './locales.ts'
import css from './SessionTreePanel.module.css'

const ROLE_LABELS: Record<LlmRole, SessionTreeKey> = {
  system: 'node.role.system', user: 'node.role.user', assistant: 'node.role.assistant', tool: 'node.role.tool',
}
const GRAPH_LANES = 3
const LANE_X = [8, 22, 36] as const

interface GraphRow { node: TreeNode; lane: number; parentLane: number | null; continues: readonly number[] }

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

function NodeRow({ row, selected, pending, branchHeads, onSelect, onFork, t }: {
  row: GraphRow
  selected: boolean
  pending: boolean
  branchHeads: Record<string, string> | undefined
  onSelect: (node: TreeNode) => void
  onFork: (nodeId: string) => void
  t: (key: SessionTreeKey) => string
}) {
  const { node } = row
  const heads = Object.entries(branchHeads ?? {}).filter(([, id]) => id === node.nodeId).map(([name]) => name)
  const role = node.message === undefined ? t('node.noMessage') : t(ROLE_LABELS[node.message.role])
  return (
    <div className={selected ? `${css.node} ${css.nodeSelected}` : css.node} data-node-id={node.nodeId}>
      <Graph row={row} active={selected} />
      <button
        type="button" className={css.select} disabled={pending}
        aria-pressed={selected} aria-label={`${t('panel.select')} — ${node.summary}`}
        title={`${t('panel.select')} — ${node.nodeId}`}
        onClick={() => { onSelect(node) }}
      >
        <span className={css.nodeTopline}>
          <span className={css.role}>{role}</span>
          <span className={css.branch}>{node.branch}</span>
          {heads.length > 0 ? <span className={css.head}>{heads.join(', ')}</span> : null}
        </span>
        <span className={css.summary}>{node.summary}</span>
      </button>
      <button
        type="button" className={css.forkAction} disabled={pending}
        title={t('panel.fork')} aria-label={`${t('panel.fork')} — ${node.nodeId}`}
        onClick={() => { onFork(node.nodeId) }}
      >⑂</button>
    </div>
  )
}

export function SessionTreePanel({ closeDetails = () => {}, sessionId, load, jump, select, fork, onRefresh, t }: SessionTreeViewProps & PropsLocale<'session-tree'>) {
  const [view, setView] = useState<SessionTreeView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    try { setView(await load(sessionId)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [load, sessionId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => onRefresh?.(() => { void refresh() }), [onRefresh, refresh])

  const rows = useMemo(() => graphRows(view?.nodes ?? []), [view?.nodes])
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
    try { await fork(nodeId, `fork-${Date.now().toString(36)}`); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }, [fork, pending, refresh])

  return (
    <section className={css.panel} aria-label={t('panel.title')}>
      <header className={css.header}>
        <div className={css.heading}>
          <span className={css.title}>{t('panel.title')}</span>
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
        {view !== null && rows.length === 0 ? <p className={css.empty}>{t('panel.empty')}</p> : null}
        {rows.map(row => (
          <NodeRow key={row.node.nodeId} row={row} selected={row.node.nodeId === view?.selectedNodeId} pending={pending}
            branchHeads={view?.branchHeads} onSelect={node => { void handleSelect(node) }}
            onFork={nodeId => { void handleFork(nodeId) }} t={t} />
        ))}
      </div>
    </section>
  )
}

export function SessionTreeDock(props: SessionTreeViewProps & PropsLocale<'session-tree'>) {
  return <SessionTreePanel {...props} />
}

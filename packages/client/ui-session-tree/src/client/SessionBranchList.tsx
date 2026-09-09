/**
 * Left-docked fork branch rail: the `/fork`-created Sessions of the session
 * list, nested under their source Session with indentation, connector rails,
 * and expand/collapse controls.
 *
 * Topology and liveness come exclusively from the official reactive Session
 * list (the native fork API writes each child with `parentId`), so the rail
 * re-renders itself on every list change — no browser refresh. The lineage
 * registry only contributes the `/fork`-versus-`/clone` distinction and the
 * short summary annotation; `/clone` sessions never enter this rail and keep
 * their original sidebar presentation.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionTreeKey } from './locales.ts'
import type { ForkLineageEntry, SessionForkLineage } from './fork-lineage.ts'
import css from './SessionBranchList.module.css'


/** One flattened rail row: a source Session or one `/fork` branch node. */
interface BranchRow {
  readonly sessionId: SessionId
  /** Lineage annotation on `/fork` branch rows; absent on source rows. */
  readonly entry: ForkLineageEntry | null
  readonly depth: number
  /** Last child of its parent — the elbow stops halfway instead of railing on. */
  readonly isLast: boolean
  /** Per ancestor level: whether that ancestor's vertical rail continues below. */
  readonly railContinues: readonly boolean[]
  /** Direct `/fork` branches nested under this row's Session. */
  readonly childCount: number
  readonly title: string
  readonly running: boolean
  readonly current: boolean
}

/** Flatten the live list + lineage annotations into cascade render rows. */
function branchRows(
  state: SessionListState,
  entries: ReadonlyMap<SessionId, ForkLineageEntry>,
): { rows: BranchRow[]; liveBranches: number } {
  const byId = state.byId ?? {}
  const branches = [...entries.values()]
    .filter(entry => Object.prototype.hasOwnProperty.call(byId, entry.childId))
    .sort((a, b) => a.createdAt - b.createdAt)

  const parentOf = (entry: ForkLineageEntry): SessionId =>
    byId[entry.childId]?.parentId ?? entry.parentId

  const childrenByParent = new Map<SessionId, ForkLineageEntry[]>()
  for (const entry of branches) {
    const siblings = childrenByParent.get(parentOf(entry))
    if (siblings === undefined) childrenByParent.set(parentOf(entry), [entry])
    else siblings.push(entry)
  }

  const isBranch = new Set(branches.map(entry => entry.childId))
  const rows: BranchRow[] = []
  const rowOf = (sessionId: SessionId, entry: ForkLineageEntry | null, depth: number, isLast: boolean, railContinues: readonly boolean[]): BranchRow => {
    const summary = byId[sessionId]
    const childCount = childrenByParent.get(sessionId)?.length ?? 0
    const row: BranchRow = {
      sessionId,
      entry,
      depth,
      isLast,
      railContinues,
      childCount,
      // Branch rows lead with the /fork annotation; source rows show their
      // ordinary list title.
      title: entry?.summary ?? summary?.displayTitle ?? sessionId,
      running: summary?.running === true,
      current: state.current === sessionId,
    }
    rows.push(row)
    return row
  }

  const visit = (sessionId: SessionId, entry: ForkLineageEntry | null, depth: number, isLast: boolean, railContinues: readonly boolean[], ancestors: ReadonlySet<SessionId>) => {
    if (ancestors.has(sessionId)) return
    rowOf(sessionId, entry, depth, isLast, railContinues)
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(sessionId)
    const children = childrenByParent.get(sessionId) ?? []
    children.forEach((child, index) => {
      visit(
        child.childId,
        child,
        depth + 1,
        index === children.length - 1,
        [...railContinues, !isLast],
        nextAncestors,
      )
    })
  }

  const ids = Array.isArray(state.ids) ? state.ids : Object.keys(byId) as SessionId[]
  const roots = ids.filter(id => !isBranch.has(id) && (childrenByParent.get(id)?.length ?? 0) > 0)
  roots.forEach((id, index) => {
    visit(id, null, 0, index === roots.length - 1, [], new Set())
  })

  // Branch children whose source Session is outside the live list (deleted or
  // another workspace) still render, as depth-0 cascade roots of their own.
  const orphans = branches.filter(entry => !roots.includes(parentOf(entry)) && !isBranch.has(parentOf(entry)))
  orphans.forEach((entry, index) => {
    visit(entry.childId, entry, 0, index === orphans.length - 1, [], new Set())
  })

  return { rows, liveBranches: branches.length }
}

function BranchRowView({
  row, expanded, pending, onToggle, onOpen, t,
}: {
  row: BranchRow
  expanded: boolean
  pending: boolean
  onToggle: (sessionId: SessionId) => void
  onOpen: (sessionId: SessionId) => void
  t: (key: SessionTreeKey) => string
}) {
  const classes = [css.row, row.current ? css.rowCurrent : undefined].filter(Boolean).join(' ')
  return (
    <li className={classes} data-branch-session-id={row.sessionId} data-branch-depth={row.depth}>
      {row.railContinues.map((continues, level) => (
        <span key={level} className={[css.cell, continues ? css.cellRail : undefined].filter(Boolean).join(' ')} aria-hidden="true" />
      ))}
      {row.depth > 0 ? (
        <span className={[css.cell, css.cellElbow, row.isLast ? css.cellElbowLast : undefined].filter(Boolean).join(' ')} aria-hidden="true">
          <span className={css.elbowDot} />
        </span>
      ) : null}
      {row.childCount > 0 ? (
        <button
          type="button"
          className={css.expander}
          aria-expanded={expanded}
          aria-label={`${expanded ? t('node.collapse') : t('node.expand')} — ${row.title}`}
          title={expanded ? t('node.collapse') : t('node.expand')}
          onClick={() => { onToggle(row.sessionId) }}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <span className={css.expanderPlaceholder} aria-hidden="true" />
      )}
      <button
        type="button" className={css.select} disabled={pending}
        aria-label={`${t('branch.node.open')} — ${row.title}`}
        aria-current={row.current ? 'true' : undefined}
        title={row.title}
        onClick={() => { onOpen(row.sessionId) }}
      >
        <span className={css.topline}>
          {row.entry !== null ? <span className={css.forkBadge}>⑂ {t('branch.node.forkBadge')}</span> : null}
          {row.entry?.branch !== undefined ? <span className={css.branchChip}>{row.entry.branch}</span> : null}
          {row.entry === null && row.childCount > 0 ? <span className={css.countChip}>{t('branch.node.forkBadge')} ×{row.childCount}</span> : null}
          {row.running ? <span className={css.runningDot} /> : null}
        </span>
        <span className={css.summary}>{row.title}</span>
      </button>
    </li>
  )
}

export type SessionBranchListProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'session-tree'>
  & {
    /** `/fork` annotation registry shared with the fork completion wiring. */
    lineage: SessionForkLineage
    /** Open one Session through the official Session Controller. */
    openSession: (sessionId: SessionId) => void
  }

/**
 * Additive left-docked rail on the `shell.overlay` seat. The root stays
 * click-through; only the rail and its reopen tab accept pointer input, so
 * nothing underneath the layer is blocked while the rail is closed.
 */
export function SessionBranchList({
  lineage,
  openSession,
  useSessions,
  t,
}: SessionBranchListProps) {
  const entries = useSyncExternalStore(lineage.subscribe, lineage.getSnapshot, lineage.getSnapshot)
  const state = useSessions(listState => listState)
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<SessionId>>(() => new Set())

  // A completed /fork must reveal the branch without a refresh: growing the
  // lineage opens the rail and re-expands every source row.
  const previousSize = useRef(entries.size)
  useEffect(() => {
    if (entries.size > previousSize.current) {
      setOpen(true)
      setCollapsed(new Set())
    }
    previousSize.current = entries.size
  }, [entries.size])

  const { rows, liveBranches } = useMemo(() => branchRows(state, entries), [state, entries])

  // Rows are DFS-ordered, so a collapsed row hides exactly the run of deeper
  // rows that follows it.
  const visibleRows = useMemo(() => {
    const visible: BranchRow[] = []
    let skipDepth = 0
    for (const row of rows) {
      if (skipDepth > 0 && row.depth >= skipDepth) continue
      skipDepth = 0
      visible.push(row)
      if (collapsed.has(row.sessionId)) skipDepth = row.depth + 1
    }
    return visible
  }, [rows, collapsed])

  if (liveBranches === 0) return null

  const toggle = (sessionId: SessionId) => {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  return (
    <div className={css.railRoot} data-session-branch-rail="mounted" data-open={open || undefined}>
      {open ? (
        <aside className={css.rail} aria-label={t('branch.rail.title')}>
          <header className={css.header}>
            <div className={css.heading}>
              <span className={css.title}>{t('branch.rail.title')}</span>
              <span className={css.stats}>{liveBranches} {t('branch.node.forkBadge')}</span>
            </div>
            <button
              type="button" className={css.close} aria-label={t('branch.rail.close')}
              onClick={() => { setOpen(false) }}
            >×</button>
          </header>
          <ul className={css.body}>
            {visibleRows.map(row => (
              <BranchRowView
                key={row.sessionId}
                row={row}
                expanded={!collapsed.has(row.sessionId)}
                pending={false}
                onToggle={toggle}
                onOpen={openSession}
                t={t}
              />
            ))}
            {rows.length === 0 ? <li className={css.empty}>{t('branch.rail.empty')}</li> : null}
          </ul>
        </aside>
      ) : (
        <button
          type="button" className={css.railTab}
          aria-label={t('branch.rail.open')}
          title={t('branch.rail.open')}
          onClick={() => { setOpen(true) }}
        >⑂</button>
      )}
    </div>
  )
}

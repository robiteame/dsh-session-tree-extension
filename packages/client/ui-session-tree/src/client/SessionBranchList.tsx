/**
 * Inline /fork branch menus for the native session list.
 *
 * The native list owns the source Session row. This component portals one
 * collapsible menu directly after that row, hides the native rows for its
 * /fork descendants, and keeps /clone rows untouched. Topology and liveness
 * come from the official reactive Session list; the lineage registry only
 * distinguishes /fork children from /clone children and supplies the short
 * title annotation.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionTreeKey } from './locales.ts'
import type { ForkLineageEntry, SessionForkLineage } from './fork-lineage.ts'
import css from './SessionBranchList.module.css'

const BRANCH_HOST = '[data-session-tree-branch-host]'
const HIDDEN_ATTRIBUTE = 'data-session-tree-branch-hidden'
const PREVIOUS_DISPLAY_ATTRIBUTE = 'data-session-tree-branch-previous-display'

/** One rendered /fork descendant inside an inline branch menu. */
interface BranchRow {
  readonly sessionId: SessionId
  readonly entry: ForkLineageEntry
  readonly depth: number
  readonly isLast: boolean
  readonly railContinues: readonly boolean[]
  readonly childCount: number
  readonly title: string
  readonly running: boolean
  readonly current: boolean
}

/** One native parent row and the /fork descendants rendered beneath it. */
interface BranchGroup {
  readonly sourceId: SessionId
  readonly sourceTitle: string
  readonly rows: readonly BranchRow[]
}

interface BranchBuild {
  readonly groups: readonly BranchGroup[]
  readonly liveBranches: number
}

interface HiddenRow {
  readonly sessionId: SessionId
  readonly display: string
}

/** Build the inline menus from the live list and /fork annotations. */
function branchGroups(
  state: SessionListState,
  entries: ReadonlyMap<SessionId, ForkLineageEntry>,
): BranchBuild {
  const byId = state.byId ?? {} as Record<SessionId, SessionSummary>
  const branches = [...entries.values()]
    .filter(entry => Object.prototype.hasOwnProperty.call(byId, entry.childId))
    .sort((a, b) => a.createdAt - b.createdAt)

  const parentOf = (entry: ForkLineageEntry): SessionId =>
    byId[entry.childId]?.parentId ?? entry.parentId

  const childrenByParent = new Map<SessionId, ForkLineageEntry[]>()
  for (const entry of branches) {
    const parentId = parentOf(entry)
    const siblings = childrenByParent.get(parentId)
    if (siblings === undefined) childrenByParent.set(parentId, [entry])
    else siblings.push(entry)
  }

  const branchIds = new Set(branches.map(entry => entry.childId))
  const ids = Array.isArray(state.ids) ? state.ids : Object.keys(byId) as SessionId[]
  const groups: BranchGroup[] = []

  for (const sourceId of ids) {
    if (branchIds.has(sourceId)) continue
    const children = childrenByParent.get(sourceId)
    if (children === undefined || children.length === 0) continue

    const rows: BranchRow[] = []
    const visit = (
      parentId: SessionId,
      depth: number,
      railContinues: readonly boolean[],
      ancestors: ReadonlySet<SessionId>,
    ): void => {
      const siblings = childrenByParent.get(parentId) ?? []
      siblings.forEach((entry, index) => {
        if (ancestors.has(entry.childId)) return
        const isLast = index === siblings.length - 1
        const summary = byId[entry.childId]
        rows.push({
          sessionId: entry.childId,
          entry,
          depth,
          isLast,
          railContinues,
          childCount: childrenByParent.get(entry.childId)?.length ?? 0,
          title: entry.summary ?? summary?.displayTitle ?? entry.childId,
          running: summary?.running === true,
          current: state.current === entry.childId,
        })
        const nextAncestors = new Set(ancestors)
        nextAncestors.add(entry.childId)
        visit(entry.childId, depth + 1, [...railContinues, !isLast], nextAncestors)
      })
    }
    visit(sourceId, 1, [], new Set([sourceId]))
    groups.push({
      sourceId,
      sourceTitle: byId[sourceId]?.displayTitle ?? sourceId,
      rows,
    })
  }

  return { groups, liveBranches: branches.length }
}

/** Normalize one native row's text for title matching. */
function normalizedText(value: string | null): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim()
}

/** Score a native row against one Session title. */
function titleScore(rowText: string, displayTitle: string): number {
  const title = normalizedText(displayTitle)
  if (title === '') return 0
  if (rowText === title) return 10_000 + title.length
  if (rowText.startsWith(title)) return 8_000 + title.length
  if (rowText.includes(title)) return 6_000 + title.length
  if (title.includes(rowText) && rowText.length > 1) return 4_000 + rowText.length
  return 0
}

/** Return the native session rows, excluding search-result buttons. */
function nativeSessionRows(): HTMLElement[] {
  if (typeof document === 'undefined') return []
  return [...document.querySelectorAll<HTMLElement>(
    'div[role="tree"] div[role="treeitem"][aria-selected]',
  )].filter(row => row.closest(BRANCH_HOST) === null)
}

/**
 * Match native rows to Session ids. Previous DOM identity wins, followed by
 * the selected row, title scoring, and finally rendered-order pairing.
 */
function matchNativeRows(
  rows: readonly HTMLElement[],
  state: SessionListState,
  previous: WeakMap<HTMLElement, SessionId>,
): Map<HTMLElement, SessionId> {
  const byId = state.byId ?? {} as Record<SessionId, SessionSummary>
  const ids = (Array.isArray(state.ids) ? state.ids : Object.keys(byId) as SessionId[])
    .filter(id => byId[id] !== undefined)
  const remaining = new Set(ids)
  const matched = new Map<HTMLElement, SessionId>()

  for (const row of rows) {
    const id = previous.get(row)
    if (id === undefined || !remaining.has(id)) continue
    matched.set(row, id)
    remaining.delete(id)
  }

  if (state.current !== undefined && remaining.has(state.current)) {
    const currentRow = rows.find(row =>
      !matched.has(row) && row.getAttribute('aria-selected') === 'true')
    if (currentRow !== undefined) {
      matched.set(currentRow, state.current)
      remaining.delete(state.current)
    }
  }

  const candidates: Array<{ row: HTMLElement; id: SessionId; score: number }> = []
  for (const row of rows) {
    if (matched.has(row)) continue
    const rowText = normalizedText(row.textContent)
    for (const id of remaining) {
      const score = titleScore(rowText, byId[id]?.displayTitle ?? id)
      if (score > 0) candidates.push({ row, id, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  for (const candidate of candidates) {
    if (matched.has(candidate.row) || !remaining.has(candidate.id)) continue
    matched.set(candidate.row, candidate.id)
    remaining.delete(candidate.id)
  }

  const freeRows = rows.filter(row => !matched.has(row))
  const freeIds = ids.filter(id => remaining.has(id))
  const pairCount = Math.min(freeRows.length, freeIds.length)
  for (let index = 0; index < pairCount; index++) {
    const row = freeRows[index]
    const id = freeIds[index]
    if (row === undefined || id === undefined) continue
    matched.set(row, id)
  }

  for (const [row, id] of matched) previous.set(row, id)
  return matched
}

function sameHosts(
  left: ReadonlyMap<SessionId, HTMLElement>,
  right: ReadonlyMap<SessionId, HTMLElement>,
): boolean {
  if (left.size !== right.size) return false
  for (const [id, host] of left) {
    if (right.get(id) !== host) return false
  }
  return true
}

function visibleRows(
  rows: readonly BranchRow[],
  collapsed: ReadonlySet<SessionId>,
): BranchRow[] {
  const visible: BranchRow[] = []
  let skipDepth = 0
  for (const row of rows) {
    if (skipDepth > 0 && row.depth >= skipDepth) continue
    skipDepth = 0
    visible.push(row)
    if (collapsed.has(row.sessionId)) skipDepth = row.depth + 1
  }
  return visible
}

function BranchRowView({
  row,
  expanded,
  onToggle,
  onOpen,
  t,
}: {
  row: BranchRow
  expanded: boolean
  onToggle: (sessionId: SessionId) => void
  onOpen: (sessionId: SessionId) => void
  t: (key: SessionTreeKey) => string
}) {
  const classes = [css.row, row.current ? css.rowCurrent : undefined].filter(Boolean).join(' ')
  const toggleLabel = expanded ? t('node.collapse') : t('node.expand')
  return (
    <li
      className={classes}
      data-branch-session-id={row.sessionId}
      data-branch-depth={row.depth}
    >
      {row.railContinues.map((continues, level) => (
        <span
          key={level}
          className={[css.cell, continues ? css.cellRail : undefined].filter(Boolean).join(' ')}
          aria-hidden="true"
        />
      ))}
      <span
        className={[css.cell, css.cellElbow, row.isLast ? css.cellElbowLast : undefined]
          .filter(Boolean)
          .join(' ')}
        aria-hidden="true"
      >
        <span className={css.elbowDot} />
      </span>
      {row.childCount > 0 ? (
        <button
          type="button"
          className={css.expander}
          aria-expanded={expanded}
          aria-label={`${toggleLabel} - ${row.title}`}
          title={toggleLabel}
          onClick={() => { onToggle(row.sessionId) }}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M4 2l4 4-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <span className={css.expanderPlaceholder} aria-hidden="true" />
      )}
      <button
        type="button"
        className={css.select}
        aria-label={`${t('branch.node.open')} - ${row.title}`}
        aria-current={row.current ? 'true' : undefined}
        title={row.title}
        onClick={() => { onOpen(row.sessionId) }}
      >
        <span className={css.topline}>
          <span className={css.forkBadge}>{t('branch.node.forkBadge')}</span>
          {row.entry.branch === undefined
            ? null
            : <span className={css.branchChip}>{row.entry.branch}</span>}
          {row.running ? <span className={css.runningDot} /> : null}
        </span>
        <span className={css.summary}>{row.title}</span>
      </button>
    </li>
  )
}

function BranchMenu({
  group,
  expanded,
  collapsed,
  onToggle,
  onOpen,
  t,
}: {
  group: BranchGroup
  expanded: boolean
  collapsed: ReadonlySet<SessionId>
  onToggle: (sessionId: SessionId) => void
  onOpen: (sessionId: SessionId) => void
  t: (key: SessionTreeKey) => string
}) {
  const toggleLabel = expanded ? t('branch.menu.collapse') : t('branch.menu.expand')
  const rows = expanded ? visibleRows(group.rows, collapsed) : []
  return (
    <ul className={css.menu} data-session-tree-branch-menu={group.sourceId}>
      <li className={css.menuHeaderItem}>
        <button
          type="button"
          className={css.menuToggle}
          aria-expanded={expanded}
          aria-label={`${toggleLabel} - ${group.sourceTitle}`}
          title={toggleLabel}
          onClick={() => { onToggle(group.sourceId) }}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M4 2l4 4-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className={css.menuTitle}>{t('branch.menu.title')}</span>
          <span className={css.countChip}>
            {t('branch.node.forkBadge')} x{group.rows.length}
          </span>
        </button>
      </li>
      {rows.map(row => (
        <BranchRowView
          key={row.sessionId}
          row={row}
          expanded={!collapsed.has(row.sessionId)}
          onToggle={onToggle}
          onOpen={onOpen}
          t={t}
        />
      ))}
    </ul>
  )
}

export type SessionBranchListProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'session-tree'>
  & {
    /** /fork annotation registry shared with the fork completion wiring. */
    lineage: SessionForkLineage
    /** Open one Session through the official Session Controller. */
    openSession: (sessionId: SessionId) => void
  }

/**
 * Portal inline /fork menus into the native session list. The component
 * renders no root DOM of its own; it keeps observers and hooks mounted while
 * no branches exist so the first fork appears without a refresh.
 */
export function SessionBranchList({
  lineage,
  openSession,
  useSessions,
  t,
}: SessionBranchListProps) {
  const entries = useSyncExternalStore(lineage.subscribe, lineage.getSnapshot, lineage.getSnapshot)
  const state = useSessions(listState => listState)
  const [collapsed, setCollapsed] = useState<ReadonlySet<SessionId>>(() => new Set())
  const [hosts, setHosts] = useState<ReadonlyMap<SessionId, HTMLElement>>(() => new Map())
  const hostsRef = useRef<ReadonlyMap<SessionId, HTMLElement>>(hosts)
  const hiddenRows = useRef(new Map<HTMLElement, HiddenRow>())
  const matchedRows = useRef(new WeakMap<HTMLElement, SessionId>())
  const rebuildRef = useRef<() => void>(() => {})

  const { groups, liveBranches } = useMemo(
    () => branchGroups(state, entries),
    [state, entries],
  )

  const previousSize = useRef(entries.size)
  useEffect(() => {
    if (entries.size > previousSize.current) setCollapsed(new Set())
    previousSize.current = entries.size
  }, [entries.size])

  const restoreHiddenRows = (): void => {
    for (const [row, hidden] of hiddenRows.current) {
      if (row.isConnected) {
        row.style.display = hidden.display
        row.removeAttribute(HIDDEN_ATTRIBUTE)
        row.removeAttribute(PREVIOUS_DISPLAY_ATTRIBUTE)
      }
    }
    hiddenRows.current.clear()
  }

  useLayoutEffect(() => {
    const rebuild = (): void => {
      restoreHiddenRows()
      const rows = nativeSessionRows()
      const rowIds = matchNativeRows(rows, state, matchedRows.current)
      const rowById = new Map<SessionId, HTMLElement>()
      for (const [row, id] of rowIds) rowById.set(id, row)

      const nextHosts = new Map<SessionId, HTMLElement>()
      for (const group of groups) {
        const sourceRow = rowById.get(group.sourceId)
        if (sourceRow === undefined || sourceRow.parentElement === null) continue

        let host = hostsRef.current.get(group.sourceId)
        if (host === undefined) {
          host = document.createElement('div')
          host.className = css.host ?? ''
          host.dataset.sessionTreeBranchHost = 'mounted'
        }
        host.dataset.sessionTreeBranchTarget = group.sourceId
        if (
          host.parentElement !== sourceRow.parentElement
          || host.previousElementSibling !== sourceRow
        ) {
          sourceRow.parentElement.insertBefore(host, sourceRow.nextSibling)
        }
        nextHosts.set(group.sourceId, host)
      }

      for (const [sourceId, host] of hostsRef.current) {
        if (!nextHosts.has(sourceId)) host.remove()
      }
      hostsRef.current = nextHosts
      setHosts(current => sameHosts(current, nextHosts) ? current : nextHosts)

      const represented = new Set<SessionId>()
      for (const group of groups) {
        for (const row of group.rows) represented.add(row.sessionId)
      }
      for (const id of represented) {
        const row = rowById.get(id)
        if (row === undefined) continue
        const display = row.style.display
        hiddenRows.current.set(row, { sessionId: id, display })
        row.setAttribute(HIDDEN_ATTRIBUTE, id)
        row.setAttribute(PREVIOUS_DISPLAY_ATTRIBUTE, display)
        row.style.display = 'none'
      }
    }

    rebuildRef.current = rebuild
    rebuild()
    return restoreHiddenRows
  }, [groups, state])

  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return
    const observer = new MutationObserver(mutations => {
      const nativeChange = mutations.some(mutation => {
        const target = mutation.target
        const element = target.nodeType === Node.ELEMENT_NODE
          ? target as Element
          : target.parentElement
        return element?.closest(BRANCH_HOST) === null
      })
      if (nativeChange) rebuildRef.current()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [])

  useLayoutEffect(() => () => {
    restoreHiddenRows()
    for (const host of hostsRef.current.values()) host.remove()
    hostsRef.current = new Map()
  }, [])

  if (typeof document === 'undefined' || liveBranches === 0) return null

  const toggle = (sessionId: SessionId): void => {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  return (
    <>
      {groups.map(group => {
        const host = hosts.get(group.sourceId)
        if (host === undefined) return null
        return createPortal(
          <BranchMenu
            group={group}
            expanded={!collapsed.has(group.sourceId)}
            collapsed={collapsed}
            onToggle={toggle}
            onOpen={openSession}
            t={t}
          />,
          host,
          group.sourceId,
        )
      })}
    </>
  )
}

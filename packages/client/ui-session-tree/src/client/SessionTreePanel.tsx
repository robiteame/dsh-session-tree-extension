/**
 * SessionTreePanel: the docked tree view above the composer. A collapsed
 * strip shows the branch count; expanding renders every node grouped by
 * branch with the cursor highlighted. Clicking a node jumps the tree cursor
 * (the host replays the root-to-node path) and refreshes the view.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { LlmRole, TreeNode, SessionTreeView } from '@deepseek-ai/dsh-pi-agent-session-tree/client'
import type { SessionTreeViewProps } from './slots.ts'
import type { SessionTreeKey } from './locales.ts'
import css from './SessionTreePanel.module.css'

/** A draft that should surface the tree: the composer text begins with /tree. */
const TREE_DRAFT_PREFIX = /^\s*\/tree(?:\s|$)/u

const ROLE_LABELS: Record<LlmRole, SessionTreeKey> = {
  system: 'node.role.system',
  user: 'node.role.user',
  assistant: 'node.role.assistant',
  tool: 'node.role.tool',
}

/**
 * One node row: role, summary, branch chip, and the cursor badge.
 * @param node - the node to render.
 * @param cursor - current cursor id (highlighted when equal to node.nodeId).
 * @param onJump - jump callback for this node.
 */
function NodeRow({
  node, cursor, branchHeads, onJump, onFork, t,
}: {
  node: TreeNode
  cursor: string | null
  pending: boolean
  branchHeads: Record<string, string> | undefined
  onJump: (nodeId: string) => void
  onFork: (nodeId: string) => void
  t: (key: SessionTreeKey) => string
}) {
  const message = node.message
  const headNames = Object.entries(branchHeads ?? {}).filter(([, head]) => head === node.nodeId).map(([name]) => name)
  return (
    <div className={node.nodeId === cursor ? `${css.node} ${css.nodeActive}` : css.node}>
      <button type="button" className={css.jump} disabled={pending} title={`${t('panel.jump')} — ${node.nodeId}`} onClick={() => { onJump(node.nodeId) }}>
        <span className={css.role}>{message === undefined ? t('node.noMessage') : t(ROLE_LABELS[message.role])}</span>
        <span className={css.summary}>{node.summary}</span>
        <span className={css.branch}>{node.branch}</span>
        {node.forkCount !== undefined && node.forkCount > 0 ? <span className={css.forks}>⑂{node.forkCount}</span> : null}
        {headNames.length > 0 ? <span className={css.head} title={`${t('panel.head')}: ${headNames.join(', ')}`}>{headNames.join(', ')}</span> : null}
        {node.nodeId === cursor ? <span className={css.cursor}>{t('panel.cursor')}</span> : null}
      </button>
      <button type="button" className={css.forkAction} disabled={pending} title={t('panel.fork')} aria-label={`${t('panel.fork')} — ${node.nodeId}`} onClick={() => { onFork(node.nodeId) }}>⑂</button>
    </div>
  )
}

/**
 * Recursive tree rows in creation order per parent; nodes with no children
 * render alone. The root list groups everything with parentId === null.
 */
function TreeRows({
  nodes, cursor, pending, branchHeads, onJump, onFork, t,
}: {
  nodes: readonly TreeNode[]
  cursor: string | null
  pending: boolean
  branchHeads: Record<string, string> | undefined
  onJump: (nodeId: string) => void
  onFork: (nodeId: string) => void
  t: (key: SessionTreeKey) => string
}) {
  // Index children by parent once (O(n)) instead of re-filtering `nodes` per
  // parent, so rendering a large tree stays linear in node count.
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, TreeNode[]>()
    for (const node of nodes) {
      const siblings = map.get(node.parentId)
      if (siblings === undefined) map.set(node.parentId, [node])
      else siblings.push(node)
    }
    for (const siblings of map.values()) {
      siblings.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    }
    return map
  }, [nodes])

  const render = (parent: string | null, depth: number, ancestors: ReadonlySet<string> = new Set()) => {
    const children = childrenByParent.get(parent) ?? []
    return children.map(node => {
      if (ancestors.has(node.nodeId)) return null
      const nextAncestors = new Set(ancestors)
      nextAncestors.add(node.nodeId)
      return (
        <div key={node.nodeId} className={depth > 0 ? css.childRow : undefined}>
          <NodeRow node={node} cursor={cursor} pending={pending} branchHeads={branchHeads} onJump={onJump} onFork={onFork} t={t} />
          {render(node.nodeId, depth + 1, nextAncestors)}
        </div>
      )
    })
  }

  return <div className={css.rows}>{render(null, 0)}</div>
}

/** The collapsible dock card. */
export function SessionTreePanel({
  sessionId, load, jump, fork, t, useInput,
}: SessionTreeViewProps & PropsLocale<'session-tree'>) {
  const [view, setView] = useState<SessionTreeView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  // The composer draft is part of the standard kit; auto-expand on /tree.
  const draft = useInput(state => state.draft)
  const treeTyped = TREE_DRAFT_PREFIX.test(draft)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setView(await load(sessionId))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [load, sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // A /tree draft raises the panel until the user collapses it again.
  useEffect(() => {
    if (treeTyped) setOpen(true)
  }, [treeTyped])

  /** Refresh without returning a Promise to a void DOM handler. */
  const refreshNow = (): void => {
    refresh().catch(() => undefined)
  }

  const handleJump = useCallback(async (nodeId: string) => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await jump(nodeId)
      await refresh()
    } catch (jumpError) {
      setError(jumpError instanceof Error ? jumpError.message : String(jumpError))
    } finally {
      setPending(false)
    }
  }, [jump, pending, refresh])

  const handleFork = useCallback(async (nodeId: string) => {
    if (pending) return
    const branch = `fork-${Date.now().toString(36)}`
    setPending(true)
    setError(null)
    try { await fork(nodeId, branch); await refresh() }
    catch (forkError) { setError(forkError instanceof Error ? forkError.message : String(forkError)) }
    finally { setPending(false) }
  }, [fork, pending, refresh])

  const nodeCount = view === null ? 0 : view.nodes.length
  const branchCount = view === null ? 0 : view.branches.length

  return (
    <section className={css.panel} aria-label={t('panel.title')}>
      <header className={css.header}>
        <button
          type="button"
          className={css.toggle}
          aria-expanded={open}
          onClick={() => { setOpen(current => !current) }}
        >
          <span className={css.title}>{t('panel.title')}</span>
          <span className={css.stats}>
            {branchCount} {t('panel.branch')} · {nodeCount} {t('panel.nodes')}
          </span>
          <span className={css.chevron}>{open ? '−' : '+'}</span>
        </button>
        <button type="button" className={css.refresh} onClick={refreshNow}>{t('panel.refresh')}</button>
      </header>
      {open ? (
        <div className={css.body}>
          {error !== null ? <p className={css.error}>{t('panel.error')}: {error}</p> : null}
          {view !== null && nodeCount === 0 ? <p className={css.empty}>{t('panel.empty')}</p> : null}
          {view !== null && nodeCount > 0 ? (
            <TreeRows nodes={view.nodes} cursor={view.cursor} pending={pending} branchHeads={view.branchHeads} onJump={(nodeId) => { handleJump(nodeId).catch(() => undefined) }} onFork={(nodeId) => { handleFork(nodeId).catch(() => undefined) }} t={t} />
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/** Dock entry: the injected face and the standard kit flow straight through. */
export function SessionTreeDock(props: SessionTreeViewProps & PropsLocale<'session-tree'>) {
  return <SessionTreePanel {...props} />
}

/**
 * dsh-session-tree real-browser GUI test rig.
 *
 * Mounts the plugin's actual client components (SessionTreeDock +
 * SessionBranchList) against a Harness-like shell:
 *  - a vanilla-DOM native session list (role=tree/treeitem), as in the real
 *    host — NOT React-owned, so the plugin's portal menus exercise their
 *    imperative DOM path;
 *  - a reactive SessionListState store consumed through the same
 *    useSessions(selector) face the Harness store exposes;
 *  - mock sessionTree remote actions that mutate fixture views and append to
 *    an on-screen call log, so black-box GUI observation can verify what the
 *    plugin called without touching page state.
 *
 * The rig chrome (top bar buttons) simulates Harness commands (/tree /fork
 * /clone) exactly the way the real client/index.ts wires them.
 */
import { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { JumpView, SessionTreeForkView, SessionTreeView, TreeNode } from '../../packages/extensions/pi-agent-session-tree/src/types.ts'
import { SessionBranchList } from '../../packages/client/ui-session-tree/src/client/SessionBranchList.tsx'
import { SessionForkLineage } from '../../packages/client/ui-session-tree/src/client/fork-lineage.ts'
import { SessionTreeDock } from '../../packages/client/ui-session-tree/src/client/SessionTreePanel.tsx'
import { zh } from '../../packages/client/ui-session-tree/src/client/locales.ts'

/* ------------------------------------------------------------------ fixtures */

const seq = (n: number): string => `2026-09-30T10:${String(10 + n).padStart(2, '0')}:00.000Z`

function msg(
  nodeId: string, parentId: string | null, s: number, branch: string, summary: string,
  role: 'user' | 'assistant', content: string, extra: Partial<TreeNode> = {},
): TreeNode {
  return { nodeId, parentId, branch, summary, createdAt: seq(s), message: { role, content }, metadata: { sessionEventSeq: s }, ...extra }
}

function tool(
  nodeId: string, parentId: string | null, s: number, branch: string, summary: string,
  callId: string, name: string, args: string, result: string, isError = false,
): TreeNode {
  return {
    nodeId, parentId, branch, summary, createdAt: seq(s), type: 'tool_call',
    message: { role: 'tool', content: result, toolCallId: callId },
    content: [
      { type: 'tool_call', id: callId, name, arguments: args },
      { type: 'tool_result', toolCallId: callId, content: result, ...(isError ? { isError: true } : {}) },
    ],
    metadata: { sessionEventSeq: s },
  }
}

const LONG_LOG = Array.from({ length: 14 }, (_, i) =>
  `[10:2${i}:5${i}] auth-service GET /api/login upstream=10.10.0.${i + 2} conn=new tls=1.2 rt=${180 + i * 37}ms status=200 retries=0`).join('\n')

// s1 main line — includes a healthy tool call, a failed one, a long paste,
// and a harness-injected user node that must stay hidden from every surface.
const e1 = msg('e1', null, 1, 'main', '帮我排查登录接口为什么偶发超时', 'user',
  '帮我排查登录接口为什么偶发超时。现象：每天早高峰约 5% 请求超过 3s，其余正常。')
const e2 = msg('e2', 'e1', 2, 'main', '我先看一下 auth 服务的日志和最近变更。', 'assistant',
  '我先看一下 auth 服务的日志和最近变更，再决定是否需要压测复现。')
const e3 = tool('e3', 'e2', 3, 'main', 'read_file /var/log/auth.log ✔', 'call-1', 'read_file', '"/var/log/auth.log"', '（日志节选）连接数在 8:50 后突增，TLS 握手占比升高。')
const e4 = tool('e4', 'e3', 4, 'main', 'run_bench wrk -t10 ✘', 'call-2', 'run_bench', '"wrk -t10 -c200 https://stg/login"', 'Error: upstream timeout after 30s（压测失败）', true)
const e5 = msg('e5', 'e4', 5, 'main', '初步结论：连接未复用，每次请求都新建 TCP+TLS。', 'assistant',
  '初步结论：连接未复用，每次请求都新建 TCP+TLS，早高峰握手排队导致长尾。建议先启用 keep-alive 连接池。')
const e6 = msg('e6', 'e5', 6, 'main', '补充：压测日志与网络抓包（长消息）', 'user', `${LONG_LOG}\n\n抓包显示每次请求都是全新的 TCP 流，没有任何复用。`)
const e7 = msg('e7', 'e6', 7, 'main', '建议：连接池 + 指数退避超时。', 'assistant',
  '结合日志与抓包：建议启用连接池（keep-alive 上限 64），超时改为指数退避，并给握手加缓存。')
const e8 = msg('e8', 'e7', 8, 'main', 'skill-catalog 注入（不应出现在任何界面）', 'user',
  '（harness 注入的技能目录上下文，应被面板与选择器隐藏）', { metadata: { sessionEventSeq: 8, injected: true } as Record<string, never> })

// c1 forks s1 at e2 (branch 'alt'); copied prefix reuses identical node objects.
const f1 = msg('f1', 'e2', 3, 'alt', '改成连接池方案试试', 'user', '改成连接池方案试试：keep-alive 上限先设 64。')
const f2 = msg('f2', 'f1', 4, 'alt', '已改配置，压测 QPS 提升约 3 倍。', 'assistant', '已改配置并复测：QPS 3.1k → 9.4k，P99 780ms → 210ms。')

// g1 forks c1 at f1.
const g1a = msg('g1a', 'f1', 4, 'main', '再加一层超时重试', 'user', '在连接池之上再加一层超时重试（最多 2 次）。')
const g1b = msg('g1b', 'g1a', 5, 'main', '重试生效，长尾基本消失。', 'assistant', '重试生效后 3s 以上请求占比降到 0.02%，可以灰度。')

// c2 clones s1's full main line, then continues on its own.
const cl1 = msg('cl1', 'e7', 9, 'main', '继续排查：补上监控埋点', 'user', '继续排查：给连接池命中率和握手耗时补上监控埋点。')
const cl2 = msg('cl2', 'cl1', 10, 'main', '已添加 Prometheus 计数器与直方图。', 'assistant', '已添加 Prometheus 计数器与直方图，面板见 /metrics。')

const view = (sessionId: string, cursor: string, nodes: readonly TreeNode[], branchHeads: Record<string, string>): SessionTreeView => ({
  sessionId, cursor, selectedNodeId: cursor, activeBranch: 'main', branchHeads,
  nodes,
  branches: [{ name: 'main', headId: nodes.at(-1)?.nodeId ?? '', nodeIds: nodes.map(n => n.nodeId) }],
})

/* ------------------------------------------------- reactive session-list store */

interface RigRow { id: string; displayTitle: string; parentId?: string; running: boolean; blank: boolean; updatedAt: number }
interface ListState { phase: 'ready'; current: string; ids: string[]; byId: Record<string, RigRow> }

const lineage = new SessionForkLineage()
const views = new Map<string, SessionTreeView>([
  ['s1', view('s1', 'e7', [e1, e2, e3, e4, e5, e6, e7, e8], { main: 'e7' })],
  ['c1', view('c1', 'f2', [e1, e2, f1, f2], { main: 'f2', alt: 'f2' })],
  ['g1', view('g1', 'g1b', [e1, e2, f1, g1a, g1b], { main: 'g1b' })],
  ['c2', view('c2', 'cl2', [e1, e2, e3, e4, e5, e6, e7, cl1, cl2], { main: 'cl2' })],
])

let listState: ListState = {
  phase: 'ready',
  current: 'g1',
  ids: ['s1', 'c1', 'g1', 'c2', 'bad'],
  byId: {
    s1: { id: 's1', displayTitle: '主会话 · 排查登录超时', running: false, blank: false, updatedAt: 1 },
    c1: { id: 'c1', displayTitle: '分叉 · 改用连接池', parentId: 's1', running: false, blank: false, updatedAt: 2 },
    g1: { id: 'g1', displayTitle: '二次分叉 · 连接池+重试', parentId: 'c1', running: false, blank: false, updatedAt: 4 },
    c2: { id: 'c2', displayTitle: '克隆 · 副本', parentId: 's1', running: false, blank: false, updatedAt: 5 },
    bad: { id: 'bad', displayTitle: '损坏的会话（加载失败）', parentId: 's1', running: false, blank: false, updatedAt: 6 },
  },
}
lineage.record({ childId: 'c1', parentId: 's1', summary: '改成连接池方案试试', branch: 'alt', createdAt: 2 })
lineage.record({ childId: 'g1', parentId: 'c1', summary: '再加一层超时重试', createdAt: 4 })

const listeners = new Set<() => void>()
const emit = (): void => { for (const l of listeners) l() }
const setListState = (next: ListState): void => { listState = next; emit() }

const useStore = (): ListState => useSyncExternalStore(
  (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb) } },
  () => listState,
)
const useSessions = <T,>(select: (state: ListState) => T): T => select(useStore())

/* ------------------------------------------------------------- call log (GUI-visible) */

const callLogList = document.getElementById('calllog-list')!
const log = (text: string): void => {
  const item = document.createElement('li')
  const time = document.createElement('span')
  time.className = 't'
  time.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  item.append(time, document.createTextNode(text))
  callLogList.prepend(item)
  while (callLogList.children.length > 200) callLogList.lastChild?.remove()
}

/* ------------------------------------------------------- native session list (vanilla DOM) */

const nativeList = document.getElementById('native-session-list')!

function renderNativeList(): void {
  const rows = listState.ids.map((id) => {
    const row = listState.byId[id]
    const el = document.createElement('div')
    el.setAttribute('role', 'treeitem')
    el.setAttribute('aria-selected', id === listState.current ? 'true' : 'false')
    el.setAttribute('data-test-session-row', id)
    el.tabIndex = 0
    const title = document.createElement('span')
    title.className = 'native-row-title'
    title.textContent = row?.displayTitle ?? id
    const meta = document.createElement('span')
    meta.className = 'native-row-meta'
    meta.textContent = id === listState.current ? '当前' : (row?.parentId ? `父:${row.parentId}` : '根')
    el.append(title, meta)
    el.addEventListener('click', () => openSession(id))
    return el
  })
  nativeList.replaceChildren(...rows)
}
listeners.add(renderNativeList)
renderNativeList()

/* ------------------------------------------------------------- mock remote actions */

const bump = (): void => setListState({ ...listState, byId: { ...listState.byId } })

function setCursor(sessionId: string, nodeId: string): void {
  const current = views.get(sessionId)
  if (current === undefined) return
  views.set(sessionId, { ...current, cursor: nodeId, selectedNodeId: nodeId })
}

const openSession = (sessionId: string): void => {
  log(`openSession(${sessionId})`)
  setListState({ ...listState, current: sessionId })
}

const load = async (sessionId: string): Promise<SessionTreeView> => {
  if (sessionId === 'bad') {
    log(`list(${sessionId}) → Error: 会话数据损坏（模拟）`)
    throw new Error('会话数据损坏（模拟）')
  }
  const loaded = views.get(sessionId)
  if (loaded === undefined) throw new Error(`no fixture view for ${sessionId}`)
  log(`list(${sessionId}) → ${loaded.nodes.length} nodes`)
  return loaded
}

const jump = async (nodeId: string | null): Promise<JumpView> => {
  log(`jump(${nodeId ?? 'null'})`)
  if (nodeId !== null) setCursor(listState.current, nodeId)
  return { cursor: nodeId, messages: [] }
}

const jumpSession = async (sessionId: string, nodeId: string | null): Promise<JumpView> => {
  log(`jumpSession(${sessionId}, ${nodeId ?? 'null'})`)
  if (nodeId !== null) setCursor(sessionId, nodeId)
  return { cursor: nodeId, messages: [] }
}

const select = async (nodeId: string): Promise<{ nodeId: string }> => {
  log(`select(${nodeId})`)
  return { nodeId }
}

const findOwner = (nodeId: string): string | undefined =>
  [...views.entries()].find(([, v]) => v.nodes.some(n => n.nodeId === nodeId))?.[0]

const fork = async (nodeId: string, branchName: string): Promise<SessionTreeForkView> => {
  const owner = findOwner(nodeId)
  log(`fork(${nodeId}, ${branchName}) — owner=${owner ?? '?'}`)
  const target = views.get(owner ?? '')
  if (target !== undefined && owner !== undefined) {
    const nextId = `n-${branchName}`
    const child: TreeNode = msg(nextId, nodeId, (target.nodes.at(-1)?.metadata?.sessionEventSeq ?? 0) + 1, branchName,
      `新分叉节点（${branchName}）`, 'assistant', `已在节点 ${nodeId} 之下追加分叉节点（演示）。`)
    views.set(owner, { ...target, nodes: [...target.nodes, child] })
    bump()
  }
  return { cursor: nodeId, branch: branchName, forkCount: 1 }
}

let forkCounter = 0
let modeState = { selectorOpen: false }
const modeListeners = new Set<() => void>()
const modeController = {
  subscribe: (l: () => void) => { modeListeners.add(l); return () => { modeListeners.delete(l) } },
  getSnapshot: () => modeState,
}
const setSelectorOpen = (open: boolean): void => {
  modeState = { selectorOpen: open } // 替换身份，useSyncExternalStore 才会感知
  for (const l of modeListeners) l()
}

/** Native user-prompt fork: creates a real child Session + lineage record. */
const forkUserPrompt = async (node: TreeNode): Promise<void> => {
  forkCounter += 1
  const childId = `fk-${forkCounter}`
  log(`forkUserPrompt(${node.nodeId} “${node.summary}”) → 新会话 ${childId}`)
  const source = views.get('s1')!
  // root→node 路径（祖先 + 自身），排除注入节点
  const byId = new Map(source.nodes.map(n => [n.nodeId, n]))
  const pathIds = new Set<string>()
  let cur: TreeNode | undefined = node
  while (cur !== undefined) {
    pathIds.add(cur.nodeId)
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId)
  }
  const prefix = source.nodes.filter(n => pathIds.has(n.nodeId) && n.metadata?.injected !== true)
  views.set(childId, view(childId, node.nodeId, prefix.length > 0 ? prefix : [node], { main: node.nodeId }))
  lineage.record({ childId, parentId: 's1', summary: node.summary, createdAt: Date.now() })
  setListState({
    ...listState,
    ids: [...listState.ids, childId],
    byId: { ...listState.byId, [childId]: { id: childId, displayTitle: `分叉 · ${node.summary.slice(0, 14)}`, parentId: 's1', running: false, blank: false, updatedAt: Date.now() } },
  })
  setSelectorOpen(false)
}

function isAncestorOf(nodes: readonly TreeNode[], candidate: TreeNode, nodeId: string): boolean {
  const byId = new Map(nodes.map(n => [n.nodeId, n]))
  let parent = candidate.parentId === null ? undefined : byId.get(candidate.parentId)
  while (parent !== undefined) {
    if (parent.nodeId === nodeId) return true
    parent = parent.parentId === null ? undefined : byId.get(parent.parentId)
  }
  return false
}

/* --------------------------------------------------------------- rig commands */

const t = (key: string): string => (zh as unknown as Record<string, string>)[key] ?? key

document.getElementById('btn-cmd-tree')!.addEventListener('click', () => {
  log('命令 /tree → sidebarRight.openTab("session-tree")')
  const dock = document.getElementById('dock')!
  dock.style.outline = '2px solid var(--dsw-alias-state-business-primary)'
  window.setTimeout(() => { dock.style.outline = '' }, 600)
})

document.getElementById('btn-cmd-fork')!.addEventListener('click', () => {
  log('命令 /fork → modeController.selectorOpen = true')
  setSelectorOpen(true)
})

let cloneCounter = 0
document.getElementById('btn-cmd-clone')!.addEventListener('click', () => {
  cloneCounter += 1
  const childId = `clone-${cloneCounter}`
  log(`命令 /clone → sessions.fork() → 新会话 ${childId}（克隆子会话保留在原生列表）`)
  const source = views.get('s1')!
  const prefix = source.nodes.filter(n => n.metadata?.injected !== true)
  const tip = msg(`${childId}-tip`, prefix.at(-1)?.nodeId ?? null, 11, 'main', `${childId} 的克隆续写`, 'assistant', '克隆会话续写第一条回复（演示）。')
  views.set(childId, view(childId, tip.nodeId, [...prefix, tip], { main: tip.nodeId }))
  setListState({
    ...listState,
    ids: [...listState.ids, childId],
    byId: { ...listState.byId, [childId]: { id: childId, displayTitle: `克隆 · 副本 ${cloneCounter}`, parentId: 's1', running: false, blank: false, updatedAt: Date.now() } },
  })
})

document.getElementById('btn-theme')!.addEventListener('click', () => {
  const root = document.documentElement
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
  root.dataset.theme = next
  log(`测试台切换主题 → ${next}`)
})

/* ------------------------------------------------------------------- mounts */

function Rig(): JSX.Element {
  return (
    <>
      <SessionBranchList lineage={lineage} openSession={openSession} useSessions={useSessions} t={t} />
      <SessionTreeDock
        sessionId="s1"
        panel="session-tree"
        t={t}
        load={load}
        jump={jump}
        jumpSession={jumpSession}
        select={select}
        fork={fork}
        forkUserPrompt={forkUserPrompt}
        useSessions={useSessions}
        lineage={lineage}
        openSession={openSession}
        modeController={modeController}
        closeDetails={() => { log('closeDetails()') }}
        onForkCompleted={(result: SessionTreeForkView) => { log(`onForkCompleted(branch=${result.branch}, forkCount=${result.forkCount})`) }}
      />
    </>
  )
}

createRoot(document.getElementById('dock')!).render(<Rig />)
log('测试台就绪：已挂载 SessionTreeDock + SessionBranchList（真实插件组件）')

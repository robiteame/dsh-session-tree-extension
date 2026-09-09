// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionTreeView, TreeNode } from '@robiteame/dsh-pi-agent-session-tree/client'
import { zh } from '../src/client/locales.ts'
import { SessionTreeDock } from '../src/client/SessionTreePanel.tsx'
import {
  SessionTreeOverlay,
  SessionTreeOverlayController,
  type SessionTreeRemoteActions,
} from '../src/client/SessionTreeOverlay.tsx'
import { SessionBranchList } from '../src/client/SessionBranchList.tsx'
import { SessionForkLineage, FORK_LINEAGE_STORAGE_KEY } from '../src/client/fork-lineage.ts'
import { apply, inject } from '../src/client/index.ts'
import type { SessionTreePanelActions } from '../src/client/slots.ts'

afterEach(cleanup)
const sid = (value: string): SessionId => value as SessionId
const t = (key: string): string => zh[key as keyof typeof zh] ?? key
function node(nodeId: string, parentId: string | null, summary: string, branch = 'main'): TreeNode {
  return { nodeId, parentId, branch, summary, createdAt: `2026-01-01T00:00:0${nodeId.length}.000Z`, message: { role: 'user', content: summary } }
}
function view(cursor: string | null, nodes: TreeNode[], selectedNodeId: string | null = cursor): SessionTreeView {
  return { sessionId: sid('s1'), cursor, selectedNodeId, activeBranch: 'main', nodes, branches: [{ name: 'main', headId: nodes.at(-1)?.nodeId ?? '', nodeIds: nodes.map(item => item.nodeId) }] }
}

interface TestEditor {
  parseEditorState: (value: unknown) => unknown
  setEditorState: (state: unknown) => void
}

function textFromEditorState(state: unknown): string {
  const root = (state as { root?: { children?: Array<{ children?: Array<{ text?: string }> }> } }).root
  return (root?.children ?? [])
    .map(paragraph => (paragraph.children ?? []).map(child => child.text ?? '').join(''))
    .join('\n')
}

interface TestSlotEntry {
  component: unknown
  options: Record<string, unknown>
  inject?: (...args: never[]) => unknown
}

/** Standalone-repo substitute for Harness' browser-only SlotRegistry bundle. */
function installTestSlots(ctx: Context) {
  const declared = new Set<string>()
  const entriesByName = new Map<string, TestSlotEntry[]>()
  const slots = {
    register(options: { name: string; children?: Record<string, unknown>; inject?: (...args: never[]) => unknown; [key: string]: unknown }, component: unknown) {
      declared.add(options.name)
      for (const name of Object.keys(options.children ?? {})) declared.add(name)
      const entry: TestSlotEntry = {
        component,
        options,
        ...(options.inject === undefined ? {} : { inject: options.inject }),
      }
      const entries = entriesByName.get(options.name) ?? []
      entries.push(entry)
      entriesByName.set(options.name, entries)
      return () => {
        const current = entriesByName.get(options.name)
        if (current === undefined) return
        const index = current.indexOf(entry)
        if (index >= 0) current.splice(index, 1)
      }
    },
    entries(name: string) {
      return entriesByName.get(name) ?? []
    },
    inject(name: string, mount: () => void | (() => void)) {
      if (!declared.has(name)) return () => {}
      const dispose = mount()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
  ctx.provide('slots', slots as never)
  return slots
}

async function bench(tree = view(null, []), nativePanel = true) {
  const ctx = new Context()
  // Each bench mounts the real browser persistence; scrub the shared jsdom
  // localStorage so one test's /fork annotations never leak into the next.
  try { window.localStorage.removeItem(FORK_LINEAGE_STORAGE_KEY) } catch { /* non-jsdom host */ }
  const slots = installTestSlots(ctx)
  const calls: Array<{ method: string; args: unknown[] }> = []
  const opened: string[] = []
  const openedSessions: string[] = []
  const drafts = vi.fn()
  const editors = new Map<unknown, TestEditor>()
  const bindings = new Map<SessionId, unknown>()
  const nativeFork = vi.fn(async (opts: { sessionId: SessionId }) => sid(`${opts.sessionId}-native-fork`))
  const open = vi.fn((id: SessionId) => { openedSessions.push(id) })
  const refresh = vi.fn(async () => {})
  const sessionTree = {
    list: (...args: unknown[]) => { calls.push({ method: 'list', args }); return Promise.resolve({ ok: true, value: tree }) },
    jump: (...args: unknown[]) => { calls.push({ method: 'jump', args }); return Promise.resolve({ ok: true, value: { cursor: args[1], messages: [] } }) },
    fork: (...args: unknown[]) => { calls.push({ method: 'fork', args }); return Promise.resolve({ ok: true, value: { cursor: args[1], branch: args[2], forkCount: 1 } }) },
    forkSession: (...args: unknown[]) => { calls.push({ method: 'fork', args }); return Promise.resolve({ ok: true, value: { cursor: args[1], branch: args[2], forkCount: 1, sessionId: 's1-fork-test', prompt: 'test' } }) },
  }
  class RemoteService extends Service {
    constructor(c: Context) { super(c, 'remote') }
    async $mount(): Promise<() => Promise<void>> {
      const dispose = ctx.reflect.provide('remote.sessionTree', sessionTree)
      return async () => { await dispose() }
    }
  }
  new RemoteService(ctx)
  ctx.provide('layout', { openDetails: (panel?: string) => { opened.push(panel ?? 'tool') }, closeDetails: () => {}, toggleSidebar: () => {} })
  const children = {
    'details': { kind: 'single', scope: 'session' },
    'shell.overlay': { kind: 'list', scope: 'root' },
    ...(nativePanel ? { 'conversation.details.panel': { kind: 'list', scope: 'session' } } : {}),
  }
  slots.register({ name: 'root', children } as never, (() => null) as never)
  const toolDetails = (() => null) as never
  slots.register({ name: 'details' } as never, toolDetails)
  ctx.provide('locale', { register: () => () => {} } as never)
  ctx.provide('sessions', {
    binding: (id: SessionId) => bindings.get(id),
    fork: nativeFork,
    open,
    refresh,
  } as never)
  const inputFor = vi.fn((actx: unknown) => ({ editor: editors.get(actx), setDraft: drafts }))
  ctx.provide('conversation', {
    input: {
      for: inputFor,
    },
  } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return {
    ctx, calls, opened, openedSessions, drafts, editors, inputFor, bindings, nativeFork, open, refresh, fiber, toolDetails,
    entry: () => ctx.slots.entries('conversation.details.panel' as never)[0],
    overlayEntry: () => ctx.slots.entries('shell.overlay' as never)[0],
    branchEntry: () => ctx.slots.entries('shell.overlay' as never)[1],
  }
}

/** Shared fake for the reactive Session list consumed by the branch rail. */
interface FakeListRow {
  id: SessionId
  displayTitle: string
  parentId?: SessionId
  running: boolean
  blank: boolean
  updatedAt: number
}

function fakeListState(ids: SessionId[], rows: Record<string, FakeListRow>, current: SessionId) {
  return {
    phase: 'ready' as const,
    current,
    ids,
    byId: rows as unknown as Record<SessionId, FakeListRow>,
  }
}

function fakeRow(id: SessionId, displayTitle: string, parentId?: SessionId): [string, FakeListRow] {
  return [id, { id, displayTitle, ...(parentId === undefined ? {} : { parentId }), running: false, blank: false, updatedAt: 1 }]
}

describe('session tree browser plugin', () => {
  it('uses the patched named details panel when available without replacing Tool details', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()?.options).toMatchObject({ id: 'session-tree', order: 10 })
    expect(b.overlayEntry()?.options).toMatchObject({ id: 'session-tree', order: 10 })
    expect(b.ctx.slots.entries('details' as never)[0]?.component).toBe(b.toolDetails)
    expect(b.ctx.slots.entries('conversation.input.dock' as never)).toHaveLength(0)
    b.ctx.emit('command/executed', sid('s1'), 'tree', { kind: 'success' })
    expect(b.opened).toEqual(['session-tree'])
    b.ctx.emit('command/executed', sid('s1'), 'clone', {
      kind: 'success',
      text: JSON.stringify({ ok: true, value: { nativeForkRequired: true } }),
    })
    await waitFor(() => { expect(b.openedSessions).toEqual([sid('s1-native-fork')]) })
    expect(b.nativeFork).toHaveBeenCalledWith({ sessionId: sid('s1'), increaseTitle: true })
    expect(b.refresh).not.toHaveBeenCalled()
  })

  it('routes /fork into the native panel selector state', async () => {
    const b = await bench(view('root', [node('root', null, 'user prompt')]))
    await b.fiber.await()
    const actions = ((b.entry() as unknown as { inject: (id: SessionId) => SessionTreePanelActions }).inject)(sid('s1'))
    expect(actions.modeController?.getSnapshot().selectorOpen).toBe(false)

    b.ctx.emit('command/executed', sid('s1'), 'fork', {
      kind: 'success',
      text: JSON.stringify({ ok: true, value: { selectorRequired: true, userNodeCount: 1 } }),
    })
    expect(actions.modeController?.getSnapshot().selectorOpen).toBe(true)
    expect(b.opened).toEqual(['session-tree'])
  })

  it('forks before the selected user prompt through the native session service', async () => {
    const prompt = '  selected line one\nselected line two  \n'
    const sourceCtx = { role: 'source' }
    const childCtx = { role: 'child' }
    const sourceEditor: TestEditor = {
      parseEditorState: vi.fn((state: unknown) => state),
      setEditorState: vi.fn(),
    }
    const childEditor: TestEditor = {
      parseEditorState: vi.fn((state: unknown) => state),
      setEditorState: vi.fn(),
    }
    const selected: TreeNode = {
      ...node('prompt', null, 'selected prompt'),
      content: [{ type: 'text', text: prompt }],
      metadata: { sessionEventSeq: 8 },
    }
    const childId = sid('native-child')
    const loadThrough = vi.fn(async () => {})
    const entries = [
      { type: 'event', event: { type: 'turn/start', seq: 1 } },
      { type: 'event', event: { type: 'turn/end', seq: 5 } },
      { type: 'event', event: { type: 'user/message', seq: 8 } },
      { type: 'event', event: { type: 'turn/end', seq: 9 } },
    ]
    const sourceEvents = structuredClone(entries)
    const b = await bench(view('prompt', [selected], 'prompt'))
    b.editors.set(sourceCtx, sourceEditor)
    b.editors.set(childCtx, childEditor)
    b.bindings.set(sid('s1'), {
      session: { loadThrough },
      eventSource: {
        getSnapshot: () => ({ entries }),
      },
      ctx: sourceCtx,
    })
    b.bindings.set(childId, { ctx: childCtx })
    b.nativeFork.mockResolvedValueOnce(childId)
    await b.fiber.await()

    const actions = ((b.entry() as unknown as { inject: (id: SessionId) => SessionTreePanelActions }).inject)(sid('s1'))
    await actions.forkUserPrompt?.(selected)

    expect(loadThrough).toHaveBeenCalledWith(8)
    expect(b.nativeFork).toHaveBeenCalledWith({ sessionId: sid('s1'), atSeq: 5, increaseTitle: true })
    expect(b.inputFor).toHaveBeenCalledWith(childCtx)
    expect(b.inputFor).not.toHaveBeenCalledWith(sourceCtx)
    expect(b.drafts).not.toHaveBeenCalled()
    expect(sourceEditor.parseEditorState).not.toHaveBeenCalled()
    expect(sourceEditor.setEditorState).not.toHaveBeenCalled()
    expect(childEditor.parseEditorState).toHaveBeenCalledTimes(1)
    expect(childEditor.setEditorState).toHaveBeenCalledTimes(1)
    expect(vi.mocked(childEditor.setEditorState).mock.invocationCallOrder[0]).toBeLessThan(
      b.open.mock.invocationCallOrder[0]!,
    )
    expect(textFromEditorState(vi.mocked(childEditor.setEditorState).mock.calls[0]?.[0])).toBe(prompt)
    expect(entries).toEqual(sourceEvents)
    expect(b.openedSessions).toEqual([childId])
    expect(b.refresh).not.toHaveBeenCalled()
    expect(actions.modeController?.getSnapshot().selectorOpen).toBe(false)
  })

  it('seeds a custom panel fork through the child native editor', async () => {
    const childId = sid('s1-fork-test')
    const childCtx = {}
    const childEditor: TestEditor = {
      parseEditorState: vi.fn((state: unknown) => state),
      setEditorState: vi.fn(),
    }
    const b = await bench()
    b.editors.set(childCtx, childEditor)
    b.bindings.set(childId, { ctx: childCtx })
    await b.fiber.await()

    const actions = ((b.entry() as unknown as { inject: (id: SessionId) => SessionTreePanelActions }).inject)(sid('s1'))
    await actions.fork('n1', 'alt')

    expect(b.inputFor).toHaveBeenCalledWith(childCtx)
    expect(b.drafts).not.toHaveBeenCalled()
    expect(vi.mocked(childEditor.setEditorState).mock.invocationCallOrder[0]).toBeLessThan(
      b.open.mock.invocationCallOrder[0]!,
    )
    expect(textFromEditorState(vi.mocked(childEditor.setEditorState).mock.calls[0]?.[0])).toBe('test')
    expect(b.openedSessions).toEqual([childId])
    expect(b.refresh).not.toHaveBeenCalled()
  })

  it('reports the native fork limitation for the first user prompt', async () => {
    const selected: TreeNode = {
      ...node('prompt', null, 'first prompt'),
      metadata: { sessionEventSeq: 1 },
    }
    const b = await bench(view('prompt', [selected], 'prompt'))
    b.bindings.set(sid('s1'), {
      session: { loadThrough: vi.fn(async () => {}) },
      eventSource: {
        getSnapshot: () => ({
          entries: [
            { type: 'event', event: { type: 'user/message', seq: 1 } },
            { type: 'event', event: { type: 'turn/end', seq: 2 } },
          ],
        }),
      },
      ctx: {},
    })
    await b.fiber.await()

    const actions = ((b.entry() as unknown as { inject: (id: SessionId) => SessionTreePanelActions }).inject)(sid('s1'))
    await expect(actions.forkUserPrompt?.(selected)).rejects.toThrow(
      'The native fork API cannot fork before the first completed turn',
    )
    expect(b.nativeFork).not.toHaveBeenCalled()
    expect(b.drafts).not.toHaveBeenCalled()
    expect(b.refresh).not.toHaveBeenCalled()
  })

  it('falls back to the additive official shell overlay and opens it on /tree', async () => {
    const b = await bench(view(null, []), false)
    await b.fiber.await()
    expect(b.entry()).toBeUndefined()
    expect(b.overlayEntry()?.options).toMatchObject({ id: 'session-tree', order: 10 })
    expect(b.ctx.slots.entries('details' as never)[0]?.component).toBe(b.toolDetails)
    const injected = b.overlayEntry()?.inject?.() as { controller: SessionTreeOverlayController }
    expect(injected.controller.getSnapshot()).toEqual({
      open: false, nativePanel: false, selectorOpen: false, promptDraft: null,
    })
    b.ctx.emit('command/executed', sid('s1'), 'tree', { kind: 'success' })
    expect(injected.controller.getSnapshot()).toEqual({
      open: true, nativePanel: false, selectorOpen: false, promptDraft: null,
    })
    expect(b.opened).toEqual([])
  })

  it('forwards sidebar actions to the sessionTree remote', async () => {
    const childCtx = {}
    const childEditor: TestEditor = {
      parseEditorState: vi.fn((state: unknown) => state),
      setEditorState: vi.fn(),
    }
    const b = await bench()
    b.editors.set(childCtx, childEditor)
    b.bindings.set(sid('s1-fork-test'), { ctx: childCtx })
    await b.fiber.await()
    const actions = ((b.entry() as unknown as { inject: (id: SessionId) => SessionTreePanelActions }).inject)(sid('s1'))
    await actions.load(sid('s1'))
    await actions.jump('n1')
    await actions.fork('n1', 'alt')
    expect(b.calls).toEqual([
      { method: 'list', args: ['s1'] },
      { method: 'jump', args: ['s1', 'n1'] },
      { method: 'fork', args: ['s1', 'n1', 'alt'] },
    ])
    expect(b.inputFor).toHaveBeenCalledWith(childCtx)
    expect(b.drafts).not.toHaveBeenCalled()
    expect(b.refresh).not.toHaveBeenCalled()
  })

  it('renders a bounded IDEA-style graph and binds the exact clicked node', async () => {
    const nodes = [node('root', null, 'root'), node('main', 'root', 'main answer'), node('alt', 'root', 'alternative')]
    const load = vi.fn(async () => view('main', nodes, 'main'))
    const jump = vi.fn(async (nodeId: string | null) => ({ cursor: nodeId, messages: [] }))
    const Panel = SessionTreeDock as unknown as ComponentType<Record<string, unknown>>
    const { container } = render(<Panel
      sessionId={sid('s1')} panel="session-tree" closeDetails={vi.fn()} t={t}
      load={load} jump={jump} fork={vi.fn()}
    />)
    await screen.findByText('alternative')
    expect(container.querySelectorAll('svg').length).toBe(4)
    expect(container.querySelector('[data-node-id="main"]')?.getAttribute('class')).toContain('nodeSelected')
    fireEvent.click(screen.getByLabelText(`${zh['panel.select']} — alternative`))
    await waitFor(() => { expect(jump).toHaveBeenCalledWith('alt') })
    // All rows use the same fixed graph column; no depth-derived margin/padding exists.
    const rows = [...container.querySelectorAll('[data-node-id]')]
    expect(rows).toHaveLength(3)
    expect(rows.every(row => (row as HTMLElement).style.marginLeft === '')).toBe(true)
    expect([...container.querySelectorAll('svg')].filter(svg => svg.getAttribute('viewBox') === '0 0 44 38')).toHaveLength(3)
  })

  it('keeps a deeply nested tree horizontally bounded', async () => {
    const nodes: TreeNode[] = []
    for (let index = 0; index < 64; index++) {
      nodes.push(node(`n${index}`, index === 0 ? null : `n${index - 1}`, `level ${index}`))
    }
    const Panel = SessionTreeDock as unknown as ComponentType<Record<string, unknown>>
    const { container } = render(<Panel
      sessionId={sid('deep')} panel="session-tree" closeDetails={vi.fn()} t={t}
      load={async () => view('n63', nodes, 'n63')}
      jump={vi.fn()} fork={vi.fn()}
    />)
    await screen.findByText('level 63')
    const rows = [...container.querySelectorAll('[data-node-id]')]
    expect(rows).toHaveLength(64)
    expect(rows.every(row => (row as HTMLElement).style.marginLeft === '' && (row as HTMLElement).style.paddingLeft === '')).toBe(true)
    expect([...container.querySelectorAll('svg')].filter(svg => svg.getAttribute('viewBox') === '0 0 44 38')).toHaveLength(64)
  })

  it('renders and closes the official overlay drawer for the current non-blank session', async () => {
    const nodes = [node('root', null, 'root')]
    const controller = new SessionTreeOverlayController()
    const remoteActions: SessionTreeRemoteActions = {
      load: vi.fn(async () => view('root', nodes)),
      jump: vi.fn(async (_sessionId, nodeId) => ({ cursor: nodeId, messages: [] })),
      fork: vi.fn(async (_sessionId, nodeId, branch) => ({ cursor: nodeId, branch, forkCount: 1 })),
      onRefresh: vi.fn(() => () => {}),
    }
    controller.open()
    const useSessions = (<T,>(select: (state: {
      current: SessionId
      byId: Record<SessionId, { blank: boolean }>
    }) => T): T => select({ current: sid('s1'), byId: { [sid('s1')]: { blank: false } } }))
    const Overlay = SessionTreeOverlay as unknown as ComponentType<Record<string, unknown>>
    const { container } = render(<Overlay
      controller={controller}
      remoteActions={remoteActions}
      useSessions={useSessions}
      t={t}
    />)
    await screen.findByText('root')
    expect(container.querySelector('[data-session-tree-overlay="mounted"]')?.getAttribute('data-open')).toBe('true')
    fireEvent.click(screen.getByLabelText(zh['panel.close']))
    await waitFor(() => {
      expect(container.querySelector('[data-session-tree-overlay="mounted"]')?.hasAttribute('data-open')).toBe(false)
    })
    expect(screen.queryByText('root')).toBeNull()
  })

  it('closes the official overlay when the current session changes', async () => {
    const controller = new SessionTreeOverlayController()
    const current = { value: sid('s1') }
    const remoteActions: SessionTreeRemoteActions = {
      load: vi.fn(async sessionId => ({ ...view(null, []), sessionId })),
      jump: vi.fn(async (_sessionId, nodeId) => ({ cursor: nodeId, messages: [] })),
      fork: vi.fn(async (_sessionId, nodeId, branch) => ({ cursor: nodeId, branch, forkCount: 1 })),
      onRefresh: vi.fn(() => () => {}),
    }
    const useSessions = (<T,>(select: (state: {
      current: SessionId
      byId: Record<SessionId, { blank: boolean }>
    }) => T): T => select({
      current: current.value,
      byId: { [sid('s1')]: { blank: false }, [sid('s2')]: { blank: false } },
    }))
    const Overlay = SessionTreeOverlay as unknown as ComponentType<Record<string, unknown>>
    controller.open()
    const rendered = render(<Overlay controller={controller} remoteActions={remoteActions} useSessions={useSessions} t={t} />)
    expect(controller.getSnapshot().open).toBe(true)
    current.value = sid('s2')
    rendered.rerender(<Overlay controller={controller} remoteActions={remoteActions} useSessions={useSessions} t={t} />)
    await waitFor(() => { expect(controller.getSnapshot().open).toBe(false) })
  })

  it('routes the fallback overlay selector through the native fork callback', async () => {
    const controller = new SessionTreeOverlayController()
    const selected = node('prompt', null, 'editable prompt')
    const forkUserPrompt = vi.fn(async () => {})
    const remoteActions: SessionTreeRemoteActions = {
      load: vi.fn(async () => view('prompt', [node('prompt', null, 'editable prompt')], 'prompt')),
      jump: vi.fn(async (_sessionId, nodeId) => ({ cursor: nodeId, messages: [] })),
      fork: vi.fn(async (_sessionId, nodeId, branch) => ({ cursor: nodeId, branch, forkCount: 1 })),
      onRefresh: vi.fn(() => () => {}),
    }
    const useSessions = (<T,>(select: (state: {
      current: SessionId
      byId: Record<SessionId, { blank: boolean }>
    }) => T): T => select({ current: sid('s1'), byId: { [sid('s1')]: { blank: false } } }))
    const Overlay = SessionTreeOverlay as unknown as ComponentType<Record<string, unknown>>
    controller.openSelector()
    render(<Overlay
      controller={controller}
      remoteActions={remoteActions}
      forkUserPrompt={forkUserPrompt}
      useSessions={useSessions}
      t={t}
    />)

    await screen.findByText('editable prompt')
    fireEvent.click(screen.getByLabelText(`${zh['fork.selector.select']} — editable prompt`))
    await waitFor(() => {
      expect(forkUserPrompt).toHaveBeenCalledWith(sid('s1'), expect.objectContaining(selected))
    })
  })

  it('reloads the tree when the reactive session-list revision changes', async () => {
    const state = {
      phase: 'ready' as const,
      current: sid('s1'),
      ids: [sid('s1')],
      byId: { [sid('s1')]: { displayTitle: 'Session one', blank: false, running: false, updatedAt: 1 } },
    }
    const load = vi.fn(async () => view('root', [node('root', null, 'root')]))
    const useSessions = (<T,>(select: (value: typeof state) => T): T => select(state))
    const Panel = SessionTreeDock as unknown as ComponentType<Record<string, unknown>>
    const rendered = render(<Panel
      sessionId={sid('s1')} panel="session-tree" closeDetails={vi.fn()} t={t}
      load={load} jump={vi.fn()} fork={vi.fn()} useSessions={useSessions}
    />)
    await screen.findByText('root')
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })

    state.byId[sid('s1')]!.updatedAt = 2
    rendered.rerender(<Panel
      sessionId={sid('s1')} panel="session-tree" closeDetails={vi.fn()} t={t}
      load={load} jump={vi.fn()} fork={vi.fn()} useSessions={useSessions}
    />)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
  })

  it('renders tool interactions quietly and marks failed calls as errors', async () => {
    const toolNode: TreeNode = {
      nodeId: 'tool-ok', parentId: null, type: 'tool_call', branch: 'main', summary: 'bash({}) → ok output',
      createdAt: '2026-01-01T00:00:01.000Z', message: { role: 'tool', content: 'ok output', toolCallId: 'call-ok' },
      content: [
        { type: 'tool_call', id: 'call-ok', name: 'bash', arguments: {} },
        { type: 'tool_result', toolCallId: 'call-ok', content: 'ok output' },
      ],
    }
    const failedNode: TreeNode = {
      nodeId: 'tool-failed', parentId: 'tool-ok', type: 'tool_call', branch: 'main', summary: 'pwsh({}) → denied',
      createdAt: '2026-01-01T00:00:02.000Z', error: 'Sandbox: EPERM',
      message: { role: 'tool', content: 'denied', toolCallId: 'call-failed' },
      content: [
        { type: 'tool_call', id: 'call-failed', name: 'pwsh', arguments: {} },
        { type: 'tool_result', toolCallId: 'call-failed', content: 'denied', isError: true },
      ],
    }
    const Panel = SessionTreeDock as unknown as ComponentType<Record<string, unknown>>
    const { container } = render(<Panel
      sessionId={sid('tools')} panel="session-tree" closeDetails={vi.fn()} t={t}
      load={async () => view('tool-failed', [toolNode, failedNode], 'tool-failed')}
      jump={vi.fn()} fork={vi.fn()}
    />)
    await waitFor(() => { expect(container.querySelector('[data-node-id="tool-failed"]')).not.toBeNull() })
    expect(container.querySelector('[data-node-id="tool-ok"]')?.getAttribute('class')).toContain('nodeTool')
    expect(container.querySelector('[data-node-id="tool-failed"]')?.getAttribute('class')).toContain('nodeError')
  })

  it('keeps the complete long message in the row and hover title', async () => {
    const full = `begin-${'x'.repeat(4200)}-end`
    const longNode: TreeNode = {
      nodeId: 'long', parentId: null, type: 'message', branch: 'main',
      summary: `${full.slice(0, 297)}...`, createdAt: '2026-01-01T00:00:01.000Z',
      message: { role: 'user', content: full },
    }
    const Panel = SessionTreeDock as unknown as ComponentType<Record<string, unknown>>
    const { container } = render(<Panel
      sessionId={sid('long')} panel="session-tree" closeDetails={vi.fn()} t={t}
      load={async () => view('long', [longNode], 'long')}
      jump={vi.fn()} fork={vi.fn()}
    />)
    await waitFor(() => { expect(container.querySelector('[data-node-id="long"]')).not.toBeNull() })
    const fullText = container.querySelector('[data-node-id="long"] span[title]')
    expect(fullText?.textContent).toBe(full)
    expect(fullText?.getAttribute('title')).toBe(full)
  })

  it('collapses descendants from the left-side expander without shifting the title', async () => {
    const nodes = [
      node('parent', null, 'parent prompt'),
      node('child', 'parent', 'child answer'),
      node('grandchild', 'child', 'grandchild detail'),
    ]
    const Panel = SessionTreeDock as unknown as ComponentType<Record<string, unknown>>
    render(<Panel
      sessionId={sid('collapse')} panel="session-tree" closeDetails={vi.fn()} t={t}
      load={async () => view('grandchild', nodes, 'grandchild')}
      jump={vi.fn()} fork={vi.fn()}
    />)
    await screen.findByText('grandchild detail')
    const expander = screen.getByLabelText(`${zh['node.collapse']} — parent prompt`)
    const title = screen.getByText('parent prompt')
    expect(expander.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    const row = expander.closest('[data-node-id]')
    expect(row?.getAttribute('data-node-id')).toBe('parent')

    fireEvent.click(expander)
    expect(expander.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('child answer')).toBeNull()
    expect(screen.queryByText('grandchild detail')).toBeNull()

    fireEvent.click(screen.getByLabelText(`${zh['node.expand']} — parent prompt`))
    expect(screen.getByText('child answer')).not.toBeNull()
    expect(screen.getByText('grandchild detail')).not.toBeNull()
    expect(row?.getAttribute('data-node-id')).toBe('parent')
  })

  it('filters the fork selector to user prompts and reports an empty state', async () => {
    const user = node('prompt', null, 'editable prompt')
    const assistant: TreeNode = {
      ...node('answer', 'prompt', 'hidden answer'),
      message: { role: 'assistant', content: 'hidden answer' },
    }
    const fork = vi.fn()
    const forkUserPrompt = vi.fn(async () => {})
    const Panel = SessionTreeDock as unknown as ComponentType<Record<string, unknown>>
    const { rerender } = render(<Panel
      sessionId={sid('selector')} panel="session-tree" mode="selectUserPrompt"
      closeDetails={vi.fn()} t={t} load={async () => view('answer', [user, assistant], 'answer')}
      jump={vi.fn()} fork={fork} forkUserPrompt={forkUserPrompt}
    />)
    await screen.findByText('editable prompt')
    expect(screen.queryByText('hidden answer')).toBeNull()

    fireEvent.click(screen.getByLabelText(`${zh['fork.selector.select']} — editable prompt`))
    await waitFor(() => { expect(forkUserPrompt).toHaveBeenCalledWith(user) })
    expect(fork).not.toHaveBeenCalled()

    rerender(<Panel
      sessionId={sid('empty-selector')} panel="session-tree" mode="selectUserPrompt"
      closeDetails={vi.fn()} t={t} load={async () => view('answer', [assistant], 'answer')}
      jump={vi.fn()} fork={vi.fn()}
    />)
    await screen.findByText(zh['fork.selector.empty'])
  })

  it('nests a /fork branch under its source in the left rail without a refresh', async () => {
    const prompt = '  selected line one\nselected line two  \n'
    const sourceCtx = { role: 'source' }
    const childCtx = { role: 'child' }
    const childEditor: TestEditor = {
      parseEditorState: vi.fn((state: unknown) => state),
      setEditorState: vi.fn(),
    }
    const selected: TreeNode = {
      ...node('prompt', null, 'selected prompt'),
      content: [{ type: 'text', text: prompt }],
      metadata: { sessionEventSeq: 8 },
    }
    const childId = sid('native-child')
    const entries = [
      { type: 'event', event: { type: 'turn/start', seq: 1 } },
      { type: 'event', event: { type: 'turn/end', seq: 5 } },
      { type: 'event', event: { type: 'user/message', seq: 8 } },
    ]
    const b = await bench(view('prompt', [selected], 'prompt'))
    b.editors.set(childCtx, childEditor)
    b.bindings.set(sid('s1'), {
      session: { loadThrough: vi.fn(async () => {}) },
      eventSource: { getSnapshot: () => ({ entries }) },
      ctx: sourceCtx,
    })
    b.bindings.set(childId, { ctx: childCtx })
    b.nativeFork.mockResolvedValueOnce(childId)
    await b.fiber.await()

    const actions = ((b.entry() as unknown as { inject: (id: SessionId) => SessionTreePanelActions }).inject)(sid('s1'))
    const lineage = ((b.branchEntry()?.inject) as unknown as () => { lineage: SessionForkLineage })().lineage
    expect(lineage.getSnapshot().size).toBe(0)

    // The rail mounts before any fork exists and renders nothing. The fake
    // list hook models the real store's immutable snapshots: every push
    // replaces the state object the selector reads.
    let listState = fakeListState([sid('s1')], Object.fromEntries([fakeRow(sid('s1'), 'Source chat')]), sid('s1'))
    const useSessions = (<T,>(select: (value: typeof listState) => T): T => select(listState))
    const openedBranches: string[] = []
    const openBranch = (id: SessionId) => { openedBranches.push(id) }
    const Rail = SessionBranchList as unknown as ComponentType<Record<string, unknown>>
    const rendered = render(<Rail lineage={lineage} openSession={openBranch} useSessions={useSessions} t={t} />)
    expect(rendered.container.querySelector('[data-session-branch-rail]')).toBeNull()

    await actions.forkUserPrompt?.(selected)
    expect(b.nativeFork).toHaveBeenCalledWith({ sessionId: sid('s1'), atSeq: 5, increaseTitle: true })
    const recorded = lineage.getSnapshot().get(childId)
    expect(recorded).toMatchObject({ childId, parentId: sid('s1'), summary: 'selected line one selected line two' })

    // The native fork API publishes the child into the reactive list with its
    // parent linkage; the already-mounted rail re-renders from the store push.
    listState = fakeListState(
      [sid('s1'), childId],
      Object.fromEntries([
        fakeRow(sid('s1'), 'Source chat'),
        [childId, { id: childId, displayTitle: 'native-child', parentId: sid('s1'), running: true, blank: false, updatedAt: 2 }] as [string, FakeListRow],
      ]),
      childId,
    )
    rendered.rerender(<Rail lineage={lineage} openSession={openBranch} useSessions={useSessions} t={t} />)

    // The new branch opens the rail by itself — no browser refresh involved.
    const root = rendered.container.querySelector('[data-session-branch-rail="mounted"]')
    expect(root?.getAttribute('data-open')).toBe('true')
    const sourceRow = root?.querySelector('[data-branch-session-id="s1"]')
    expect(sourceRow?.getAttribute('data-branch-depth')).toBe('0')
    expect(sourceRow?.querySelector('[class*="countChip"]')?.textContent).toContain('×1')
    const branchRow = root?.querySelector(`[data-branch-session-id="${childId}"]`)
    expect(branchRow?.getAttribute('data-branch-depth')).toBe('1')
    expect(branchRow?.getAttribute('class')).toContain('rowCurrent')
    expect(branchRow?.querySelector('[class*="forkBadge"]')?.textContent).toContain(zh['branch.node.forkBadge'])
    expect(branchRow?.querySelector('[class*="summary"]')?.textContent).toBe('selected line one selected line two')
    expect(branchRow?.querySelectorAll('[class*="cellElbow"]')).toHaveLength(1)

    fireEvent.click(branchRow?.querySelector(`button[aria-label="${zh['branch.node.open']} — selected line one selected line two"]`) as HTMLElement)
    expect(openedBranches).toEqual([childId])
  })

  it('keeps /clone children out of the fork lineage rail', async () => {
    const b = await bench()
    await b.fiber.await()
    const lineage = ((b.branchEntry()?.inject) as unknown as () => { lineage: SessionForkLineage })().lineage
    b.ctx.emit('command/executed', sid('s1'), 'clone', {
      kind: 'success',
      text: JSON.stringify({ ok: true, value: { nativeForkRequired: true } }),
    })
    await waitFor(() => { expect(b.openedSessions).toEqual([sid('s1-native-fork')]) })
    expect(lineage.getSnapshot().size).toBe(0)

    // Even with the clone child live in the list (parent linkage written by
    // the same native fork API), the rail renders nothing: /clone sessions
    // keep their original sidebar presentation.
    const cloneId = sid('s1-native-fork')
    const state = fakeListState(
      [sid('s1'), cloneId],
      Object.fromEntries([fakeRow(sid('s1'), 'Source chat'), fakeRow(cloneId, 'cloned copy', sid('s1'))]),
      cloneId,
    )
    const useSessions = (<T,>(select: (value: typeof state) => T): T => select(state))
    const Rail = SessionBranchList as unknown as ComponentType<Record<string, unknown>>
    const { container } = render(<Rail lineage={lineage} openSession={vi.fn()} useSessions={useSessions} t={t} />)
    expect(container.firstElementChild).toBeNull()
  })

  it('records lineage when the host /fork command returns a session id', async () => {
    const b = await bench()
    await b.fiber.await()
    const lineage = ((b.branchEntry()?.inject) as unknown as () => { lineage: SessionForkLineage })().lineage
    b.ctx.emit('command/executed', sid('s1'), 'fork', {
      kind: 'success',
      text: JSON.stringify({ ok: true, value: { sessionId: 's1-fork-x', prompt: '  hello \n fork  ' } }),
    })
    expect(lineage.getSnapshot().get(sid('s1-fork-x'))).toMatchObject({
      childId: sid('s1-fork-x'),
      parentId: sid('s1'),
      summary: 'hello fork',
    })
  })

  it('cascades nested fork branches with connector rails and expand/collapse', async () => {
    const lineage = new SessionForkLineage()
    lineage.record({ childId: sid('c1'), parentId: sid('s1'), summary: 'first fork' })
    lineage.record({ childId: sid('c2'), parentId: sid('s1'), summary: 'second fork' })
    lineage.record({ childId: sid('g1'), parentId: sid('c1'), summary: 'fork of fork' })
    const state = fakeListState(
      [sid('s1'), sid('c1'), sid('c2'), sid('g1')],
      Object.fromEntries([
        fakeRow(sid('s1'), 'Source chat'),
        fakeRow(sid('c1'), 'c1', sid('s1')),
        fakeRow(sid('c2'), 'c2', sid('s1')),
        fakeRow(sid('g1'), 'g1', sid('c1')),
      ]),
      sid('s1'),
    )
    const useSessions = (<T,>(select: (value: typeof state) => T): T => select(state))
    const Rail = SessionBranchList as unknown as ComponentType<Record<string, unknown>>
    const { container } = render(<Rail lineage={lineage} openSession={vi.fn()} useSessions={useSessions} t={t} />)

    // Mounted with pre-existing lineage starts collapsed behind the rail tab.
    const root = container.querySelector('[data-session-branch-rail="mounted"]')
    expect(root?.hasAttribute('data-open')).toBe(false)
    fireEvent.click(screen.getByLabelText(zh['branch.rail.open']))

    const order = [...container.querySelectorAll('[data-branch-session-id]')]
      .map(row => [row.getAttribute('data-branch-session-id'), row.getAttribute('data-branch-depth')] as const)
    expect(order).toEqual([
      ['s1', '0'], ['c1', '1'], ['g1', '2'], ['c2', '1'],
    ])
    // Depth-2 row: the level-1 rail continues below (a younger sibling follows
    // at depth 1) and its own elbow terminates. A non-last depth-1 child (c1)
    // carries the continuing elbow; the last one (c2) only a terminating one.
    const grandchild = container.querySelector('[data-branch-session-id="g1"]')
    expect(grandchild?.querySelectorAll('[class*="cellRail"]')).toHaveLength(1)
    expect(grandchild?.querySelectorAll('[class*="cellElbow"]')).toHaveLength(1)
    expect(grandchild?.querySelectorAll('[class*="cellElbowLast"]')).toHaveLength(1)
    const middleChild = container.querySelector('[data-branch-session-id="c1"]')
    expect(middleChild?.querySelectorAll('[class*="cellElbow"]:not([class*="cellElbowLast"])')).toHaveLength(1)
    const lastChild = container.querySelector('[data-branch-session-id="c2"]')
    expect(lastChild?.querySelectorAll('[class*="cellRail"]')).toHaveLength(0)
    expect(lastChild?.querySelectorAll('[class*="cellElbowLast"]')).toHaveLength(1)

    fireEvent.click(screen.getByLabelText(`${zh['node.collapse']} — Source chat`))
    expect(screen.queryByText('first fork')).toBeNull()
    expect(screen.queryByText('fork of fork')).toBeNull()
    expect(screen.queryByText('second fork')).toBeNull()
    expect(screen.getByText('Source chat')).not.toBeNull()

    fireEvent.click(screen.getByLabelText(`${zh['node.expand']} — Source chat`))
    expect(screen.getByText('first fork')).not.toBeNull()
    expect(screen.getByText('fork of fork')).not.toBeNull()
    expect(screen.getByText('second fork')).not.toBeNull()
  })

  it('shows the required friendly state when the host reports no selection', async () => {
    const result = { ok: false, error: { code: 'INVALID_ARGUMENT', message: '请先在右侧会话树选中目标节点' } }
    expect(JSON.stringify(result)).toContain('请先在右侧会话树选中目标节点')
  })
})

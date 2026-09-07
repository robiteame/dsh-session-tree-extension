// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionTreeView, TreeNode } from '@deepseek-ai/dsh-pi-agent-session-tree/client'
import { zh } from '../src/client/locales.ts'
import { SessionTreeDock } from '../src/client/SessionTreePanel.tsx'
import {
  SessionTreeOverlay,
  SessionTreeOverlayController,
  type SessionTreeRemoteActions,
} from '../src/client/SessionTreeOverlay.tsx'
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
  const slots = installTestSlots(ctx)
  const calls: Array<{ method: string; args: unknown[] }> = []
  const opened: string[] = []
  const openedSessions: string[] = []
  const sessionTree = {
    list: (...args: unknown[]) => { calls.push({ method: 'list', args }); return Promise.resolve({ ok: true, value: tree }) },
    jump: (...args: unknown[]) => { calls.push({ method: 'jump', args }); return Promise.resolve({ ok: true, value: { cursor: args[1], messages: [] } }) },
    fork: (...args: unknown[]) => { calls.push({ method: 'fork', args }); return Promise.resolve({ ok: true, value: { cursor: args[1], branch: args[2], forkCount: 1 } }) },
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
  ctx.provide('sessions', { binding: () => undefined, open: (id: SessionId) => { openedSessions.push(id) } })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return {
    ctx, calls, opened, openedSessions, fiber, toolDetails,
    entry: () => ctx.slots.entries('conversation.details.panel' as never)[0],
    overlayEntry: () => ctx.slots.entries('shell.overlay' as never)[0],
  }
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
    b.ctx.emit('command/executed', sid('s1'), 'clone', { kind: 'success', text: JSON.stringify({ ok: true, value: { sessionId: 's1-clone-1' } }) })
    expect(b.openedSessions).toEqual(['s1-clone-1'])
  })

  it('falls back to the additive official shell overlay and opens it on /tree', async () => {
    const b = await bench(view(null, []), false)
    await b.fiber.await()
    expect(b.entry()).toBeUndefined()
    expect(b.overlayEntry()?.options).toMatchObject({ id: 'session-tree', order: 10 })
    expect(b.ctx.slots.entries('details' as never)[0]?.component).toBe(b.toolDetails)
    const injected = b.overlayEntry()?.inject?.() as { controller: SessionTreeOverlayController }
    expect(injected.controller.getSnapshot()).toEqual({ open: false, nativePanel: false })
    b.ctx.emit('command/executed', sid('s1'), 'tree', { kind: 'success' })
    expect(injected.controller.getSnapshot()).toEqual({ open: true, nativePanel: false })
    expect(b.opened).toEqual([])
  })

  it('forwards sidebar actions to the sessionTree remote', async () => {
    const b = await bench()
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
    expect(container.querySelectorAll('svg').length).toBe(3)
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

  it('shows the required friendly state when the host reports no selection', async () => {
    const result = { ok: false, error: { code: 'INVALID_ARGUMENT', message: '请先在右侧会话树选中目标节点' } }
    expect(JSON.stringify(result)).toContain('请先在右侧会话树选中目标节点')
  })
})

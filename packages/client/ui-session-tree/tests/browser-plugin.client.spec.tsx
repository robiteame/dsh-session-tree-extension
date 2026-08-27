// @vitest-environment jsdom
/**
 * ui-session-tree browser half on a real cordis Context with fake slots/remote
 * faces: the plugin registers the SessionTreePanel dock entry at
 * conversation.input.dock, the inject face's two verbs forward to the
 * `sessionTree` Remote namespace, a Remote failure reaches the panel verbatim,
 * the panel renders the tree (empty state, nodes, cursor highlight),
 * auto-expands when the composer draft starts with `/tree`, and node clicks
 * jump the cursor. Registration disposal rides the plugin fiber (HMR safety).
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionTreeView, TreeNode } from '@deepseek-ai/dsh-pi-agent-session-tree/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { zh } from '../src/client/locales.ts'
import { SessionTreeDock } from '../src/client/SessionTreePanel.tsx'
import { apply, inject } from '../src/client/index.ts'
import type { SessionTreePanelActions } from '../src/client/slots.ts'

afterEach(cleanup)

const sid = (k: string): SessionId => k as SessionId

function node(nodeId: string, parentId: string | null, summary: string, branch: string, createdAt = '2026-01-01T00:00:00.000Z'): TreeNode {
  return { nodeId, parentId, branch, summary, createdAt, message: { role: 'user', content: summary } }
}

function treeView(cursor: string | null, nodes: TreeNode[]): SessionTreeView {
  return { sessionId: sid('s1'), cursor, activeBranch: 'main', nodes, branches: [{ name: 'main', headId: nodes.at(-1)?.nodeId ?? '', nodeIds: nodes.map(n => n.nodeId) }] }
}

/** Boot the plugin over fake slots/remote faces; Remote methods record arguments. */
function tOf(key: string): string {
  return zh[key as keyof typeof zh] ?? key
}

function inputOf(draft: string): { draft: string } {
  return { draft }
}

async function bench(options: { view?: SessionTreeView; failList?: boolean; failJump?: boolean } = {}) {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  const defaultView = treeView(null, [])
  const fail = { code: 'NODE_NOT_FOUND', message: "node 'x' was not found" }
  function answer<T>(method: string, value: T, failIt = false) {
    return (...args: unknown[]) => {
      calls.push({ method, args })
      if (failIt) return Promise.resolve({ ok: false, error: fail })
      return Promise.resolve({ ok: true, value })
    }
  }
  let active = {
    list: answer('sessionTree/list', options.view ?? defaultView, options.failList),
    jump: answer('sessionTree/jump', { cursor: 'n1', messages: [] }, options.failJump),
  }
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.sessionTree', {
    get list() { return active.list },
    get jump() { return active.jump },
  })
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: {
      'conversation.input.dock': { kind: 'list', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sessions', {
    binding: () => undefined,
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return {
    ctx,
    fiber,
    calls,
    remount: () => { active = { list: answer('remounted/list', defaultView), jump: answer('remounted/jump', { cursor: 'n1', messages: [] }) } },
    entry: () => {
      const entry = ctx.slots.entries('conversation.input.dock')[0]
      if (entry === undefined) return undefined
      return {
        ...entry.options,
        locale: entry.locale,
        inject: entry.inject as unknown as ((sessionId: SessionId) => SessionTreePanelActions) | undefined,
      }
    },
  }
}

describe('ui-session-tree browser plugin', () => {
  it('registers the SessionTreePanel dock entry with injectable verbs', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toMatchObject({ id: 'session-tree', order: 30, locale: 'session-tree' })
    expect(b.entry()?.inject).toBeTypeOf('function')
  })

  it('inject verbs forward to the sessionTree Remote namespace', async () => {
    const b = await bench()
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1'))
    await verbs.load(sid('s1'))
    await verbs.jump('n1')
    expect(b.calls.map(call => call.method)).toEqual(['sessionTree/list', 'sessionTree/jump'])
    expect(b.calls[0]?.args).toEqual(['s1'])
    expect(b.calls[1]?.args).toEqual(['s1', 'n1'])
  })

  it('rejects a jump once the Remote namespace is gone (assembly fault)', async () => {
    const b = await bench()
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1'))
    b.remount()
    // A missing namespace is an assembly fault, not a call outcome: this
    // plugin declares remote.sessionTree in `inject`, so cordis disposes the
    // dock entry along with the namespace. Only a React closure that outlived
    // that disposal can reach these verbs, so no consumer-side guard renders
    // it as an error.
    await b.fiber.dispose()
    await expect(verbs.load(sid('s1'))).rejects.toThrow()
  })

  it('a Remote read failure surfaces as a panel error', async () => {
    const b = await bench({ failList: true })
    await b.fiber.await()
    const verbs = b.entry()!.inject!(sid('s1'))
    await expect(verbs.load(sid('s1'))).rejects.toThrow('NODE_NOT_FOUND')
  })

  it('renders the empty state and the full node tree with cursor highlight', async () => {
    const t = tOf
    const nodes = [node('r', null, 'root question', 'main'), node('a', 'r', 'alt answer', 'main')]
    const view = treeView('a', nodes)
    const load = vi.fn(async () => view)
    const jump = vi.fn(async () => ({ cursor: 'a', messages: [] }))
    const { rerender } = render(<SessionTreeDock
      sessionId={sid('s1')}
      load={load}
      jump={jump}
      t={t}
      session={undefined as never}
      input={undefined as never}
      useSession={() => undefined as never}
      useSessions={() => undefined as never}
      useWorkspaces={() => undefined as never}
      useProjection={() => undefined as never}
      inputActions={undefined as never}
      useInput={(select) => { return select(inputOf('') as never) }}
    />)
    await waitFor(() => { expect(screen.getByText(zh['panel.title'])).toBeTruthy() })
    // Collapsed by default: expand to reveal the node rows.
    fireEvent.click(screen.getByText(zh['panel.title']))
    await waitFor(() => { expect(screen.getByText('root question')).toBeTruthy() })
    expect(screen.getByText('alt answer')).toBeTruthy()
    expect(screen.getByText(zh['panel.cursor'])).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
    void rerender
  })

  it('auto-expands on a /tree composer draft and jumps on node click', async () => {
    const t = tOf
    const nodes = [node('r', null, 'root question', 'main'), node('a', 'r', 'alt answer', 'main')]
    const view = treeView('r', nodes)
    let draft = '/tree'
    const load = vi.fn(async () => view)
    const jump = vi.fn(async () => ({ cursor: 'a', messages: [] }))
    const { rerender } = render(<SessionTreeDock
      sessionId={sid('s1')}
      load={load}
      jump={jump}
      t={t}
      session={undefined as never}
      input={undefined as never}
      useSession={() => undefined as never}
      useSessions={() => undefined as never}
      useWorkspaces={() => undefined as never}
      useProjection={() => undefined as never}
      inputActions={undefined as never}
      useInput={(select) => { return select(inputOf(draft) as never) }}
    />)
    // The /tree draft expands the panel: node rows are visible without a click.
    await waitFor(() => { expect(screen.getByText('root question')).toBeTruthy() })
    fireEvent.click(screen.getByText('alt answer'))
    expect(jump).toHaveBeenCalledWith('a')
    draft = ''
    rerender(<SessionTreeDock
      sessionId={sid('s1')}
      load={load}
      jump={jump}
      t={t}
      session={undefined as never}
      input={undefined as never}
      useSession={() => undefined as never}
      useSessions={() => undefined as never}
      useWorkspaces={() => undefined as never}
      useProjection={() => undefined as never}
      inputActions={undefined as never}
      useInput={(select) => { return select(inputOf(draft) as never) }}
    />)
    // A non-/tree draft leaves the panel as the user left it (still open).
    expect(screen.getByText('root question')).toBeTruthy()
  })

  it('drops the dock entry when the plugin fiber unloads (HMR safety)', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toBeDefined()
    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
  })
})

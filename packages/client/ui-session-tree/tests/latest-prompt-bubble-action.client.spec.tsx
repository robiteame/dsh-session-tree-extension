// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ReactNode } from 'react'
import { LatestPromptBubbleAction } from '../src/client/LatestPromptBubbleAction.tsx'
import { LatestPromptEditController } from '../src/client/LatestPromptEditor.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const sid = (value: string) => value as SessionId
const t = (key: keyof typeof en) => en[key]
const HOST = '[data-session-tree-edit-action]'
const draft = { editId: 'edit-1', nodeId: 'node-a', prompt: 'Correct me', attachmentCount: 0 }

function setup() {
  const begin = vi.fn(async () => draft)
  const controller = new LatestPromptEditController({ begin, submit: vi.fn() })
  const action = (sessionId = 'source', nodeKey = 'key-a', nodeId = 'node-a') => <LatestPromptBubbleAction
    sessionId={sid(sessionId)} nodeKey={nodeKey} nodeId={nodeId} controller={controller} t={t}
  />
  return { action, begin }
}

function Bubble({ nodeKey = 'key-a', kind = 'user', clock = 'start', copy = vi.fn(), wrapped = true, revision = 0 }: {
  nodeKey?: string; kind?: string; clock?: string; copy?: () => void; wrapped?: boolean; revision?: number
}) {
  const button = <button type="button" onClick={copy}>Copy {revision}</button>
  return <div data-chat-node-key={nodeKey} data-chat-flow-kind={kind}>
    <div data-clock={clock}>
      <span>12:00</span>
      {wrapped ? <span data-copy-wrapper=""><span>{button}</span></span> : button}
      <button type="button">Native branch</button>
    </div>
  </div>
}

function Conversation({ sessionId = 'source', children }: { sessionId?: string; children: ReactNode }) {
  return <div data-conversation-content="" data-conversation-session={sessionId}>{children}</div>
}

describe('latest prompt bubble action', () => {
  it.each(['user', 'steering'])('adds an edit beside the %s copy wrapper without disturbing native controls', async kind => {
    const bench = setup()
    const copy = vi.fn()
    const view = render(<Conversation><Bubble kind={kind} copy={copy} />{bench.action()}</Conversation>)
    const edit = await screen.findByRole('button', { name: en['edit.latest.open'] })
    const nativeCopy = screen.getByRole('button', { name: 'Copy 0' })
    const wrapper = nativeCopy.closest('[data-copy-wrapper]')!
    const host = view.container.querySelector(HOST)!
    expect(wrapper.nextElementSibling).toBe(host)
    expect(host.nextElementSibling).toBe(screen.getByRole('button', { name: 'Native branch' }))
    expect(host.contains(edit)).toBe(true)
    fireEvent.click(nativeCopy)
    expect(copy).toHaveBeenCalledOnce()
    view.rerender(<Conversation><Bubble kind={kind} copy={copy} revision={1} />{bench.action()}</Conversation>)
    expect(screen.getByRole('button', { name: 'Copy 1' })).toBe(nativeCopy)
    expect(view.container.querySelector(HOST)).toBe(host)
    fireEvent.click(edit)
    await waitFor(() => { expect(bench.begin).toHaveBeenCalledExactlyOnceWith(sid('source'), 'node-a') })
    expect(view.container.querySelectorAll(HOST)).toHaveLength(1)
  })

  it('waits for the native row and reattaches when that row is recreated', async () => {
    const bench = setup()
    const shell = (revision: number | null) => <Conversation>
      {revision === null ? null : <Bubble key={revision} revision={revision} wrapped={false} />}
      {bench.action()}
    </Conversation>
    const view = render(shell(null))
    expect(view.container.querySelector(HOST)).toBeNull()
    view.rerender(shell(0))
    await screen.findByRole('button', { name: en['edit.latest.open'] })
    const firstHost = view.container.querySelector(HOST)!
    expect(screen.getByRole('button', { name: 'Copy 0' }).nextElementSibling).toBe(firstHost)
    view.rerender(shell(1))
    await waitFor(() => {
      const nextHost = view.container.querySelector(HOST)
      expect(nextHost).not.toBeNull()
      expect(nextHost).not.toBe(firstHost)
      expect(screen.getByRole('button', { name: 'Copy 1' }).nextElementSibling).toBe(nextHost)
    })
    expect(firstHost.isConnected).toBe(false)
    expect(screen.getAllByRole('button', { name: en['edit.latest.open'] })).toHaveLength(1)
  })

  it('keeps streaming updates local while revalidating native node identity and kind', async () => {
    const bench = setup()
    const view = render(<Conversation><Bubble />{bench.action()}</Conversation>)
    await screen.findByRole('button', { name: en['edit.latest.open'] })
    await act(async () => {})
    const root = view.container.querySelector('[data-conversation-content]')!
    const node = root.querySelector('[data-chat-node-key]')!
    const host = root.querySelector(HOST)!
    const search = vi.spyOn(root, 'querySelectorAll')
    await act(async () => {
      const streaming = root.ownerDocument.createElement('div')
      root.append(streaming)
      streaming.append('Streaming assistant text')
    })
    expect(search).not.toHaveBeenCalled()
    expect(root.querySelector(HOST)).toBe(host)
    await act(async () => { node.setAttribute('data-chat-node-key', 'other-key') })
    expect(search).toHaveBeenCalled()
    expect(root.querySelector(HOST)).toBeNull()
    await act(async () => { node.setAttribute('data-chat-node-key', 'key-a') })
    await screen.findByRole('button', { name: en['edit.latest.open'] })
    await act(async () => { node.setAttribute('data-chat-flow-kind', 'assistant') })
    expect(root.querySelector(HOST)).toBeNull()
    await act(async () => { node.setAttribute('data-chat-flow-kind', 'steering') })
    await screen.findByRole('button', { name: en['edit.latest.open'] })
    search.mockRestore()
  })

  it('cleans up the previous target on node or session changes and disconnects on unmount', async () => {
    const bench = setup()
    const shell = (sessionId: string, nodeKey: string, showAction = true) => <Conversation sessionId={sessionId}>
      <Bubble nodeKey="key-a" /><Bubble nodeKey="key-b" />
      {showAction ? bench.action(sessionId, nodeKey, `node-${nodeKey}`) : null}
    </Conversation>
    const view = render(shell('source', 'key-a'))
    await screen.findByRole('button', { name: en['edit.latest.open'] })
    const oldHost = view.container.querySelector(HOST)!
    view.rerender(shell('source', 'key-b'))
    await waitFor(() => { expect(view.container.querySelector('[data-chat-node-key="key-b"]')!.querySelector(HOST)).not.toBeNull() })
    expect(oldHost.isConnected).toBe(false)
    expect(view.container.querySelector('[data-chat-node-key="key-a"]')!.querySelector(HOST)).toBeNull()
    const secondHost = view.container.querySelector(HOST)!
    view.rerender(shell('other', 'key-a'))
    await screen.findByRole('button', { name: en['edit.latest.open'] })
    expect(secondHost.isConnected).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.open'] }))
    await waitFor(() => { expect(bench.begin).toHaveBeenCalledExactlyOnceWith(sid('other'), 'node-key-a') })
    view.rerender(shell('other', 'key-a', false))
    expect(view.container.querySelector(HOST)).toBeNull()
    view.rerender(shell('other', 'key-b', false))
    await waitFor(() => { expect(view.container.querySelector(HOST)).toBeNull() })
    expect(screen.getAllByRole('button', { name: 'Copy 0' })).toHaveLength(2)
  })

  it('isolates two views of the same session and ignores nested conversation roots', async () => {
    const bench = setup()
    const view = render(<>
      <Conversation><Bubble />{bench.action()}<Conversation sessionId="nested"><Bubble /></Conversation></Conversation>
      <Conversation><Bubble />{bench.action()}</Conversation>
    </>)
    await waitFor(() => { expect(screen.getAllByRole('button', { name: en['edit.latest.open'] })).toHaveLength(2) })
    const roots = view.container.querySelectorAll('[data-conversation-content]')
    expect(within(roots[0] as HTMLElement).getAllByRole('button', { name: en['edit.latest.open'] })).toHaveLength(1)
    expect(roots[1]!.querySelector(HOST)).toBeNull()
    expect(roots[2]!.querySelectorAll(HOST)).toHaveLength(1)
  })

  it.each(['no-root', 'wrong-session', 'wrong-node', 'assistant', 'end-clock', 'nested-root'] as const)('fails closed for %s', reason => {
    const bench = setup()
    const bubble = <Bubble nodeKey={reason === 'wrong-node' ? 'other-key' : 'key-a'}
      kind={reason === 'assistant' ? 'assistant' : 'user'} clock={reason === 'end-clock' ? 'end' : 'start'} />
    const contents = <>{reason === 'nested-root' ? <Conversation sessionId="nested">{bubble}</Conversation> : bubble}{bench.action()}</>
    const view = render(reason === 'no-root' ? contents : <Conversation sessionId={reason === 'wrong-session' ? 'other' : 'source'}>{contents}</Conversation>)
    expect(screen.queryByRole('button', { name: en['edit.latest.open'] })).toBeNull()
    expect(view.container.querySelector(HOST)).toBeNull()
    expect(bench.begin).not.toHaveBeenCalled()
  })
})

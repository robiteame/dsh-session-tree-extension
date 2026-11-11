// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LatestPromptEditController } from '../src/client/LatestPromptEditor.tsx'
import { LatestPromptEditorSlot } from '../src/client/LatestPromptEditSlots.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

function bench() {
  const begin = vi.fn(async () => ({ editId: 'edit', nodeId: 'session-event-42', prompt: 'latest', attachmentCount: 0 }))
  const controller = new LatestPromptEditController({ begin, submit: vi.fn() })
  const nodes = [
    { key: 'old', kind: 'user', data: { seq: 1, source: undefined } },
    { key: 'latest', kind: 'steering', data: { seq: 42, source: undefined } },
    { key: 'assistant', kind: 'assistant-step', data: {} },
  ]
  let state = { removed: false, blank: false, subagent: null as unknown, pendingSubmissions: [] as unknown[], running: true }
  let access = true
  const useAccess = vi.fn(() => access)
  const props = {
    sessionId: 'source' as SessionId,
    controller,
    t: (key: keyof typeof zh) => zh[key],
    useSession: (select: (snapshot: typeof state) => unknown) => select(state),
    useChat: (select: (snapshot: unknown) => unknown) => select({ order: nodes.map(node => node.key), nodes: { get: (key: string) => nodes.find(node => node.key === key) } }),
    useAccess,
  }
  const Slot = LatestPromptEditorSlot as unknown as ComponentType<typeof props>
  const View = () => <div data-conversation-content="" data-conversation-session="source">
    <div data-chat-node-key="old" data-chat-flow-kind="user"><div data-clock="start"><button>Old copy</button></div></div>
    <div data-chat-node-key="latest" data-chat-flow-kind="steering"><div data-clock="start"><button>Copy</button></div></div>
    <Slot {...props} />
  </div>
  return { controller, begin, useAccess, View, nodes,
    setState: (change: Partial<typeof state>) => { state = { ...state, ...change } },
    setAccess: (value: boolean) => { access = value },
  }
}

it('respects session access and lifecycle while allowing edits during generation', () => {
  const b = bench()
  const view = render(<b.View />)
  const button = () => screen.getByRole('button', { name: '修改' }) as HTMLButtonElement
  expect(button().disabled).toBe(false)
  expect(b.useAccess).toHaveBeenCalledWith('sessionTree/beginEdit')
  expect(b.useAccess).toHaveBeenCalledWith('sessionTree/submitEdit')
  b.setAccess(false)
  view.rerender(<b.View />)
  expect(button().disabled).toBe(true)
  b.setAccess(true)
  for (const changed of [{ removed: true }, { blank: true }, { subagent: {} }, { pendingSubmissions: [{}] }]) {
    b.setState(changed)
    view.rerender(<b.View />)
    expect(button().disabled).toBe(true)
    b.setState({ removed: false, blank: false, subagent: null, pendingSubmissions: [] })
  }
})

it('offers only the latest user bubble and binds editing to its durable event', () => {
  const b = bench()
  const view = render(<b.View />)
  const button = screen.getByRole('button', { name: '修改' })
  expect(button.closest('[data-chat-node-key]')?.getAttribute('data-chat-node-key')).toBe('latest')
  expect(screen.getAllByRole('button', { name: '修改' })).toHaveLength(1)
  fireEvent.click(button)
  expect(b.begin).toHaveBeenCalledWith('source', 'session-event-42')
  view.unmount()
})

it('omits the bubble action when no durable user prompt is loaded', () => {
  const b = bench()
  b.nodes.splice(0, 2)
  render(<b.View />)
  expect(screen.queryByRole('button', { name: '修改' })).toBeNull()
})

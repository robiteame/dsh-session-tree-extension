// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionTreeView, TreeNode } from '@robiteame/dsh-pi-agent-session-tree/client'
import {
  SessionTreeOverlay,
  SessionTreeOverlayController,
  type SessionTreeRemoteActions,
} from '../src/client/SessionTreeOverlay.tsx'
import { SessionTreeSidebarTab } from '../src/client/SessionTreeSidebarTab.tsx'
import { currentSessionId } from '../src/client/session-list.ts'
import { isInjectedUserNode, nodeFullText } from '../src/client/node-text.ts'
import { zh } from '../src/client/locales.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'

afterEach(cleanup)
const sid = (value: string): SessionId => value as SessionId
const t = (key: string): string => zh[key as keyof typeof zh] ?? key
const emptyView = (sessionId: SessionId): SessionTreeView => ({
  sessionId,
  cursor: null,
  selectedNodeId: null,
  activeBranch: 'main',
  branchHeads: {},
  nodes: [],
  branches: [],
})

function sessionState(current: SessionId | undefined, blank = false) {
  return {
    ids: current === undefined ? [] : [current],
    byId: current === undefined ? {} : {
      [current]: { id: current, retainedBy: { mainView: 1 }, blank },
    },
  } as unknown as SessionListState
}

function useSessionsWith<T>(state: SessionListState): (selector: (value: SessionListState) => T) => T {
  return selector => selector(state)
}

function remoteActions(): SessionTreeRemoteActions {
  return {
    load: vi.fn(async (sessionId: SessionId) => emptyView(sessionId)),
    jump: vi.fn(async () => ({ cursor: null, messages: [] })),
    fork: vi.fn(async () => ({ cursor: '', branch: '', forkCount: 0 })),
    onRefresh: vi.fn(() => () => {}),
  }
}

describe('overlay controller and prompt editor', () => {
  it('normalizes legacy state and emits only real transitions', () => {
    const controller = new SessionTreeOverlayController()
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    expect(controller.getSnapshot()).toEqual({
      open: false,
      nativePanel: false,
      selectorOpen: false,
      promptDraft: null,
    })

    controller.open()
    controller.open()
    expect(listener).toHaveBeenCalledTimes(1)
    controller.openSelector()
    controller.openPromptDraft(sid('s1'), 'draft')
    controller.updatePromptDraft('updated')
    controller.setPromptSending(true)
    controller.setPromptSending(false, 'failed')
    expect(controller.getSnapshot().promptDraft).toMatchObject({
      sessionId: sid('s1'),
      text: 'updated',
      sending: false,
      error: 'failed',
    })
    expect(listener).toHaveBeenCalledTimes(6)

    unsubscribe()
    controller.clearPromptDraft()
    controller.close()
    expect(listener).toHaveBeenCalledTimes(6)

    controller.subscribe(listener)
    controller.dispose()
    expect(controller.getSnapshot()).toEqual({
      open: false,
      nativePanel: false,
      selectorOpen: false,
      promptDraft: null,
    })
    controller.open()
    expect(listener).toHaveBeenCalledTimes(6)
  })

  it('sends, cancels, and reports failures from the fork prompt editor', async () => {
    const controller = new SessionTreeOverlayController()
    const actions = remoteActions()
    const state = sessionState(sid('s1'), true)
    const props = {
      controller,
      remoteActions: actions,
      useSessions: useSessionsWith(state),
      t,
    }

    controller.openPromptDraft(sid('forked'), 'hello world')
    const sendPrompt = vi.fn(async () => {})
    const first = render(<SessionTreeOverlay {...props} sendPrompt={sendPrompt} />)
    const input = document.getElementById('session-tree-fork-prompt') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'updated prompt' } })
    fireEvent.click(screen.getByRole('button', { name: zh['fork.prompt.send'] }))
    await waitFor(() => expect(controller.getSnapshot().promptDraft).toBeNull())
    expect(sendPrompt).toHaveBeenCalledWith(sid('forked'), 'updated prompt')
    first.unmount()

    controller.openPromptDraft(sid('forked'), 'will fail')
    const failure = vi.fn(async () => { throw new Error('send failed') })
    render(<SessionTreeOverlay {...props} sendPrompt={failure} />)
    fireEvent.click(screen.getByRole('button', { name: zh['fork.prompt.send'] }))
    expect(await screen.findByText('send failed')).not.toBeNull()
    expect(controller.getSnapshot().promptDraft).toMatchObject({ sending: false, error: 'send failed' })

    fireEvent.click(screen.getByRole('button', { name: zh['fork.prompt.cancel'] }))
    expect(controller.getSnapshot().promptDraft).toBeNull()
    expect(screen.queryByLabelText(zh['fork.prompt.title'])).toBeNull()
  })

  it('keeps the send action disabled until the draft is non-blank and a sender exists', () => {
    const controller = new SessionTreeOverlayController()
    controller.openPromptDraft(sid('forked'), '   ')
    render(
      <SessionTreeOverlay
        controller={controller}
        remoteActions={remoteActions()}
        useSessions={useSessionsWith(sessionState(sid('s1'), true))}
        t={t}
      />,
    )
    expect((screen.getByRole('button', { name: zh['fork.prompt.send'] }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(document.getElementById('session-tree-fork-prompt')!, { target: { value: 'ready' } })
    expect((screen.getByRole('button', { name: zh['fork.prompt.send'] }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('native sidebar tab and small client helpers', () => {
  it('binds the native tab close action and tolerates omitted optional actions', async () => {
    const close = vi.fn()
    const useTabInfo = () => ({ tab: { actions: { close } } })
    const load = vi.fn(async (sessionId: SessionId) => emptyView(sessionId))
    render(
      <SessionTreeSidebarTab
        useTabInfo={useTabInfo as never}
        sessionId={'s1' as never}
        useSessions={useSessionsWith(sessionState(sid('s1'))) as never}
        t={t as never}
        load={load}
        jump={vi.fn()}
        fork={vi.fn()}
      />,
    )
    expect(await screen.findByRole('button', { name: zh['panel.close'] })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['panel.close'] }))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('prefers the legacy current id and otherwise follows main-view retention', () => {
    const legacy = { ids: [sid('b')], byId: { b: { id: sid('b'), retainedBy: { mainView: 1 } } }, current: sid('a') } as unknown as SessionListState
    expect(currentSessionId(legacy)).toBe(sid('a'))

    const modern = {
      ids: [sid('a'), sid('b')],
      byId: {
        a: { id: sid('a'), retainedBy: { mainView: 0 } },
        b: { id: sid('b'), retainedBy: { mainView: 2 } },
      },
    } as unknown as SessionListState
    expect(currentSessionId(modern)).toBe(sid('b'))
    expect(currentSessionId({ ids: [], byId: {} } as SessionListState)).toBeUndefined()
  })

  it('formats all node content variants and recognizes injected prompts', () => {
    expect(isInjectedUserNode({ nodeId: 'n', parentId: null, branch: 'main', summary: '', createdAt: '', metadata: { injected: true } })).toBe(true)
    const node = {
      nodeId: 'n',
      parentId: null,
      branch: 'main',
      summary: 'fallback',
      createdAt: '',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'reasoning', text: 'why' },
        { type: 'tool_call', id: 'c1', name: 'read', arguments: { path: 'a' } },
        { type: 'tool_result', toolCallId: 'c1', content: 'done' },
        { type: 'text', text: '' },
      ],
    } as unknown as TreeNode
    expect(nodeFullText(node)).toBe('hello\nwhy\nread({"path":"a"})\ndone')

    const empty = { ...node, content: [], message: { role: 'user', content: 'message fallback' } } as unknown as TreeNode
    expect(nodeFullText(empty)).toBe('message fallback')
  })
})

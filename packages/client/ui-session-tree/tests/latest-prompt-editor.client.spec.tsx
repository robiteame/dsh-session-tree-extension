// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LatestPromptEditButton, LatestPromptEditController, LatestPromptEditor, type LatestPromptEditActions } from '../src/client/LatestPromptEditor.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const sid = (id: string): SessionId => id as SessionId
const t = (key: keyof typeof en): string => en[key]
const draft = { editId: 'edit-1', nodeId: 'node-1', prompt: 'Fix login\nKeep the tests', attachmentCount: 2 }
const completed = { sessionId: sid('revised'), nodeId: 'node-2', prompt: 'Corrected prompt' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup(overrides: Partial<LatestPromptEditActions> = {}) {
  const actions = {
    begin: vi.fn(async () => draft),
    submit: vi.fn(async () => completed),
    onComplete: vi.fn(),
    ...overrides,
  }
  const controller = new LatestPromptEditController(actions)
  const renderSession = (sessionId = sid('source'), nodeId?: string) => <>
    <LatestPromptEditButton sessionId={sessionId} nodeId={nodeId} controller={controller} t={t} />
    <LatestPromptEditor sessionId={sessionId} controller={controller} t={t} />
  </>
  return { actions, controller, renderSession }
}

describe('latest prompt editor', () => {
  it('stops before exposing the editable prompt and sends only the revised text once', async () => {
    const stopped = deferred<typeof draft>()
    const submitted = deferred<typeof completed>()
    const bench = setup({ begin: vi.fn(() => stopped.promise), submit: vi.fn(() => submitted.promise) })
    render(bench.renderSession())
    const open = screen.getByRole('button', { name: en['edit.latest.open'] })
    fireEvent.click(open)
    fireEvent.click(open)
    expect(bench.actions.begin).toHaveBeenCalledExactlyOnceWith(sid('source'), undefined)
    expect(screen.getByRole('status').textContent).toBe(en['edit.latest.stopping'])
    expect(screen.queryByRole('textbox')).toBeNull()
    await act(async () => { stopped.resolve(draft) })
    const input = screen.getByRole('textbox', { name: en['edit.latest.title'] }) as HTMLTextAreaElement
    expect(input.value).toBe(draft.prompt)
    expect(document.activeElement).toBe(input)
    expect(screen.getByText(en['edit.latest.hint'])).toBeTruthy()
    expect(screen.getByText('2 original attachments will be kept')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'Corrected prompt\nAdditional constraint' } })
    const resend = screen.getByRole('button', { name: en['edit.latest.send'] })
    fireEvent.click(resend)
    fireEvent.click(resend)
    expect(bench.actions.submit).toHaveBeenCalledExactlyOnceWith(sid('source'), draft.editId, 'Corrected prompt\nAdditional constraint')
    expect((screen.getByRole('button', { name: en['edit.latest.cancel'] }) as HTMLButtonElement).disabled).toBe(true)
    expect(input.readOnly).toBe(true)
    await act(async () => { submitted.resolve(completed) })
    expect(bench.actions.onComplete).toHaveBeenCalledExactlyOnceWith(sid('source'), completed)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(bench.controller.getSnapshot(sid('source')).phase).toBe('idle')
  })

  it('cancels without resuming or sending and discards late stop responses', async () => {
    const stopped = deferred<typeof draft>()
    const bench = setup({ begin: vi.fn(() => stopped.promise) })
    render(bench.renderSession())
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.open'] }))
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.cancel'] }))
    await act(async () => { stopped.resolve(draft) })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(bench.controller.getSnapshot(sid('source')).phase).toBe('idle')
    expect(bench.actions.submit).not.toHaveBeenCalled()
    expect(bench.actions.onComplete).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en['edit.latest.open'] }))
  })

  it('keeps drafts isolated across sessions and pending navigation', async () => {
    const stopped = deferred<typeof draft>()
    const bench = setup({ begin: vi.fn(() => stopped.promise) })
    const mounted = render(bench.renderSession(sid('source')))
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.open'] }))
    mounted.rerender(bench.renderSession(sid('other')))
    await act(async () => { stopped.resolve(draft) })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(bench.controller.getSnapshot(sid('other')).phase).toBe('idle')
    mounted.rerender(bench.renderSession(sid('source')))
    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(input.value).toBe(draft.prompt)
    fireEvent.change(input, { target: { value: 'saved draft' } })
    mounted.rerender(bench.renderSession(sid('other')))
    mounted.rerender(bench.renderSession(sid('source')))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('saved draft')
  })

  it('rejects blank submissions and respects composition while supporting Ctrl/Cmd+Enter', async () => {
    const bench = setup()
    render(bench.renderSession())
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.open'] }))
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '   \n ' } })
    expect((screen.getByRole('button', { name: en['edit.latest.send'] }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(bench.actions.submit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '修正提示词' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(bench.actions.submit).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    await waitFor(() => { expect(bench.actions.submit).toHaveBeenCalledExactlyOnceWith(sid('source'), draft.editId, '修正提示词') })
  })

  it('retries stop failures and retains edited text after a rejected send', async () => {
    const begin = vi.fn().mockRejectedValueOnce(new Error('Host unavailable')).mockResolvedValue(draft)
    const submit = vi.fn().mockRejectedValueOnce(new Error('Try again')).mockResolvedValue(completed)
    const bench = setup({ begin, submit })
    render(bench.renderSession())
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.open'] }))
    expect((await screen.findByRole('alert')).textContent).toContain('Host unavailable')
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.retry'] }))
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'keep this revision' } })
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.send'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Try again') })
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('keep this revision')
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.send'] }))
    await waitFor(() => { expect(bench.actions.onComplete).toHaveBeenCalledOnce() })
    expect(submit).toHaveBeenCalledTimes(2)
  })

  it('opens the requested bubble and keeps that target on retry until cancellation', async () => {
    const begin = vi.fn()
      .mockRejectedValueOnce(new Error('First stop failed'))
      .mockRejectedValueOnce(new Error('Second stop failed'))
      .mockResolvedValue(draft)
    const bench = setup({ begin })
    const mounted = render(bench.renderSession(sid('source'), 'node-a'))
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.open'] }))
    await screen.findByRole('alert')
    mounted.rerender(bench.renderSession(sid('source'), 'node-b'))
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.retry'] }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Second stop failed') })
    expect(begin.mock.calls).toEqual([[sid('source'), 'node-a'], [sid('source'), 'node-a']])
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.cancel'] }))
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.open'] }))
    await screen.findByRole('textbox')
    expect(begin).toHaveBeenLastCalledWith(sid('source'), 'node-b')
  })

  it.each(['resolve', 'reject'] as const)('ignores a cancelled target’s late %s without changing the replacement retry target', async outcome => {
    const first = deferred<typeof draft>()
    const replacement = deferred<typeof draft>()
    const begin = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => replacement.promise)
      .mockResolvedValue(draft)
    const bench = setup({ begin })
    const mounted = render(bench.renderSession(sid('source'), 'node-a'))
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.open'] }))
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.cancel'] }))
    mounted.rerender(bench.renderSession(sid('source'), 'node-b'))
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.open'] }))
    await act(async () => {
      if (outcome === 'resolve') first.resolve(draft)
      else first.reject(new Error('Stale failure'))
    })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(bench.controller.getSnapshot(sid('source')).phase).toBe('loading')
    await act(async () => { replacement.reject(new Error('Replacement failed')) })
    mounted.rerender(bench.renderSession(sid('source'), 'node-c'))
    fireEvent.click(screen.getByRole('button', { name: en['edit.latest.retry'] }))
    await screen.findByRole('textbox')
    expect(begin.mock.calls).toEqual([[sid('source'), 'node-a'], [sid('source'), 'node-b'], [sid('source'), 'node-b']])
  })

  it('merges message action styling with the editor button styling', () => {
    const bench = setup()
    render(<LatestPromptEditButton sessionId={sid('source')} controller={bench.controller} t={t} className="message-action" />)
    const button = screen.getByRole('button')
    expect(button.classList.contains('message-action')).toBe(true)
    expect(button.classList.length).toBe(2)
  })

  it('prevents disabled actions and suppresses updates after disposal', async () => {
    const stopped = deferred<typeof draft>()
    const bench = setup({ begin: vi.fn(() => stopped.promise) })
    render(<LatestPromptEditButton sessionId={sid('source')} controller={bench.controller} t={t} disabled />)
    fireEvent.click(screen.getByRole('button'))
    expect(bench.actions.begin).not.toHaveBeenCalled()
    const listening = vi.fn()
    bench.controller.subscribe(listening)
    const stopping = bench.controller.begin(sid('source'))
    expect(listening).toHaveBeenCalledOnce()
    bench.controller.dispose()
    stopped.resolve(draft)
    await stopping
    expect(bench.controller.getSnapshot(sid('source')).phase).toBe('idle')
    expect(listening).toHaveBeenCalledOnce()
  })
})

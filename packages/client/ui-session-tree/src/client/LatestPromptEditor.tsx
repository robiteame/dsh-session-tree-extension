/** Additive composer controls: stop the source, revise, then continue a preserved branch. */
import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionTreeEditSubmitView, SessionTreeEditView } from '@robiteame/dsh-pi-agent-session-tree/client'
import type { SessionTreeKey } from './locales.ts'
import css from './LatestPromptEditor.module.css'

export interface LatestPromptEditActions {
  begin(sessionId: SessionId, nodeId?: string): Promise<SessionTreeEditView>
  submit(sessionId: SessionId, editId: string, prompt: string): Promise<SessionTreeEditSubmitView>
  onComplete?(sourceSessionId: SessionId, result: SessionTreeEditSubmitView): void
}

export interface LatestPromptEditState {
  readonly phase: 'idle' | 'loading' | 'editing' | 'sending' | 'error'
  readonly editId: string | null
  readonly text: string
  readonly error: string | null
  readonly attachmentCount: number
}

const IDLE: LatestPromptEditState = { phase: 'idle', editId: null, text: '', error: null, attachmentCount: 0 }
const errorText = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

/** Each Session owns its draft and pending operation; navigation never reassigns a result. */
export class LatestPromptEditController {
  private readonly states = new Map<SessionId, LatestPromptEditState>()
  private readonly expectedNodeIds = new Map<SessionId, string | undefined>()
  private readonly listeners = new Set<() => void>()
  private readonly focusTargets = new Map<SessionId, Set<() => void>>()
  private disposed = false

  constructor(private readonly actions: LatestPromptEditActions) {}

  readonly getSnapshot = (sessionId: SessionId): LatestPromptEditState => this.states.get(sessionId) ?? IDLE
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  registerFocusTarget(sessionId: SessionId, focus: () => void): () => void {
    const targets = this.focusTargets.get(sessionId) ?? new Set<() => void>()
    targets.add(focus)
    this.focusTargets.set(sessionId, targets)
    return () => {
      targets.delete(focus)
      if (targets.size === 0) this.focusTargets.delete(sessionId)
    }
  }

  async begin(sessionId: SessionId, nodeId?: string): Promise<void> {
    if (this.disposed) return
    const current = this.getSnapshot(sessionId)
    if (current.phase !== 'idle' && !(current.phase === 'error' && current.editId === null)) return
    // Retrying must keep the original bubble even if the rendered latest node changes.
    if (current.phase === 'idle') this.expectedNodeIds.set(sessionId, nodeId)
    const expectedNodeId = this.expectedNodeIds.get(sessionId)
    const pending: LatestPromptEditState = { ...IDLE, phase: 'loading' }
    this.set(sessionId, pending)
    try {
      const result = await this.actions.begin(sessionId, expectedNodeId)
      if (this.disposed || this.getSnapshot(sessionId) !== pending) return
      this.set(sessionId, { phase: 'editing', editId: result.editId, text: result.prompt, error: null, attachmentCount: result.attachmentCount })
    } catch (cause) {
      if (this.disposed || this.getSnapshot(sessionId) !== pending) return
      this.set(sessionId, { ...IDLE, phase: 'error', error: errorText(cause) })
    }
  }

  update(sessionId: SessionId, text: string): void {
    const current = this.getSnapshot(sessionId)
    if (this.disposed || current.editId === null || current.phase === 'sending') return
    this.set(sessionId, { ...current, text })
  }

  cancel(sessionId: SessionId): void {
    if (this.disposed || this.getSnapshot(sessionId).phase === 'sending') return
    this.states.delete(sessionId)
    this.expectedNodeIds.delete(sessionId)
    this.notify()
    // Wait for React to enable the opener before returning keyboard focus.
    const focus = [...(this.focusTargets.get(sessionId) ?? [])].at(-1)
    queueMicrotask(() => { if (!this.disposed && this.getSnapshot(sessionId).phase === 'idle') focus?.() })
  }

  async submit(sessionId: SessionId): Promise<void> {
    const current = this.getSnapshot(sessionId)
    if (this.disposed || current.editId === null || current.text.trim() === '' || current.phase === 'sending') return
    const pending: LatestPromptEditState = { ...current, phase: 'sending', error: null }
    this.set(sessionId, pending)
    let result: SessionTreeEditSubmitView
    try {
      result = await this.actions.submit(sessionId, current.editId, current.text)
    } catch (cause) {
      if (this.disposed || this.getSnapshot(sessionId) !== pending) return
      this.set(sessionId, { ...current, phase: 'error', error: errorText(cause) })
      return
    }
    if (this.disposed || this.getSnapshot(sessionId) !== pending) return
    // Retire an accepted submission before navigation: navigation failure must
    // never offer another send of an already-running corrected prompt.
    this.states.delete(sessionId)
    this.expectedNodeIds.delete(sessionId)
    this.notify()
    this.actions.onComplete?.(sessionId, result)
  }

  dispose(): void {
    this.disposed = true
    this.states.clear()
    this.expectedNodeIds.clear()
    this.listeners.clear()
    this.focusTargets.clear()
  }

  private set(sessionId: SessionId, state: LatestPromptEditState): void {
    this.states.set(sessionId, state)
    this.notify()
  }

  private notify(): void { for (const listener of this.listeners) listener() }
}

export interface LatestPromptEditorProps {
  sessionId: SessionId
  controller: LatestPromptEditController
  t: (key: SessionTreeKey) => string
  disabled?: boolean
}

export interface LatestPromptEditButtonProps extends LatestPromptEditorProps {
  nodeId?: string
  className?: string
}

function useEditState(controller: LatestPromptEditController, sessionId: SessionId): LatestPromptEditState {
  return useSyncExternalStore(controller.subscribe, () => controller.getSnapshot(sessionId))
}

/** Compact native toolbar entry, available while a generation is running. */
export function LatestPromptEditButton({ sessionId, nodeId, controller, t, disabled, className }: LatestPromptEditButtonProps) {
  const state = useEditState(controller, sessionId)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => controller.registerFocusTarget(sessionId, () => {
    if (button.current?.isConnected) button.current.focus()
  }), [controller, sessionId])
  const open = state.phase !== 'idle'
  return (
    <button
      ref={button}
      type="button"
      className={[css.editButton, className].filter(Boolean).join(' ')}
      title={t('edit.latest.open')}
      aria-label={t('edit.latest.open')}
      aria-expanded={open}
      disabled={disabled || open}
      onClick={() => { void controller.begin(sessionId, nodeId) }}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="m16 3 5 5M4 20l4-1 12-12a2 2 0 0 0-4-4L4 15l-1 6 5-2" />
      </svg>
      <span className={css.buttonLabel}>{t('edit.latest.open')}</span>
    </button>
  )
}

/** Inline dock above the composer, leaving the resident draft untouched. */
export function LatestPromptEditor({ sessionId, controller, t, disabled }: LatestPromptEditorProps) {
  const state = useEditState(controller, sessionId)
  const inputId = useId()
  const hintId = useId()
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (state.editId !== null) input.current?.focus() }, [sessionId, state.editId])
  if (state.phase === 'idle') return null
  const sending = state.phase === 'sending'
  const loading = state.phase === 'loading'
  return (
    <form
      className={css.editor}
      aria-label={t('edit.latest.title')}
      aria-busy={loading || sending}
      onSubmit={event => {
        event.preventDefault()
        if (!disabled) void controller.submit(sessionId)
      }}
    >
      <label className={css.title} htmlFor={inputId}>{t('edit.latest.title')}</label>
      {loading ? <p className={css.hint} role="status">{t('edit.latest.stopping')}</p> : null}
      {state.editId !== null ? <>
        <p className={css.hint} id={hintId}>{t('edit.latest.hint')}</p>
        {state.attachmentCount > 0 ? <p className={css.hint}>{t('edit.latest.attachments').replace('{count}', String(state.attachmentCount))}</p> : null}
        <textarea
          ref={input}
          id={inputId}
          aria-describedby={hintId}
          className={css.input}
          value={state.text}
          readOnly={sending || disabled}
          rows={4}
          onChange={event => { controller.update(sessionId, event.currentTarget.value) }}
          onKeyDown={event => {
            if (event.key !== 'Enter') return
            // Keep all editor Enter presses away from the resident composer.
            event.stopPropagation()
            if (event.nativeEvent.isComposing || !(event.metaKey || event.ctrlKey)) return
            event.preventDefault()
            if (!disabled) void controller.submit(sessionId)
          }}
        />
      </> : null}
      {state.error !== null ? <p className={css.error} role="alert">{t('edit.latest.failed')} {state.error}</p> : null}
      <div className={css.actions}>
        <button type="button" className={css.secondary} disabled={sending} onClick={() => { controller.cancel(sessionId) }}>
          {t('edit.latest.cancel')}
        </button>
        {state.phase === 'error' && state.editId === null ? (
          <button type="button" className={css.primary} disabled={disabled} onClick={() => { void controller.begin(sessionId) }}>
            {t('edit.latest.retry')}
          </button>
        ) : state.editId !== null ? (
          <button type="submit" className={css.primary} disabled={disabled || sending || state.text.trim() === ''}>
            {t(sending ? 'edit.latest.sending' : 'edit.latest.send')}
          </button>
        ) : null}
      </div>
    </form>
  )
}

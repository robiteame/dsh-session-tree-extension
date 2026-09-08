/** Additive fallback drawer for Harness releases without a named details-panel slot. */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JumpView, SessionTreeForkView, SessionTreeView } from '@robiteame/dsh-pi-agent-session-tree/client'
import { SessionTreePanel } from './SessionTreePanel.tsx'
import css from './SessionTreePanel.module.css'

export interface SessionTreeOverlayState {
  open: boolean
  nativePanel: boolean
  /** Added in the fork selector release; omitted by legacy state producers. */
  selectorOpen?: boolean
  /** Added in the fork prompt editor release; omitted by legacy state producers. */
  promptDraft?: { sessionId: SessionId; text: string; sending: boolean; error: string | null } | null
}

interface SessionTreeOverlaySnapshot {
  open: boolean
  nativePanel: boolean
  selectorOpen: boolean
  promptDraft: { sessionId: SessionId; text: string; sending: boolean; error: string | null } | null
}

/** Minimal external store shared by the command listener and the React drawer. */
export class SessionTreeOverlayController {
  private state: SessionTreeOverlaySnapshot = { open: false, nativePanel: false, selectorOpen: false, promptDraft: null }
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): SessionTreeOverlaySnapshot => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open(): void { this.update({ ...this.state, open: true, selectorOpen: false }) }
  close(): void { this.update({ ...this.state, open: false, selectorOpen: false, promptDraft: null }) }
  openSelector(): void { this.update({ ...this.state, open: true, selectorOpen: true, promptDraft: null }) }
  closeSelector(): void { this.update({ ...this.state, open: false, selectorOpen: false }) }
  openPromptDraft(sessionId: SessionId, text: string): void {
    this.update({ ...this.state, open: true, selectorOpen: false, promptDraft: { sessionId, text, sending: false, error: null } })
  }
  updatePromptDraft(text: string): void {
    if (this.state.promptDraft === null) return
    this.update({ ...this.state, promptDraft: { ...this.state.promptDraft, text } })
  }
  setPromptSending(sending: boolean, error: string | null = null): void {
    if (this.state.promptDraft === null) return
    this.update({ ...this.state, promptDraft: { ...this.state.promptDraft, sending, error } })
  }
  clearPromptDraft(): void { this.update({ ...this.state, promptDraft: null }) }

  setNativePanel(nativePanel: boolean): void {
    this.update({ ...this.state, nativePanel })
  }

  dispose(): void {
    this.listeners.clear()
    this.state = { open: false, nativePanel: false, selectorOpen: false, promptDraft: null }
  }

  private update(next: SessionTreeOverlaySnapshot): void {
    if (
      next.open === this.state.open
      && next.nativePanel === this.state.nativePanel
      && next.selectorOpen === this.state.selectorOpen
      && next.promptDraft === this.state.promptDraft
    ) return
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

export interface SessionTreeRemoteActions {
  load(sessionId: SessionId): Promise<SessionTreeView>
  jump(sessionId: SessionId, nodeId: string | null): Promise<JumpView>
  fork(sessionId: SessionId, nodeId: string, branch: string): Promise<SessionTreeForkView>
  onRefresh(sessionId: SessionId, callback: () => void): () => void
}

export type SessionTreeOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'session-tree'>
  & {
    controller: SessionTreeOverlayController
    remoteActions: SessionTreeRemoteActions
    openSession?: (sessionId: SessionId) => void
    sendPrompt?: (sessionId: SessionId, text: string) => Promise<void>
  }

/**
 * Render an additive right-side drawer without replacing Harness' Tool details
 * occupant. The root stays mounted as a browser-visible activation marker;
 * only the drawer opts back into pointer events.
 */
export function SessionTreeOverlay({
  controller,
  remoteActions,
  openSession,
  sendPrompt,
  useSessions,
  t,
}: SessionTreeOverlayProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const sessionId = useSessions((sessions) => {
    const current = sessions.current
    return current !== undefined && sessions.byId[current]?.blank === false ? current : undefined
  })
  const previousSession = useRef<SessionId | undefined>(sessionId)
  useEffect(() => {
    const previous = previousSession.current
    previousSession.current = sessionId
    if (previous !== undefined && sessionId !== previous) {
      // A fork switches sessions while its editable prompt remains visible.
      if (controller.getSnapshot().promptDraft === null) controller.close()
      else controller.closeSelector()
    }
  }, [controller, sessionId])
  const visible = state.open && !state.nativePanel && sessionId !== undefined

  return (
    <div
      className={css.overlayRoot}
      data-session-tree-overlay="mounted"
      data-open={visible || undefined}
    >
      {visible
        ? <aside className={css.overlayDrawer} aria-label={state.selectorOpen ? t('fork.selector.title') : t('panel.title')}>
            <SessionTreePanel
              panel="session-tree"
              sessionId={sessionId}
              load={remoteActions.load}
              jump={nodeId => remoteActions.jump(sessionId, nodeId)}
              fork={(nodeId, branch) => remoteActions.fork(sessionId, nodeId, branch)}
              mode={state.selectorOpen ? 'selectUserPrompt' : 'tree'}
              modeController={controller}
              useSessions={useSessions}
              onRefresh={callback => remoteActions.onRefresh(sessionId, callback)}
              onForkCompleted={result => {
                if (result.sessionId !== undefined) openSession?.(result.sessionId)
                if (result.prompt !== undefined && result.sessionId !== undefined) {
                  controller.openPromptDraft(result.sessionId, result.prompt)
                }
              }}
              closeDetails={() => { controller.close() }}
              t={t}
            />
          </aside>
        : null}
      {state.promptDraft !== null ? (
        <form
          className={css.promptEditor}
          aria-label={t('fork.prompt.title')}
          onSubmit={event => {
            event.preventDefault()
            const draft = state.promptDraft
            if (draft === null || sendPrompt === undefined || draft.sending) return
            controller.setPromptSending(true)
            void sendPrompt(draft.sessionId, draft.text)
              .then(() => { controller.clearPromptDraft() })
              .catch((cause: unknown) => {
                controller.setPromptSending(false, cause instanceof Error ? cause.message : String(cause))
              })
          }}
        >
          <label className={css.promptTitle} htmlFor="session-tree-fork-prompt">{t('fork.prompt.title')}</label>
          <textarea
            id="session-tree-fork-prompt"
            className={css.promptInput}
            value={state.promptDraft.text}
            readOnly={state.promptDraft.sending}
            onChange={event => { controller.updatePromptDraft(event.currentTarget.value) }}
          />
          {state.promptDraft.error !== null ? <p className={css.promptError}>{state.promptDraft.error}</p> : null}
          <div className={css.promptActions}>
            <button type="button" disabled={state.promptDraft.sending} onClick={() => { controller.clearPromptDraft() }}>
              {t('fork.prompt.cancel')}
            </button>
            <button type="submit" disabled={sendPrompt === undefined || state.promptDraft.text.trim() === '' || state.promptDraft.sending}>
              {t('fork.prompt.send')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

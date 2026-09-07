/** Additive fallback drawer for Harness releases without a named details-panel slot. */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JumpView, SessionTreeView } from '@robiteame/dsh-pi-agent-session-tree/client'
import { SessionTreePanel } from './SessionTreePanel.tsx'
import css from './SessionTreePanel.module.css'

export interface SessionTreeOverlayState {
  open: boolean
  nativePanel: boolean
}

/** Minimal external store shared by the command listener and the React drawer. */
export class SessionTreeOverlayController {
  private state: SessionTreeOverlayState = { open: false, nativePanel: false }
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): SessionTreeOverlayState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open(): void { this.update({ ...this.state, open: true }) }
  close(): void { this.update({ ...this.state, open: false }) }

  setNativePanel(nativePanel: boolean): void {
    this.update({ ...this.state, nativePanel })
  }

  dispose(): void {
    this.listeners.clear()
    this.state = { open: false, nativePanel: false }
  }

  private update(next: SessionTreeOverlayState): void {
    if (next.open === this.state.open && next.nativePanel === this.state.nativePanel) return
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

export interface SessionTreeRemoteActions {
  load(sessionId: SessionId): Promise<SessionTreeView>
  jump(sessionId: SessionId, nodeId: string | null): Promise<JumpView>
  fork(sessionId: SessionId, nodeId: string, branch: string): Promise<{ cursor: string; branch: string; forkCount: number }>
  onRefresh(sessionId: SessionId, callback: () => void): () => void
}

export type SessionTreeOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'session-tree'>
  & {
    controller: SessionTreeOverlayController
    remoteActions: SessionTreeRemoteActions
  }

/**
 * Render an additive right-side drawer without replacing Harness' Tool details
 * occupant. The root stays mounted as a browser-visible activation marker;
 * only the drawer opts back into pointer events.
 */
export function SessionTreeOverlay({
  controller,
  remoteActions,
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
    if (previous !== undefined && sessionId !== previous) controller.close()
  }, [controller, sessionId])
  const visible = state.open && !state.nativePanel && sessionId !== undefined

  return (
    <div
      className={css.overlayRoot}
      data-session-tree-overlay="mounted"
      data-open={visible || undefined}
    >
      {visible
        ? <aside className={css.overlayDrawer} aria-label={t('panel.title')}>
            <SessionTreePanel
              panel="session-tree"
              sessionId={sessionId}
              load={remoteActions.load}
              jump={nodeId => remoteActions.jump(sessionId, nodeId)}
              fork={(nodeId, branch) => remoteActions.fork(sessionId, nodeId, branch)}
              onRefresh={callback => remoteActions.onRefresh(sessionId, callback)}
              closeDetails={() => { controller.close() }}
              t={t}
            />
          </aside>
        : null}
    </div>
  )
}

/** Browser half of the session-tree extension: a right-details-sidebar panel. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import sessionTreeRemote from '@robiteame/dsh-pi-agent-session-tree/remote'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { CommandResult } from '@deepseek-ai/dsh-commands/types'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'command/executed'(sessionId: SessionId, name: string, result: CommandResult): void
  }
}
import type { SessionTreeView } from '@robiteame/dsh-pi-agent-session-tree/client'
import type { SessionTreePanelActions } from './slots.ts'
import { SessionTreeDock } from './SessionTreePanel.tsx'
import {
  SessionTreeOverlay,
  SessionTreeOverlayController,
  type SessionTreeRemoteActions,
} from './SessionTreeOverlay.tsx'
import { en, zh, type SessionTreeKey } from './locales.ts'

export { SessionTreePanel, SessionTreeDock } from './SessionTreePanel.tsx'
export { SessionTreeOverlay, SessionTreeOverlayController } from './SessionTreeOverlay.tsx'
export type { SessionTreeOverlayProps, SessionTreeOverlayState } from './SessionTreeOverlay.tsx'
export type { SessionTreePanelActions, SessionTreeViewProps } from './slots.ts'
export type { SessionTreeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'session-tree': SessionTreeKey }
}

const NS = 'session-tree'
export const inject = ['slots', 'sessions', 'remote', 'locale', 'layout']

/** Register UI only after the generated Remote namespace has been mounted. */
function registerSessionTreeUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-session-tree: dictionaries')
  const refreshers = new Map<SessionId, Set<() => void>>()
  ctx.effect(() => () => { refreshers.clear() }, 'ui-session-tree: refreshers')
  const overlay = new SessionTreeOverlayController()
  ctx.effect(() => () => { overlay.dispose() }, 'ui-session-tree: overlay state')

  const remoteActions: SessionTreeRemoteActions = {
    load: async (sessionId) => {
      const answered = await ctx.remote.sessionTree.list(sessionId)
      if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
      return answered.value
    },
    jump: async (sessionId, nodeId) => {
      const answered = await ctx.remote.sessionTree.jump(sessionId, nodeId)
      if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
      return answered.value
    },
    fork: async (sessionId, nodeId, branch) => {
      const answered = await ctx.remote.sessionTree.fork(sessionId, nodeId, branch)
      if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
      return answered.value
    },
    onRefresh: (sessionId, callback) => {
      const set = refreshers.get(sessionId) ?? new Set<() => void>()
      set.add(callback); refreshers.set(sessionId, set)
      return () => { set.delete(callback); if (set.size === 0) refreshers.delete(sessionId) }
    },
  }

  // Every supported official Web profile declares this additive root slot.
  // It remains a dormant fallback when the legacy source patch supplies the
  // richer named details-panel slot below.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'session-tree', order: 10, locale: NS,
    inject: () => ({ controller: overlay, remoteActions }),
  }, SessionTreeOverlay))

  // The legacy source patch owns this optional slot. Mirror its exact
  // declaration lifetime so HMR never shows both surfaces at once.
  ctx.slots.inject('conversation.details.panel' as never, () => {
    const disposePanel = ctx.slots.register({
      name: 'conversation.details.panel', id: 'session-tree', order: 10, locale: NS,
      inject: (sessionId: SessionId): SessionTreePanelActions => ({
        load: remoteActions.load,
        jump: nodeId => remoteActions.jump(sessionId, nodeId),
        fork: (nodeId, branch) => remoteActions.fork(sessionId, nodeId, branch),
        onRefresh: callback => remoteActions.onRefresh(sessionId, callback),
      }),
    } as never, SessionTreeDock as never)
    overlay.setNativePanel(true)
    return () => {
      disposePanel()
      overlay.setNativePanel(false)
    }
  })

  ctx.on('command/executed', (sessionId: SessionId, name: string, result: CommandResult) => {
    if (name === 'tree') {
      if (overlay.getSnapshot().nativePanel) {
        (ctx.layout.openDetails as (panel?: string) => void)('session-tree')
      } else {
        overlay.open()
      }
    }
    if (name === 'clone' && result.kind === 'success' && result.text !== undefined) {
      try {
        const payload = JSON.parse(result.text) as { value?: { sessionId?: string } }
        const clonedId = payload.value?.sessionId
        if (typeof clonedId === 'string') ctx.sessions.open(clonedId as SessionId)
      } catch {
        // A non-JSON success is still a valid Host outcome; it simply has no navigable clone id.
      }
    }
    if (name === 'tree' || name === 'fork' || name === 'clone') {
      for (const refresh of refreshers.get(sessionId) ?? []) refresh()
    }
  })
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(sessionTreeRemote)
  // `remote.sessionTree` is created by $mount above. Cordis nested services must
  // be declared explicitly, so consume it from a child injection scope rather
  // than reading it from the outer scope that only injects `remote`.
  const ui = ctx.inject(
    ['slots', 'sessions', 'remote.sessionTree', 'locale', 'layout'],
    registerSessionTreeUi,
  )
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await unmountRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await unmountRemote()
  }
}

export type LoadedSessionTreeView = SessionTreeView

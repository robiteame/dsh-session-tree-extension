/**
 * Session-tree panel, browser half: the `conversation.input.dock` entry that
 * renders the agent's session tree above the composer. The panel reads the
 * live tree through the generated `sessionTree` Remote service (the same
 * process-wide store the tool and /tree command write), auto-expands when
 * the composer draft starts with `/tree`, and jumps the tree cursor when the
 * user clicks a node.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import sessionTreeRemote from '@deepseek-ai/dsh-pi-agent-session-tree/remote'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin and renderer Context merges.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionTreeView } from '@deepseek-ai/dsh-pi-agent-session-tree/client'
import type { SessionTreePanelActions } from './slots.ts'
import { SessionTreeDock } from './SessionTreePanel.tsx'
import { en, zh, type SessionTreeKey } from './locales.ts'

export { SessionTreePanel, SessionTreeDock } from './SessionTreePanel.tsx'
export type { SessionTreePanelActions, SessionTreeViewProps } from './slots.ts'
export type { SessionTreeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The session-tree panel's copy. */
    'session-tree': SessionTreeKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'session-tree'

/** Required services for the dock, the Session kit, the Remote carrier, and copy. */
export const inject = ['slots', 'sessions', 'remote', 'locale']

/**
 * Client plugin body: the SessionTreePanel dock entry with its Remote verbs.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(sessionTreeRemote)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-session-tree: dictionaries')

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'session-tree',
    order: 30,
    locale: NS,
    inject: (sessionId: SessionId): SessionTreePanelActions => ({
      /** Read the complete live tree view for one agent session. */
      load: async () => {
        const answered = await ctx.remote.sessionTree.list(sessionId)
        if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
        return answered.value
      },
      /** Move the tree cursor to one node (old branches stay intact). */
      jump: async (nodeId: string | null) => {
        const answered = await ctx.remote.sessionTree.jump(sessionId, nodeId)
        if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
        return answered.value
      },
      fork: async (nodeId: string, branch: string) => {
        const answered = await ctx.remote.sessionTree.fork(sessionId, nodeId, branch)
        if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`)
        return answered.value
      },
    }),
  }, SessionTreeDock))

  return unmountRemote
}

/** Re-export the view type so callers can type the loaded payload. */
export type LoadedSessionTreeView = SessionTreeView

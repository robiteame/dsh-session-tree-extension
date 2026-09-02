/** Session tree's injected face for the right details-sidebar panel seat. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JumpView, SessionTreeView } from '@deepseek-ai/dsh-pi-agent-session-tree/client'

export interface SessionTreePanelActions {
  load: (sessionId: SessionId) => Promise<SessionTreeView>
  jump: (nodeId: string | null) => Promise<JumpView>
  select?: (nodeId: string) => Promise<{ nodeId: string }>
  fork: (nodeId: string, branch: string) => Promise<{ cursor: string; branch: string; forkCount: number }>
  onRefresh?: (callback: () => void) => () => void
}

export type SessionTreeViewProps =
  import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.details.panel'>
  & SessionTreePanelActions
  & { t: (key: import('./locales.ts').SessionTreeKey) => string; [key: string]: unknown }

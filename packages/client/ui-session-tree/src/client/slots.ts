/** Session tree's injected face for the right details-sidebar panel seat. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JumpView, SessionTreeForkView, SessionTreeView, TreeNode } from '@robiteame/dsh-pi-agent-session-tree/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'

/** Minimal reactive face used by both the fallback drawer and native panel. */
export interface SessionTreePanelModeController {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => { readonly selectorOpen: boolean }
}

export interface SessionTreePanelActions {
  load: (sessionId: SessionId) => Promise<SessionTreeView>
  jump: (nodeId: string | null) => Promise<JumpView>
  select?: (nodeId: string) => Promise<{ nodeId: string }>
  fork: (nodeId: string, branch: string) => Promise<SessionTreeForkView>
  /** Selector-only native fork path. Sidebar fork actions continue to use `fork`. */
  forkUserPrompt?: (node: TreeNode) => Promise<void>
  onRefresh?: (callback: () => void) => () => void
  modeController?: SessionTreePanelModeController
}

/** Props the visual tree actually consumes, independent of its slot adapter. */
export type SessionTreeViewProps = SessionTreePanelActions & {
  sessionId: SessionId
  panel?: string
  mode?: 'tree' | 'selectUserPrompt'
  useSessions?: <T>(selector: (state: SessionListState) => T) => T
  onForkCompleted?: (result: SessionTreeForkView) => void
  closeDetails?: () => void
  t: (key: import('./locales.ts').SessionTreeKey) => string
}

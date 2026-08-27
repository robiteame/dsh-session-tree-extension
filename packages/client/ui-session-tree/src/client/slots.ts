/**
 * SessionTreePanel's injected face. The target 'conversation.input.dock' slot
 * is declared (children table) and typed by ui-conversation; this package only
 * contributes the entry, so no SlotMap merge lives here. Inject carries the
 * two Remote verbs; live state arrives from the panel's own `load` call.
 */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { JumpView, SessionTreeView } from '@deepseek-ai/dsh-pi-agent-session-tree/client'

/** Injected business face of the dock entry: read the tree and jump the cursor. */
export interface SessionTreePanelActions {
  /**
   * Read the complete live tree view for one agent session.
   * @returns the current view (nodes, branches, cursor).
   * @throws Error with the Remote error code and message when the read fails.
   */
  load: (sessionId: SessionId) => Promise<SessionTreeView>
  /**
   * Move the tree cursor to one node; the node's root-to-node path is
   * replayed, and old branches remain intact.
   * @param nodeId - target node id.
   * @returns the new cursor and reconstructed messages.
   * @throws Error with the Remote error code and message when the node is unknown.
   */
  jump: (nodeId: string) => Promise<JumpView>
}

/** Full props of the dock entry: the framework standard kit plus the injected face. */
export type SessionTreeViewProps =
  import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.dock'>
  & SessionTreePanelActions

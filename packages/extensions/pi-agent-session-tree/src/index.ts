/**
 * Session-tree domain service: the append-only multi-branch conversation
 * tree, one per agent session, served to the browser through the generated
 * `sessionTree` Remote namespace.
 *
 * Design notes
 * - A process-wide store keeps every session's tree; the companion
 *   `@deepseek-ai/dsh-tool-session-tree` plugin shares the same store, so
 *   anything the model appends is immediately visible to the browser panel
 *   and vice versa.
 * - Trees are in-memory for the process lifetime; `snapshot.save` /
 *   `snapshot.load` (tool operations) carry them across processes.
 * - Every operation answers `{ok, value}|{ok:false,error}` from the domain
 *   layer; the Remote boundary adds its own transport envelope.
 *
 * @module @deepseek-ai/dsh-pi-agent-session-tree
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { sessionTreeStore } from './session-tree.ts'
import type { JumpView, SessionTreeView } from './types.ts'

export { SessionTree, SessionTreeStore, sessionTreeStore } from './session-tree.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionTree: SessionTreeService
  }
}

/** Remote-only service backing the browser tree panel. */
export class SessionTreeService extends TypertRemoteService {
  /**
   * Register the service under `sessionTree`.
   * @param ctx - owning Cordis Context.
   */
  constructor(ctx: Context) {
    super(ctx, 'sessionTree')
  }

  /**
   * Read the current tree view (nodes, branches, cursor) for one agent.
   * The tree is created on first read, so an empty panel is valid.
   * @param agent - owning live agent.
   * @returns the complete view for the panel.
   */
  @Remote('list')
  list(agent: Agent): SessionTreeView {
    const sessionId = agent.session.id
    return (sessionTreeStore.get(sessionId) ?? sessionTreeStore.create(sessionId)).view()
  }

  /**
   * Move the cursor to an existing node and replay its root-to-node path.
   * Old branches remain intact.
   * @param agent - owning live agent.
   * @param nodeId - target node, or null to reset before the first node.
   * @returns the new cursor and reconstructed messages.
   * @throws Error when the node does not exist (settles as the standard error envelope).
   */
  @Remote('jump')
  jump(agent: Agent, nodeId: string | null): JumpView {
    const sessionId = agent.session.id
    const tree = sessionTreeStore.get(sessionId)
    if (tree === undefined) throw new Error(`session '${sessionId}' was not found`)
    const result = tree.jump(nodeId)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }
}

export default SessionTreeService

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
import { sessionTreeStore, type SessionTree } from './session-tree.ts'
import { sessionEventsToTreeNodes } from './session-event-adapter.ts'
import type { JumpView, SessionTreeSessionInfo, SessionTreeView } from './types.ts'

export { SessionTree, SessionTreeStore, sessionTreeStore } from './session-tree.ts'
export type * from './types.ts'
export { sessionEventsToTreeNodes } from './session-event-adapter.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionTree: SessionTreeService
  }
}

/** Materialize native Harness history once, preserving tool-side tree ownership afterwards. */
function treeForAgent(agent: Agent): SessionTree {
  const sessionId = agent.session.id
  const existing = sessionTreeStore.get(sessionId)
  if (existing !== undefined) return existing
  const tree = sessionTreeStore.create(sessionId)
  const nodes = sessionEventsToTreeNodes(agent.session.events)
  if (nodes.length > 0) {
    const restored = tree.replay(nodes.map((node, seq) => ({ seq, node })))
    if (!restored.ok) throw new Error(`${restored.error.code}: ${restored.error.message}`)
  }
  return tree
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
    return treeForAgent(agent).view()
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
    const tree = treeForAgent(agent)
    const result = tree.jump(nodeId)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }

  /** Read compact status metadata for the current session tree. */
  @Remote('session')
  session(agent: Agent): SessionTreeSessionInfo {
    return treeForAgent(agent).info()
  }
}

export default SessionTreeService

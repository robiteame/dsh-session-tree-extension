/**
 * Append-only multi-branch session tree. One tree owns one sessionId; the
 * store holds many trees side by side. All mutations are additions: a node
 * is never edited or removed after creation, and navigation only moves the
 * cursor, so every history branch survives (PI-Agent SessionTree semantics:
 * append-only entries, leaf-pointer branching, root-to-leaf message paths).
 *
 * @module @deepseek-ai/dsh-pi-agent-session-tree/session-tree
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  BranchView,
  JsonValue,
  JumpView,
  LlmMessage,
  SessionTreeSnapshot,
  SessionTreeView,
  TreeNode,
  TreeErrorCode,
  TreeResult,
} from './types.ts'

const SNAPSHOT_VERSION = 1

const fail = <T>(code: TreeErrorCode, message: string): TreeResult<T> =>
  ({ ok: false, error: { code, message } })

/** Deep-clone a JSON-safe value so callers can never alias internal nodes. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Mint a short unique node id (collision-safe enough for one store). */
function nodeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** One stored node plus the internal cursor bookkeeping. */
export class SessionTree {
  private readonly nodesById = new Map<string, TreeNode>()
  private cursorId: string | null = null
  private activeBranchName = 'main'

  /**
   * Create an empty tree, or restore one from a versioned snapshot.
   * @param sessionId - owning session identity.
   * @param snapshot - optional durable snapshot to restore.
   * @throws Error when the snapshot is malformed (version, ownership, cursor).
   */
  constructor(readonly sessionId: SessionId, snapshot?: unknown) {
    if (snapshot === undefined) return
    if (!isSnapshot(snapshot, sessionId)) throw new Error('invalid session tree snapshot')
    for (const node of snapshot.nodes) this.nodesById.set(node.nodeId, clone(node))
    this.cursorId = snapshot.cursor
    if (typeof snapshot.activeBranch === 'string') this.activeBranchName = snapshot.activeBranch
  }

  /** @returns the current cursor node id, or null before the first append. */
  get cursor(): string | null {
    return this.cursorId
  }

  /** @returns the branch label the next append joins. */
  get activeBranch(): string {
    return this.activeBranchName
  }

  /**
   * Append one new node as a child of the cursor. The cursor's parent chain
   * is never touched; the new node joins the active branch unless one is
   * named. Historical nodes stay byte-identical.
   * @param message - standard LLM message to carry.
   * @param options - optional branch override, summary, and JSON extras.
   * @returns the created node, or a standard error for invalid input.
   */
  append(
    message: LlmMessage,
    options: { branch?: string; summary?: string; metadata?: Record<string, JsonValue> } = {},
  ): TreeResult<TreeNode> {
    if (!isMessage(message)) return fail('INVALID_ARGUMENT', 'message.role and message.content are required')
    const branch = options.branch === undefined ? this.activeBranchName : options.branch.trim()
    if (branch.length === 0) return fail('INVALID_ARGUMENT', 'branch must not be empty')
    const node: TreeNode = {
      nodeId: nodeId(),
      parentId: this.cursorId,
      branch,
      summary: options.summary?.trim() || summarize(message.content),
      createdAt: new Date().toISOString(),
      message: clone(message),
      ...(options.metadata === undefined ? {} : { metadata: clone(options.metadata) }),
    }
    this.nodesById.set(node.nodeId, node)
    this.cursorId = node.nodeId
    this.activeBranchName = branch
    return { ok: true, value: clone(node) }
  }

  /**
   * Move the cursor to an existing node (root-to-node path replay). Old
   * branches remain intact; the next append forks from the target.
   * @param target - target node id, or null to reset before any node.
   * @returns the new cursor and the reconstructed root-to-cursor messages.
   */
  jump(target: string | null): TreeResult<JumpView> {
    if (target !== null && !this.nodesById.has(target)) {
      return fail('NODE_NOT_FOUND', `node '${target}' was not found`)
    }
    this.cursorId = target
    const node = target === null ? undefined : this.nodesById.get(target)
    this.activeBranchName = node?.branch ?? this.activeBranchName
    return { ok: true, value: { cursor: this.cursorId, messages: this.messagesFrom(target) } }
  }

  /**
   * Set the branch label the next append joins and park the cursor at the
   * chosen node, without appending anything.
   * @param target - node to branch from (must exist).
   * @param branch - new branch label (non-empty).
   * @returns the new cursor and branch.
   */
  branch(target: string, branch: string): TreeResult<{ cursor: string; branch: string }> {
    if (!this.nodesById.has(target)) return fail('NODE_NOT_FOUND', `node '${target}' was not found`)
    const trimmed = branch.trim()
    if (trimmed.length === 0) return fail('INVALID_ARGUMENT', 'branch must not be empty')
    this.cursorId = target
    this.activeBranchName = trimmed
    return { ok: true, value: { cursor: target, branch: trimmed } }
  }

  /**
   * Branch with a summary of the abandoned path: park the cursor at `target`
   * (like {@link branch}), then append a summary node whose parent is the
   * target. The abandoned branch's nodes stay untouched.
   * @param target - node to branch from.
   * @param summary - summary text stored on the new node.
   * @returns the created summary node.
   */
  branchWithSummary(target: string, summary: string): TreeResult<TreeNode> {
    if (!this.nodesById.has(target)) return fail('NODE_NOT_FOUND', `node '${target}' was not found`)
    if (summary.trim().length === 0) return fail('INVALID_ARGUMENT', 'summary must not be empty')
    this.cursorId = target
    const node: TreeNode = {
      nodeId: nodeId(),
      parentId: target,
      branch: this.activeBranchName,
      summary: summary.trim(),
      createdAt: new Date().toISOString(),
      metadata: { kind: 'branch_summary', from: target },
    }
    this.nodesById.set(node.nodeId, node)
    this.cursorId = node.nodeId
    return { ok: true, value: clone(node) }
  }

  /**
   * Reconstruct the standard LLM messages array for the path root→node
   * (defaults to the cursor). System/user/assistant/tool messages keep their
   * roles; branch-summary nodes carry no message and stay out of the array.
   * @param from - target node id, or null for the empty path.
   * @returns messages in conversation order (root first).
   */
  messages(from: string | null = this.cursorId): LlmMessage[] {
    return this.messagesFrom(from)
  }

  /**
   * @returns all nodes in creation order (defensive copies).
   */
  list(): TreeNode[] {
    return clone([...this.nodesById.values()])
  }

  /**
   * @returns one aggregated view per distinct branch, in first-use order.
   */
  branches(): BranchView[] {
    const groups = new Map<string, string[]>()
    for (const node of this.nodesById.values()) {
      const ids = groups.get(node.branch) ?? []
      ids.push(node.nodeId)
      groups.set(node.branch, ids)
    }
    return [...groups].map(([name, nodeIds]) => {
      const last = nodeIds[nodeIds.length - 1]
      return {
        name,
        headId: last === undefined ? '' : last,
        nodeIds,
      }
    })
  }

  /** @returns the full read view served to the browser panel. */
  view(): SessionTreeView {
    return {
      sessionId: this.sessionId,
      cursor: this.cursorId,
      activeBranch: this.activeBranchName,
      nodes: this.list(),
      branches: this.branches(),
    }
  }

  /** @returns a versioned durable snapshot (defensive copy). */
  snapshot(): SessionTreeSnapshot {
    return clone({
      version: SNAPSHOT_VERSION,
      sessionId: this.sessionId,
      cursor: this.cursorId,
      activeBranch: this.activeBranchName,
      nodes: [...this.nodesById.values()],
    })
  }

  /** @returns true when a node with this id exists. */
  has(nodeId: string): boolean {
    return this.nodesById.has(nodeId)
  }

  private messagesFrom(from: string | null): LlmMessage[] {
    const path: LlmMessage[] = []
    let current = from
    while (current !== null) {
      const node = this.nodesById.get(current)
      if (node === undefined) break
      if (node.message !== undefined) path.push(clone(node.message))
      current = node.parentId
    }
    return path.reverse()
  }
}

/** Keyed store: many independent trees coexist, one per session. */
export class SessionTreeStore {
  private readonly trees = new Map<string, SessionTree>()

  /** Create (or reset) the tree for one session. */
  create(sessionId: SessionId): SessionTree {
    const tree = new SessionTree(sessionId)
    this.trees.set(sessionId, tree)
    return tree
  }

  /** Look up a tree without creating one. */
  get(sessionId: SessionId): SessionTree | undefined {
    return this.trees.get(sessionId)
  }

  /** Look up a tree, or return the standard SESSION_NOT_FOUND error. */
  require(sessionId: SessionId): TreeResult<SessionTree> {
    const tree = this.trees.get(sessionId)
    return tree === undefined
      ? fail('SESSION_NOT_FOUND', `session '${sessionId}' was not found`)
      : { ok: true, value: tree }
  }

  /** Replace one session's tree from a snapshot. */
  load(snapshot: SessionTreeSnapshot): TreeResult<{ sessionId: string }> {
    try {
      const tree = new SessionTree(snapshot.sessionId as SessionId, snapshot)
      this.trees.set(tree.sessionId, tree)
      return { ok: true, value: { sessionId: tree.sessionId } }
    } catch (error) {
      return fail('INVALID_SNAPSHOT', error instanceof Error ? error.message : 'invalid snapshot')
    }
  }

  /** @returns all session ids with a live tree, in creation order. */
  list(): string[] {
    return [...this.trees.keys()]
  }
}

/** Validate one carried message (role must be a known role, content a string). */
function isMessage(value: unknown): value is LlmMessage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.role === 'string'
    && ['system', 'user', 'assistant', 'tool'].includes(record.role)
    && typeof record.content === 'string'
}

/** Validate one restored snapshot: version, ownership, nodes, and cursor. */
function isSnapshot(value: unknown, sessionId: SessionId): value is SessionTreeSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.version !== SNAPSHOT_VERSION || record.sessionId !== sessionId) return false
  const nodes = record.nodes as unknown[]
  if (nodes.some(node => !isNode(node))) return false
  const cursor = record.cursor
  if (cursor !== null && typeof cursor !== 'string') return false
  if (typeof cursor === 'string' && !(nodes as TreeNode[]).some(node => node.nodeId === cursor)) return false
  return typeof record.activeBranch === 'string'
}

/** Validate one restored node before it enters the tree. */
function isNode(value: unknown): value is TreeNode {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.nodeId === 'string'
    && (record.parentId === null || typeof record.parentId === 'string')
    && typeof record.branch === 'string'
    && typeof record.summary === 'string'
    && typeof record.createdAt === 'string'
}

/** Human-readable preview for a node without an explicit summary. */
function summarize(content: string): string {
  const flat = content.replace(/\s+/gu, ' ').trim()
  return flat.length <= 120 ? flat : `${flat.slice(0, 117)}...`
}

export type { BranchView, JumpView, LlmMessage, SessionTreeSnapshot, SessionTreeView, TreeNode, TreeResult }

/**
 * Process-wide store shared by the domain service and the tool/command
 * companion, so model appends and browser jumps read the same trees.
 */
export const sessionTreeStore = new SessionTreeStore()

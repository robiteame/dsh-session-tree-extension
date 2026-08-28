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
  ContentPart,
  LlmMessage,
  SessionTreeSessionInfo,
  SessionTreeSnapshot,
  SessionTreeView,
  TreeNode,
  SessionTreeLogEntry,
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
  private readonly branchHeads = new Map<string, string>()

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
    if (snapshot.branchHeads !== undefined) {
      for (const [name, head] of Object.entries(snapshot.branchHeads)) {
        if (this.nodesById.has(head)) this.branchHeads.set(name, head)
      }
    }
    if (this.cursorId !== null && this.branchHeads.size === 0) {
      this.branchHeads.set(this.activeBranchName, this.cursorId)
    }
  }

  /** Mint a node id guaranteed absent from this tree (collision-safe). */
  private mintNodeId(): string {
    let id = nodeId()
    while (this.nodesById.has(id)) id = nodeId()
    return id
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
    options: { branch?: string; summary?: string; content?: readonly ContentPart[]; model?: string; usage?: Record<string, JsonValue>; cost?: number; error?: string; metadata?: Record<string, JsonValue> } = {},
  ): TreeResult<TreeNode> {
    if (!isMessage(message)) return fail('INVALID_ARGUMENT', 'message.role and message.content are required')
    const branch = options.branch === undefined ? this.activeBranchName : options.branch.trim()
    if (branch.length === 0) return fail('INVALID_ARGUMENT', 'branch must not be empty')
    const node: TreeNode = {
      nodeId: this.mintNodeId(),
      parentId: this.cursorId,
      forkCount: 0,
      type: 'message',
      branch,
      summary: options.summary?.trim() || summarize(message.content),
      createdAt: new Date().toISOString(),
      message: clone(message),
      content: clone(options.content ?? [{ type: 'text', text: message.content }]),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.usage === undefined ? {} : { usage: clone(options.usage) }),
      ...(options.cost === undefined ? {} : { cost: options.cost }),
      ...(options.error === undefined ? {} : { error: options.error }),
      ...(options.metadata === undefined ? {} : { metadata: clone(options.metadata) }),
    }
    this.nodesById.set(node.nodeId, node)
    this.cursorId = node.nodeId
    this.activeBranchName = branch
    this.branchHeads.set(branch, node.nodeId)
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
    // Navigation changes only the current leaf. Named branch heads are
    // durable pointers and must not move merely because the user browses.
    return { ok: true, value: { cursor: this.cursorId, messages: this.messagesFrom(target) } }
  }

  /**
   * Fork the active cursor from a historical node. This is the Pi `/fork`
   * primitive: old nodes remain intact and the next append becomes a child.
   */
  fork(target: string, branch = 'fork'): TreeResult<{ cursor: string; branch: string; forkCount: number }> {
    const result = this.branch(target, branch)
    if (!result.ok) return fail(result.error.code, result.error.message)
    const count = this.directChildren(target).length
    return { ok: true, value: { cursor: target, branch: result.value.branch, forkCount: count } }
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
    this.branchHeads.set(trimmed, target)
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
      nodeId: this.mintNodeId(),
      parentId: target,
      forkCount: 0,
      type: 'branch_summary',
      branch: this.activeBranchName,
      summary: summary.trim(),
      createdAt: new Date().toISOString(),
      content: [{ type: 'text', text: summary.trim() }],
      metadata: { kind: 'branch_summary', from: target },
    }
    this.nodesById.set(node.nodeId, node)
    this.cursorId = node.nodeId
    this.branchHeads.set(this.activeBranchName, node.nodeId)
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
  log(fromSeq = 0): SessionTreeLogEntry[] {
    return this.list().slice(fromSeq).map((node, index) => ({ seq: fromSeq + index, node }))
  }

  replay(records: readonly SessionTreeLogEntry[]): TreeResult<{ applied: number }> {
    let expected = this.nodesById.size
    for (const record of records) {
      if (record.seq !== expected || this.nodesById.has(record.node.nodeId)) return fail('INVALID_SNAPSHOT', 'session tree log sequence or node identity is invalid')
      if (!isNode(record.node) || (record.node.parentId !== null && !this.nodesById.has(record.node.parentId))) return fail('INVALID_SNAPSHOT', 'session tree log topology is invalid')
      this.nodesById.set(record.node.nodeId, clone(record.node))
      expected += 1
    }
    const last = records[records.length - 1]?.node
    if (last !== undefined) {
      this.cursorId = last.nodeId
      this.activeBranchName = last.branch
      this.branchHeads.set(last.branch, last.nodeId)
    }
    return { ok: true, value: { applied: records.length } }
  }

  list(): TreeNode[] {
    return clone([...this.nodesById.values()].map(node => ({
      ...node,
      forkCount: this.directChildren(node.nodeId).length,
    })))
  }

  /**
   * @returns named branch pointers and their reachable nodes. Branch identity
   * comes from the session-level head map; node.branch is display metadata only.
   */
  branches(): BranchView[] {
    return [...this.branchHeads].map(([name, headId]) => {
      const nodeIds: string[] = []
      let current: string | null = headId
      while (current !== null) {
        const node = this.nodesById.get(current)
        if (node === undefined) break
        nodeIds.push(current)
        current = node.parentId
      }
      nodeIds.reverse()
      return { name, headId, nodeIds }
    })
  }

  /** Return a compact Pi-style session status projection. */
  info(): SessionTreeSessionInfo {
    const usage: Record<string, number> = {}
    let cost = 0
    for (const node of this.nodesById.values()) {
      if (node.usage !== undefined) {
        for (const [key, value] of Object.entries(node.usage)) {
          if (typeof value === 'number') usage[key] = (usage[key] ?? 0) + value
        }
      }
      if (typeof node.cost === 'number') cost += node.cost
    }
    return {
      sessionId: this.sessionId,
      branchHeads: Object.fromEntries(this.branchHeads),
      nodeCount: this.nodesById.size,
      branchCount: this.branches().length,
      cursor: this.cursorId,
      activeBranch: this.activeBranchName,
      currentPathLength: this.currentPath().length,
      usage: Object.keys(usage).length === 0 ? undefined : usage,
      cost: cost === 0 ? undefined : cost,
      snapshotVersion: SNAPSHOT_VERSION,
    }
  }

  /** @returns the full read view served to the browser panel. */
  view(): SessionTreeView {
    return {
      sessionId: this.sessionId,
      cursor: this.cursorId,
      activeBranch: this.activeBranchName,
      branchHeads: Object.fromEntries(this.branchHeads),
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
      branchHeads: Object.fromEntries(this.branchHeads),
      nodes: [...this.nodesById.values()],
    })
  }

  /** Return the current leaf's root-to-leaf node path. */
  currentPath(): TreeNode[] {
    const path: TreeNode[] = []
    let current = this.cursorId
    while (current !== null) {
      const node = this.nodesById.get(current)
      if (node === undefined) break
      path.push(clone(node))
      current = node.parentId
    }
    return path.reverse()
  }

  /** @returns true when a node with this id exists. */
  has(nodeId: string): boolean {
    return this.nodesById.has(nodeId)
  }

  /** @returns direct child ids, used to expose the derived fork count. */
  private directChildren(parentId: string): string[] {
    return [...this.nodesById.values()].filter(node => node.parentId === parentId).map(node => node.nodeId)
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

  /** Create a new tree session. Existing ids are never silently reset. */
  create(sessionId: SessionId): SessionTree {
    if (this.trees.has(sessionId)) throw new Error(`session '${sessionId}' already exists`)
    const tree = new SessionTree(sessionId)
    this.trees.set(sessionId, tree)
    return tree
  }

  /** Clone the active branch into an independent session with fresh node ids. */
  clone(sourceSessionId: SessionId, targetSessionId: SessionId): TreeResult<{ sessionId: string }> {
    if (this.trees.has(targetSessionId)) return fail('SESSION_ALREADY_EXISTS', `session '${targetSessionId}' already exists`)
    const source = this.trees.get(sourceSessionId)
    if (source === undefined) return fail('SESSION_NOT_FOUND', `session '${sourceSessionId}' was not found`)
    const snapshot = source.snapshot()
    // Pi `/clone` duplicates the current active branch, not unrelated sibling
    // alternatives. Walk from the current leaf to the root and retain only
    // that path before remapping ids for the independent destination tree.
    const byId = new Map(snapshot.nodes.map(node => [node.nodeId, node]))
    const activeIds = new Set<string>()
    let current = snapshot.cursor
    while (current !== null) {
      activeIds.add(current)
      current = byId.get(current)?.parentId ?? null
    }
    const activeNodes = snapshot.nodes.filter(node => activeIds.has(node.nodeId))
    const ids = new Map<string, string>()
    for (const node of activeNodes) ids.set(node.nodeId, nodeId())
    const cloned: SessionTreeSnapshot = {
      ...snapshot,
      sessionId: targetSessionId,
      cursor: snapshot.cursor === null ? null : ids.get(snapshot.cursor) ?? null,
      branchHeads: Object.fromEntries(Object.entries(snapshot.branchHeads ?? {})
        .map(([name, head]) => [name, ids.get(head)])
        .filter((entry): entry is [string, string] => entry[1] !== undefined)),
      nodes: activeNodes.map(node => ({
        ...node,
        nodeId: ids.get(node.nodeId) ?? nodeId(),
        parentId: node.parentId === null ? null : ids.get(node.parentId) ?? null,
      })),
    }
    this.trees.set(targetSessionId, new SessionTree(targetSessionId, cloned))
    return { ok: true, value: { sessionId: targetSessionId } }
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
  const nodes = record.nodes
  if (!Array.isArray(nodes) || nodes.some(node => !isNode(node))) return false
  if (!hasValidTopology(nodes as TreeNode[])) return false
  const cursor = record.cursor
  if (cursor !== null && typeof cursor !== 'string') return false
  if (typeof cursor === 'string' && !(nodes as TreeNode[]).some(node => node.nodeId === cursor)) return false
  if (record.branchHeads !== undefined && !isJsonRecord(record.branchHeads)) return false
  if (record.branchHeads !== undefined && Object.entries(record.branchHeads).some(([_, head]) => typeof head !== 'string' || !(nodes as TreeNode[]).some(node => node.nodeId === head))) return false
  return typeof record.activeBranch === 'string'
}

/** Validate one restored node before it enters the tree. */
function isNode(value: unknown): value is TreeNode {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.nodeId !== 'string'
    || (record.parentId !== null && typeof record.parentId !== 'string')
    || typeof record.branch !== 'string'
    || typeof record.summary !== 'string'
    || typeof record.createdAt !== 'string') return false
  if (record.type !== undefined && !['message', 'tool_call', 'tool_result', 'model_change', 'compaction', 'branch_summary', 'custom'].includes(record.type as string)) return false
  if (record.forkCount !== undefined && (typeof record.forkCount !== 'number' || !Number.isInteger(record.forkCount) || record.forkCount < 0)) return false
  if (record.message !== undefined && !isMessage(record.message)) return false
  if (record.content !== undefined && (!Array.isArray(record.content) || record.content.some(part => !isContentPart(part)))) return false
  if (record.cost !== undefined && (typeof record.cost !== 'number' || !Number.isFinite(record.cost))) return false
  if (record.usage !== undefined && !isJsonRecord(record.usage)) return false
  return record.error === undefined || typeof record.error === 'string'
}

function isContentPart(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.type === 'text' || record.type === 'reasoning') return typeof record.text === 'string'
  if (record.type === 'tool_call') return typeof record.id === 'string' && typeof record.name === 'string' && isJsonValue(record.arguments)
  if (record.type === 'tool_result') return typeof record.toolCallId === 'string' && typeof record.content === 'string' && (record.isError === undefined || typeof record.isError === 'boolean')
  return false
}

function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && isJsonValue(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value === 'object') return Object.values(value).every(isJsonValue)
  return false
}

/**
 * Validate the restored parent graph: every non-root `parentId` resolves to a
 * node in the set, and no ancestor chain cycles. A chain longer than the node
 * count necessarily revisits a node, which marks a cycle.
 */
function hasValidTopology(nodes: readonly TreeNode[]): boolean {
  const ids = new Set(nodes.map(node => node.nodeId))
  if (ids.size !== nodes.length) return false // duplicate nodeId
  const parentOf = new Map(nodes.map(node => [node.nodeId, node.parentId]))
  for (const node of nodes) {
    if (node.parentId !== null && !ids.has(node.parentId)) return false
  }
  for (const node of nodes) {
    let steps = 0
    let current: string | null = node.nodeId
    while (current !== null) {
      if (steps > nodes.length) return false
      current = parentOf.get(current) ?? null
      steps += 1
    }
  }
  return true
}

/** Human-readable preview for a node without an explicit summary. */
function summarize(content: string): string {
  const flat = content.replace(/\s+/gu, ' ').trim()
  return flat.length <= 120 ? flat : `${flat.slice(0, 117)}...`
}

export type { BranchView, ContentPart, JumpView, LlmMessage, SessionTreeLogEntry, SessionTreeSessionInfo, SessionTreeSnapshot, SessionTreeView, TreeEntryType, TreeNode, TreeResult }

/**
 * Process-wide store shared by the domain service and the tool/command
 * companion, so model appends and browser jumps read the same trees.
 */
export const sessionTreeStore = new SessionTreeStore()

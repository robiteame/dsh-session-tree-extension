/**
 * Pure JSON-safe payload vocabulary of the session-tree domain. This module
 * imports nothing host-side: `./client` re-exports it for the browser half,
 * the Typert generator reflects it into wire schemas, and `./types` serves
 * host consumers. Everything here is lossless-JSON serializable (acceptance:
 * tool and Remote results are plain JSON with a stable error envelope).
 *
 * @module @deepseek-ai/dsh-pi-agent-session-tree/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Roles accepted in one stored conversation message. */
export type LlmRole = 'system' | 'user' | 'assistant' | 'tool'

/** One standard LLM message carried by a tree node (the `messages` payload). */
export interface LlmMessage {
  readonly role: LlmRole
  readonly content: string
  readonly name?: string
  readonly toolCallId?: string
}

/**
 * One immutable history node. Nodes are append-only: once created, no field
 * changes and no node is ever removed. Branching moves the cursor to an
 * existing node; the next append becomes that node's child.
 */
export interface TreeNode {
  /** Stable identity; unique within one session tree. */
  readonly nodeId: string
  /** Parent node id, or null for a root. */
  readonly parentId: string | null
  /** Branch label this node belongs to (defaults to the active branch). */
  readonly branch: string
  /** Human-readable preview shown in tree views. */
  readonly summary: string
  /** ISO-8601 creation time. */
  readonly createdAt: string
  /** The carried message; nodes without one (e.g. branch summaries) omit it. */
  readonly message?: LlmMessage
  /** Optional lossless-JSON extras. */
  readonly metadata?: Record<string, JsonValue>
}

/** Lossless JSON value used across the payload vocabulary. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** One branch's aggregated view: its nodes in creation order. */
export interface BranchView {
  readonly name: string
  /** Id of the branch's newest node. */
  readonly headId: string
  readonly nodeIds: readonly string[]
}

/**
 * Versioned durable snapshot accepted by `snapshot.load` and produced by
 * `snapshot.save`. `version` guards the on-disk format; unknown versions are
 * rejected as `INVALID_SNAPSHOT`.
 */
export interface SessionTreeSnapshot {
  readonly version: 1
  readonly sessionId: string
  readonly cursor: string | null
  readonly activeBranch: string
  readonly nodes: readonly TreeNode[]
}

/** Read view served to the browser panel and `list` operations. */
export interface SessionTreeView {
  readonly sessionId: SessionId
  readonly cursor: string | null
  readonly activeBranch: string
  readonly nodes: readonly TreeNode[]
  readonly branches: readonly BranchView[]
}

/** Result of a cursor jump: the new cursor plus the reconstructed path. */
export interface JumpView {
  readonly cursor: string | null
  readonly messages: readonly LlmMessage[]
}

/** Stable error codes for every failure path. */
export type TreeErrorCode =
  | 'INVALID_ARGUMENT'
  | 'SESSION_NOT_FOUND'
  | 'NODE_NOT_FOUND'
  | 'INVALID_SNAPSHOT'
  | 'NOT_FOUND'

/** Standard success/error envelope returned by every tree operation. */
export type TreeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: TreeErrorCode; readonly message: string } }

/** Wire payload of the `session_tree` tool's `append` operation. */
export interface AppendRequest {
  readonly message: LlmMessage
  readonly branch?: string
  readonly summary?: string
  readonly metadata?: Record<string, JsonValue>
}

/** Wire payload of the `session_tree` tool's `branch` operation. */
export interface BranchRequest {
  readonly nodeId: string
  readonly branch: string
}

/** Wire payload of the `session_tree` tool's `snapshot.load` operation. */
export interface LoadSnapshotRequest {
  readonly snapshot: SessionTreeSnapshot
}

/** The full set of tool operations, mirrored in schemas/tools.json. */
export type SessionTreeOperation =
  | 'create'
  | 'append'
  | 'list'
  | 'branches'
  | 'jump'
  | 'context'
  | 'branch'
  | 'branch.summary'
  | 'snapshot.save'
  | 'snapshot.load'
  | 'sessions'
  | 'tree'

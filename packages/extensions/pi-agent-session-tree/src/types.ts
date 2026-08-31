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

/** PI-Agent-style entry kinds; every session entry is still one tree node. */
export type TreeEntryType = 'message' | 'tool_call' | 'tool_result' | 'model_change' | 'compaction' | 'branch_summary' | 'custom'

/** Structured Pi-style content part carried by an entry. */
export type ContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_call'; readonly id: string; readonly name: string; readonly arguments: JsonValue }
  | { readonly type: 'tool_result'; readonly toolCallId: string; readonly content: string; readonly isError?: boolean }
  | { readonly type: 'reasoning'; readonly text: string }

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
  /** Number of direct forks created from this entry (derived, never mutated). */
  readonly forkCount?: number
  /** PI-Agent-style entry discriminator; defaults to `message` for legacy nodes. */
  readonly type?: TreeEntryType
  /** Branch label this node belongs to (defaults to the active branch). */
  readonly branch: string
  /** Human-readable preview shown in tree views. */
  readonly summary: string
  /** ISO-8601 creation time. */
  readonly createdAt: string
  /**
   * Detached compatibility DTO for display/context responses; this is not the
   * Harness `Message` union and must not be passed to model APIs as-is.
   */
  readonly message?: LlmMessage
  /** Pi-style structured content; message is retained as the derived compatibility DTO. */
  readonly content?: readonly ContentPart[]
  /** Optional model/provider metadata. */
  readonly model?: string
  /** Optional usage/cost/error metadata from the model turn. */
  readonly usage?: Record<string, JsonValue>
  readonly cost?: number
  readonly error?: string
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

/** One append-only JSONL record for incremental tree persistence. */
export interface SessionTreeLogEntry {
  readonly seq: number
  readonly node: TreeNode
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
  /** Highest native Session event seq represented by this snapshot, when known. */
  readonly nativeEventSeq?: number
  /** Session-level branch heads, matching Pi's named branch pointers. */
  readonly branchHeads?: Record<string, string>
  readonly nodes: readonly TreeNode[]
}

/** Summary of the active tree/session for the `/session` surface. */
export interface SessionTreeSessionInfo {
  /** Session-level branch heads, matching Pi's named branch pointers. */
  readonly branchHeads?: Record<string, string>
  readonly sessionId: SessionId
  readonly nodeCount: number
  /** Number of message-carrying entries across the whole tree. */
  readonly messageCount: number
  readonly branchCount: number
  readonly cursor: string | null
  readonly activeBranch: string
  readonly currentPathLength: number
  /** Aggregated model usage from entries that recorded it. */
  readonly usage?: Record<string, number>
  /** Sum of all numeric usage fields whose key ends in `Tokens`. */
  readonly tokenCount?: number
  /** Aggregated model cost from entries that recorded it. */
  readonly cost?: number
  readonly snapshotVersion: 1
}

/** Read view served to the browser panel and `list` operations. */
export interface SessionTreeView {
  readonly sessionId: SessionId
  readonly cursor: string | null
  readonly activeBranch: string
  /** Session-level branch heads, matching Pi's named branch pointers. */
  readonly branchHeads?: Record<string, string>
  readonly nodes: readonly TreeNode[]
  readonly branches: readonly BranchView[]
}

/** Result of tree cursor navigation: the new cursor plus the projected path. */
export interface JumpView {
  readonly cursor: string | null
  readonly messages: readonly LlmMessage[]
}

/** Stable error codes for every failure path. */
export type TreeErrorCode =
  | 'INVALID_ARGUMENT'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ALREADY_EXISTS'
  | 'NODE_NOT_FOUND'
  | 'INVALID_SNAPSHOT'
  | 'NOT_FOUND'

/** Standard success/error envelope returned by every tree operation. */
export type TreeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: TreeErrorCode; readonly message: string } }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable append-only SessionTree node written through Harness Session.append(). */
    'session-tree/node': { node: TreeNode }
    /** Durable cursor movement; history nodes remain untouched. */
    'session-tree/cursor': { nodeId: string | null }
    /** Durable named branch pointer and active-branch selection. */
    'session-tree/branch': { nodeId: string; branch: string }
    /** Durable full-tree replacement marker for explicit snapshot restore. */
    'session-tree/snapshot': { snapshot: SessionTreeSnapshot }
  }
}

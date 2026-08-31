# Session trees

English | [中文](session-tree.zh.md)

Append-only multi-branch conversation trees, one per agent session: the agent's
history is a tree of immutable nodes, forkable at any historical node, with
standard LLM message reconstruction, JSON snapshots, and an embedded WebUI
panel. This is a PI-Agent-style SessionTree adaptation — historical nodes are
never modified or deleted, and navigation only moves a cursor.

## Node model

A tree stores every turn as one immutable node. `TreeNode` is the durable unit:

```ts type-equiv
/**
 * One immutable history node. Nodes are append-only: once created, no field
 * changes and no node is ever removed. Branching moves the cursor to an
 * existing node; the next append becomes that node's child.
 */
interface TreeNode {
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
```

## Cursor and branches

The tree keeps one cursor (the leaf of the active path). `append` creates a
child of the cursor and advances it; `jump` moves the cursor to any existing
node (root-to-node path replay) without touching history; `branch` parks the
cursor at a node and names the next append's branch, so the next append forks a
new branch from that node.

```ts type-equiv
/** Read view served to the browser panel and `list` operations. */
interface SessionTreeView {
  readonly sessionId: SessionId
  readonly cursor: string | null
  readonly activeBranch: string
  readonly nodes: readonly TreeNode[]
  readonly branches: readonly BranchView[]
}
```

The reconstructed context is the standard LLM messages array for the
root→cursor path only — branches the cursor does not sit on stay out of
`messages`, so context never mixes parallel alternatives.

```ts type-equiv
/** Result of tree cursor navigation: the new cursor plus the projected path. */
interface JumpView {
  readonly cursor: string | null
  readonly messages: readonly LlmMessage[]
}
```

## Durability

Harness Session events are the durable source of truth; the SessionTree store is an incrementally synchronized projection. `snapshot.save` produces and
`snapshot.load` restores the versioned snapshot below. Unknown versions are
rejected as `INVALID_SNAPSHOT`.

```ts type-equiv
/**
 * Versioned durable snapshot accepted by `snapshot.load` and produced by
 * `snapshot.save`. `version` guards the on-disk format; unknown versions are
 * rejected as `INVALID_SNAPSHOT`.
 */
interface SessionTreeSnapshot {
  readonly version: 1
  readonly sessionId: string
  readonly cursor: string | null
  readonly activeBranch: string
  readonly nodes: readonly TreeNode[]
}
```

## Error envelope

Every tree operation answers `{ok: true, value}` or
`{ok: false, error: {code, message}}`, so tool and Remote results are always
lossless JSON with a stable failure vocabulary.

```ts type-equiv
/** Stable error codes for every failure path. */
type TreeErrorCode =
  | 'INVALID_ARGUMENT'
  | 'SESSION_NOT_FOUND'
  | 'NODE_NOT_FOUND'
  | 'INVALID_SNAPSHOT'
  | 'NOT_FOUND'

/** Standard success/error envelope returned by every tree operation. */
type TreeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: TreeErrorCode; readonly message: string } }
```

## Surfaces

- `session_tree` tool (`@deepseek-ai/dsh-tool-session-tree`): `create`,
  `append`, `list`, `branches`, `tree`, `jump`, `context`, `branch`,
  `branch.summary`, `snapshot.save`, `snapshot.load`, `sessions`.
- `/tree` command family: `list`, `branches`, `tree`, `context`, `jump
  <nodeId>`, `branch <nodeId> <name>`, `snapshot save`, `snapshot load <json>`.
- `sessionTree` Remote service (`@deepseek-ai/dsh-pi-agent-session-tree`):
  `list(agent)` and `jump(agent, nodeId)` drive the browser panel.
- `@deepseek-ai/dsh-client-ui-session-tree`: the embedded
  `conversation.input.dock` panel — auto-expands on a `/tree` composer draft
  and jumps the cursor on node click.

## Cordis API

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessiontree--sessiontreeservice"></a>

### `ctx.sessionTree` — `SessionTreeService`

Remote-only service backing the browser tree panel.

```ts cordis-catalog
/**
 * Read the current tree view (nodes, branches, cursor) for one agent.
 * The tree is created on first read, so an empty panel is valid.
 * @param agent - owning live agent.
 * @returns the complete view for the panel.
 */
@Remote('list') list(agent: Agent): SessionTreeView

/**
 * Move the tree cursor to an existing node; context returns the projected
 * root-to-node path while old branches remain intact. This does not rewrite
 * Harness' native model surface.
 * @param agent - owning live agent.
 * @param nodeId - target node, or null to reset before the first node.
 * @returns the new cursor and reconstructed messages.
 * @throws Error when the node does not exist (settles as the standard error envelope).
 */
@Remote('jump') jump(agent: Agent, nodeId: string | null): JumpView
```

Types: [Agent](core.md)

Source: [`packages/extensions/pi-agent-session-tree/src/index.ts`](../../packages/extensions/pi-agent-session-tree/src/index.ts)
<!-- END GENERATED cordis-surface -->

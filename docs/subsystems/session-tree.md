# Session trees

English | [中文](session-tree.zh.md)

Append-only multi-branch conversation trees, one per agent session: the agent's
history is a tree of immutable nodes, forkable at any historical node, with
standard LLM message reconstruction, JSON snapshots, and an embedded WebUI
panel. This is a PI-Agent-style SessionTree adaptation — historical nodes are
never modified or deleted, and navigation only moves a cursor.

## Node model

A tree stores every turn as one immutable node. `TreeNode` is the durable unit;
entries are discriminated by `type` (`message`, `tool_call`, `tool_result`,
`model_change`, `compaction`, `branch_summary`, `custom`) and can carry
structured `content` parts plus model, usage, cost, and error metadata:

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
  /** Explicit UI-selected node; unlike cursor, it is only set by node selection. */
  readonly selectedNodeId?: string | null
  /** Session-level branch heads, matching Pi's named branch pointers. */
  readonly branchHeads?: Record<string, string>
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

Harness Session events are the durable source of truth; the SessionTree store is an incrementally synchronized projection.

In a source checkout using `harness.patch`, cursor/branch/selection markers are persisted as `session-tree/*` events and the native selected-message-surface API points the next model request at the active path. In the standalone official Bundle, the same navigation is implemented without those private APIs: a jump appends an official empty-content `assistant/message` with a `replace` surface operation, and branch/cursor/selection metadata is stored in the plugin sidecar at `$DSH_HOME/storages/session-tree/<sessionId>.json`. The sidecar is restored before the next agent pre-step, so trees survive a stock profile restart.

`snapshot.save` produces and `snapshot.load` restores the versioned snapshot below. Unknown versions are rejected as `INVALID_SNAPSHOT`.

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
  /** Highest native Session event seq represented by this snapshot, when known. */
  readonly nativeEventSeq?: number
  /** Session-level branch heads, matching Pi's named branch pointers. */
  readonly branchHeads?: Record<string, string>
  /** Explicit UI-selected node used as the context for /fork and /clone. */
  readonly selectedNodeId?: string | null
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
  | 'SESSION_ALREADY_EXISTS'
  | 'NODE_NOT_FOUND'
  | 'INVALID_SNAPSHOT'
  | 'NOT_FOUND'

/** Standard success/error envelope returned by every tree operation. */
type TreeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: TreeErrorCode; readonly message: string } }
```

## Surfaces

- `session_tree` tool (`@robiteame/dsh-tool-session-tree`): `create`,
  `append`, `list`, `branches`, `tree`, `jump`, `fork`, `clone`, `context`,
  `session`, `branch`, `branch.summary`, `snapshot.save`, `snapshot.load`,
  `sessions`.
- `/tree` command family: `list`, `branches`, `tree`, `context`, `jump
  <nodeId>`, `branch <nodeId> <name>`, `snapshot save`, `snapshot load <json>`.
  `/fork [branch]` and `/clone` automatically use the selected sidebar node;
  without one they return `请先在右侧会话树选中目标节点`.
- `sessionTree` Remote service (`@robiteame/dsh-pi-agent-session-tree`):
  `list(agent)`, `jump(agent, nodeId)`, `fork(agent, nodeId, branch)`, and
  `session(agent)` drive the browser panel.
- `@robiteame/dsh-client-ui-session-tree`: in a patched source checkout it
  occupies the native `conversation.details.panel` seat; in an official Web
  profile it uses the additive `shell.overlay` seat. `/tree` opens or refreshes
  the panel, and node clicks bind the selected command context. Its fixed
  graph gutter never grows with tree depth.

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
 * Move the SessionTree cursor to an existing node and return its root-to-node
 * path through the context operation. This also selects the same path on
 * Harness' model-visible Session surface, so the next turn genuinely branches
 * from this leaf instead of merely changing the browser projection.
 * @param agent - owning live agent.
 * @param nodeId - target node, or null to reset before the first node.
 * @returns the new cursor and reconstructed messages.
 * @throws Error when the node does not exist (settles as the standard error envelope).
 */
@Remote('jump') jump(agent: Agent, nodeId: string | null): JumpView

/**
 * Position a named branch at a historical node for the next append.
 * @param agent - owning live agent.
 * @param nodeId - historical node to branch from.
 * @param branch - non-empty branch label.
 * @returns the parked cursor, branch label, and direct-child fork count.
 */
@Remote('fork') fork(agent: Agent, nodeId: string, branch: string): { cursor: string; branch: string; forkCount: number }

/**
 * Read compact status metadata for the current session tree.
 * @param agent - owning live agent.
 * @returns current tree counts, cursor, branches, and usage metadata.
 */
@Remote('session') session(agent: Agent): SessionTreeSessionInfo
```

Types: [Agent](core.md)

Source: [`packages/extensions/pi-agent-session-tree/src/index.ts`](../../packages/extensions/pi-agent-session-tree/src/index.ts)
<!-- END GENERATED cordis-surface -->

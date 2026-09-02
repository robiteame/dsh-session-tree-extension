# 会话树

[English](session-tree.md) | 中文

只追加的多分支会话树，每个 agent 会话一棵：agent 的历史是一棵不可变节点的树，可在任意历史节点分叉，支持标准 LLM 消息重建、JSON 快照和嵌入式 WebUI 面板。这是 PI‑Agent 风格 SessionTree 的移植——历史节点永不被修改或删除，导航只移动光标。

## 节点模型

一棵树把每一轮对话存为一个不可变节点。`TreeNode` 是持久化单元；entry 可通过 `type` 区分 `message`、`tool_call`、`model_change`、`compaction`、`branch_summary` 和 `custom`，并可携带结构化 `content` parts、model、usage、cost、error 元数据：

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

## 光标与分支

树维护一个光标（活动路径的叶子）。`append` 创建光标的子节点并推进光标；`jump` 把光标移到任意已有节点（回放根到该节点的路径）而不改动历史；`branch` 把光标停在某节点并命名下一次 append 的分支，使下一次 append 从该节点分叉出新分支。

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

重建出的上下文是根→光标路径的标准 LLM messages 数组——光标不在的分支不会进入 `messages`，因此上下文绝不混入并行的备选路径。

```ts type-equiv
/** Result of a cursor jump: the new cursor plus the reconstructed path. */
interface JumpView {
  readonly cursor: string | null
  readonly messages: readonly LlmMessage[]
}
```

## 持久化

树在进程生命周期内驻留内存；`snapshot.save` 产出、`snapshot.load` 恢复下面的版本化快照。Remote 首次读取时会把 Harness 原生 `Session.events` 中的消息、工具和模型路由事件投影为树节点，再由树光标继续追加；适配器保留原生事件 seq，便于后续接入原生持久化。未知版本被拒绝为 `INVALID_SNAPSHOT`。

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

## 错误信封

每次树操作都返回 `{ok: true, value}` 或 `{ok: false, error: {code, message}}`，因此工具与 Remote 结果始终是可无损序列化的 JSON，并带有稳定的失败词表。

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

## 表面

- `session_tree` 工具（`@deepseek-ai/dsh-tool-session-tree`）：`create`、`append`、`list`、`branches`、`tree`、`jump`、`context`、`branch`、`branch.summary`、`snapshot.save`、`snapshot.load`、`sessions`。
- `/tree` 命令族：`list`、`branches`、`tree`、`context`、`jump <nodeId>`、`branch <nodeId> <name>`、`snapshot save`、`snapshot load <json>`。`/fork [branch]` 与 `/clone` 自动读取右侧会话树选中节点；未选中时返回“请先在右侧会话树选中目标节点”。
- `sessionTree` Remote 服务（`@deepseek-ai/dsh-pi-agent-session-tree`）：`list(agent)` 与 `jump(agent, nodeId)` 驱动浏览器面板。
- `@deepseek-ai/dsh-client-ui-session-tree`：占用原生右侧详情栏的 `conversation.details.panel`。`/tree` 打开或刷新视图，节点点击绑定命令上下文；固定图形栏不会随树深度横向增长。

## Cordis API

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md)

Source: [`packages/extensions/pi-agent-session-tree/src/index.ts`](../../packages/extensions/pi-agent-session-tree/src/index.ts)
<!-- END GENERATED cordis-surface -->

# 会话树

[English](session-tree.md) | 中文

只追加的多分支会话树，每个 agent 会话一棵：agent 的历史是一棵不可变节点的树，可在任意历史节点分叉，支持标准 LLM 消息重建、JSON 快照和嵌入式 WebUI 面板。这是 PI‑Agent 风格 SessionTree 的移植——历史节点永不被修改或删除，导航只移动光标。

## 节点模型

一棵树把每一轮对话存为一个不可变节点。`TreeNode` 是持久化单元；entry 可通过 `type` 区分 `message`、`tool_call`、`tool_result`、`model_change`、`compaction`、`branch_summary` 和 `custom`，并可携带结构化 `content` parts、model、usage、cost、error 元数据：

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

## 光标与分支

树维护一个光标（活动路径的叶子）。`append` 创建光标的子节点并推进光标；`jump` 把光标移到任意已有节点（回放根到该节点的路径）而不改动历史；`branch` 把光标停在某节点并命名下一次 append 的分支，使下一次 append 从该节点分叉出新分支。

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

重建出的上下文是根→光标路径的标准 LLM messages 数组——光标不在的分支不会进入 `messages`，因此上下文绝不混入并行的备选路径。

```ts type-equiv
/** Result of tree cursor navigation: the new cursor plus the projected path. */
interface JumpView {
  readonly cursor: string | null
  readonly messages: readonly LlmMessage[]
}
```

## 持久化

Harness Session 事件是持久化真源，树存储是增量同步的投影。

使用 `harness.patch` 的源码集成会把 cursor/branch/selection 标记持久化为 `session-tree/*` 事件，并通过原生 selected-message-surface API 把下一次模型请求指向活动路径。独立官方 Bundle 使用不同的实现：跳转会追加一条官方空内容 `assistant/message`，携带 `replace` surface 操作；branch/cursor/selection 元数据保存到插件 sidecar（`$DSH_HOME/storages/session-tree/<sessionId>.json`），并在下一次 agent pre-step 前恢复，因此官方 profile 重启后树仍然完整。

`snapshot.save` 产出、`snapshot.load` 恢复下面的版本化快照。每次 Remote 读取与 agent pre-step 都会把 Harness 原生 `Session.events` 中的消息、工具和模型路由事件增量投影为树节点，再由树光标继续追加；适配器保留原生事件 seq。未知版本被拒绝为 `INVALID_SNAPSHOT`。

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

## 错误信封

每次树操作都返回 `{ok: true, value}` 或 `{ok: false, error: {code, message}}`，因此工具与 Remote 结果始终是可无损序列化的 JSON，并带有稳定的失败词表。

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

## 表面

- `session_tree` 工具（`@robiteame/dsh-tool-session-tree`）：`create`、`append`、`list`、`branches`、`tree`、`jump`、`fork`、`clone`、`context`、`session`、`branch`、`branch.summary`、`snapshot.save`、`snapshot.load`、`sessions`。
- `/tree` 命令族：`list`、`branches`、`tree`、`context`、`jump <nodeId>`、`branch <nodeId> <name>`、`snapshot save`、`snapshot load <json>`。`/fork` 打开用户消息选择器并把选中路径复制到同项目新 session；`/clone` 把当前会话完整复制到同项目新 session。
- `sessionTree` Remote 服务（`@robiteame/dsh-pi-agent-session-tree`）：`list(agent)`、`jump(agent, nodeId)`、`fork(agent, nodeId, branch)`、`forkSession(agent, nodeId, branch)` 与 `session(agent)` 驱动浏览器面板；`forkSession` 是用户面的独立副本操作。
- `@robiteame/dsh-client-ui-session-tree`：在打补丁的源码集成中占用原生右侧详情栏的 `conversation.details.panel`；在官方 Web profile 中使用叠加式 `shell.overlay`。`/tree` 打开或刷新视图，节点点击绑定命令上下文；固定图形栏不会随树深度横向增长。第二个 `shell.overlay` 条目（`session-tree-branches`）把可折叠分叉菜单直接挂载到原父会话的原生列表项之后：`/fork` 子会话以连接轨道和逐级展开/收起嵌套展示，子会话标题取选中节点上一条用户消息；拓扑来自原生分叉 API 写入的响应式 `parentId`，UI 层标注注册表只区分 `/fork` 与 `/clone`，clone 会话保持原有侧边栏展示。

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
 * Copy only the selected user-node root path into a brand-new Session.
 * @param agent - owning live source agent.
 * @param nodeId - selected user-message node.
 * @param branch - branch label installed on the independent copy.
 * @returns the source fork point plus target session and editable prompt.
 */
@Remote('forkSession') forkSession(agent: Agent, nodeId: string, branch: string): Promise<SessionTreeForkView>

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

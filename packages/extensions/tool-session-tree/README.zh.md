# tool-session-tree

[English](README.md) | 中文

会话树服务的模型面配套：`session_tree` 工具、`/tree` 命令族，以及共享只追加会话树存储之上的 system-prompt 片段。所有状态都在 `sessionTreeStore`（`@deepseek-ai/dsh-pi-agent-session-tree`）中，因此模型、命令行与浏览器面板观察到同一批树。

## 表面

| 表面 | 名称 | 说明 |
|---|---|---|
| 工具 | `session_tree` | 每个 agent 会话一棵树；操作见下 |
| 命令 | `/tree` | 打开或刷新右侧会话树；低级子命令继续供自动化使用 |
| 命令 | `/fork`、`/clone`、`/session` | 无需 ID，直接 fork/clone 右侧选中节点；查看树状态 |

## 工具操作

`create`、`append`、`list`、`branches`、`tree`、`jump`、`context`、`branch`、`branch.summary`、`snapshot.save`、`snapshot.load`、`sessions`。

- `context` 返回 `{cursor, messages}`——根→光标路径的标准 LLM messages 数组。
- `branch` 把光标停在已有节点并命名下一次 append 的分支；`branch.summary` 额外追加摘要节点。历史节点永不被修改或删除。
- `snapshot.save` 返回版本化快照；`snapshot.load` 在同一 sessionId 下恢复（`version: 1`）。

每次操作都返回 `{ok: true, value}` 或 `{ok: false, error: {code, message}}`，因此工具结果始终是无损 JSON，并带有稳定失败词表。用户执行 `/fork`、`/clone` 前必须先点击右侧节点，否则返回“请先在右侧会话树选中目标节点”。

## 工具示例

```json
{"operation":"create","sessionId":"demo"}
{"operation":"append","sessionId":"demo","message":{"role":"user","content":"Explore option A"}}
{"operation":"append","sessionId":"demo","message":{"role":"assistant","content":"Baseline answer"}}
{"operation":"branch","sessionId":"demo","nodeId":"<root-nodeId>","branch":"option-b"}
{"operation":"append","sessionId":"demo","message":{"role":"user","content":"Explore option B"},"branch":"option-b"}
{"operation":"context","sessionId":"demo"}
{"operation":"snapshot.save","sessionId":"demo"}
{"operation":"snapshot.load","sessionId":"demo","snapshot":{"version":1,"sessionId":"demo","cursor":null,"activeBranch":"main","nodes":[]}}
```

## 模型体验

### 系统提示

#### 模型看到什么

一段固定文本告诉模型：树是 Harness 持久化 Session 日志的只追加投影——原生 user/assistant/tool/model 事件会自动同步；导航后先读 `context`，不要重复 append 普通轮次；仅用 `append` 记录明确的自定义 entry，从历史节点分叉且不修改旧节点。
##### SessionTree 指引

```markdown
SessionTree is the append-only projection of the durable Harness Session log. Native user, assistant, tool, and model-context events synchronize automatically; never duplicate ordinary turns with operation 'append'. After navigation, use 'context' for the root-to-cursor active branch. Use 'append' only for an explicit custom entry, and use 'fork' or 'branch' to explore alternatives without modifying old nodes. Use snapshots for explicit export or full-tree restore. All operations report failures as {ok:false,error:{code,message}}.
```

#### Token 影响

本插件提示注册在作用域内时，每次请求的固定小成本输入，外加每次 `context` 调用返回的 JSON。

#### KV 缓存影响

在插件作用域与指引文本不变时前缀稳定。`context` 结果是动态输出，不进入可复用前缀。

### 工具 schema 与结果

#### 模型看到什么

生成的 [`session_tree` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-session-tree)（一个 `operation` 判别字段加 JSON 载荷字段）。成功结果是紧凑 JSON 信封；失败操作返回 `{ok: false, error: {code, message}}` 而不是抛错。

#### Token 影响

固定 schema 成本加每次调用一个紧凑结果。

#### KV 缓存影响

定义与可见性不变时 schema 前缀稳定。调用与结果追加在可复用请求前缀之后。

## 已知限制与待办

- **原生事件持久化**——每次实时同步都会从 Harness Session 事件日志重建树；显式快照用于整树导出与恢复，原生模型 surface 跟随活动叶子。
- **存储是进程级**——进程重启后，会在所属 Agent 恢复为实时状态时从持久 Session 事件重建树。

# tool-session-tree

[English](README.md) | 中文

会话树服务的模型面配套：`session_tree` 工具、`/tree` 命令族，以及共享只追加会话树存储之上的 system-prompt 片段。所有状态都在 `sessionTreeStore`（`@deepseek-ai/dsh-pi-agent-session-tree`）中，因此模型、命令行与浏览器面板观察到同一批树。

## 表面

| 表面 | 名称 | 说明 |
|---|---|---|
| 工具 | `session_tree` | 每个 agent 会话一棵树；操作见下 |
| 命令 | `/tree` | `list`、`branches`、`tree`、`context`、`jump <nodeId>`、`branch <nodeId> <name>`、`snapshot save`、`snapshot load <json>` |
| 命令 | `/fork`、`/clone`、`/session` | 在树内 fork、复制到独立 session、查看当前树状态 |

## 工具操作

`create`、`append`、`list`、`branches`、`tree`、`jump`、`context`、`branch`、`branch.summary`、`snapshot.save`、`snapshot.load`、`sessions`。

- `context` 返回 `{cursor, messages}`——根→光标路径的标准 LLM messages 数组。
- `branch` 把光标停在已有节点并命名下一次 append 的分支；`branch.summary` 额外追加摘要节点。历史节点永不被修改或删除。
- `snapshot.save` 返回版本化快照；`snapshot.load` 在同一 sessionId 下恢复（`version: 1`）。

每次操作都返回 `{ok: true, value}` 或 `{ok: false, error: {code, message}}`，因此工具结果始终是无损 JSON，并带有稳定失败词表。

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

一段固定文本告诉模型：树是唯一会话历史——回答前先读 `context`，逐轮 `append`，从历史节点分叉且不修改旧节点，用快照做持久化。
##### SessionTree 指引

```markdown
SessionTree is the sole conversation history for this agent. Before answering, call session_tree with operation 'context' for your active session and treat its returned messages as the complete context; never assume a linear chat history. Append every user and assistant turn with operation 'append'. To explore an alternative, call 'branch' with a historical nodeId and a branch name (or 'branch.summary' to record a summary of the abandoned path), then append new messages; never modify or delete historical nodes. Use 'branches' and 'tree' to enumerate the conversation tree, and 'snapshot.save'/'snapshot.load' to export or restore the whole tree as JSON. All operations report failures as {ok:false,error:{code,message}}.
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

- **树驻留内存**——历史仅能通过 `snapshot.save`/`snapshot.load` 存活；没有会话日志事件流支撑树。
- **存储是进程级**——重启后进程从空开始，除非恢复快照。

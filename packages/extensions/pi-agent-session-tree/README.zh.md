# pi_agent_session_tree

[English](README.md) | 中文

面向 DeepSeek-Harness 的只追加多分支会话树：agent 的唯一会话历史是按 agent 会话为键的树，可在任意历史节点分叉，支持标准 LLM 消息重建、JSON 快照，以及嵌入 WebUI 的树面板。

## 表面

| 表面 | 名称 | 说明 |
|---|---|---|
| 工具 | `session_tree` | 每个 agent 会话一棵树；操作见下 |
| 命令 | `/tree` | `list`、`branches`、`tree`、`context`、`jump <nodeId>`、`branch <nodeId> <name>`、`snapshot save`、`snapshot load <json>` |
| 命令 | `/fork`、`/clone`、`/session` | 选择用户消息并新建同项目分支会话、复制当前完整会话、查看当前树状态 |
| Remote 服务 | `sessionTree` | `list(agent)`、`jump(agent, nodeId)`、`fork(agent, nodeId, branch)`、`session(agent)`——驱动浏览器面板 |
| 浏览器插槽 | `conversation.details.panel` / `shell.overlay` | 补丁集成使用原生详情栏，官方 Bundle 使用叠加式抽屉；点击节点即跳转 |

## 工具操作

`create`、`append`、`list`、`branches`、`tree`、`jump`、`fork`、`clone`、`context`、`session`、`branch`、`branch.summary`、`snapshot.save`、`snapshot.load`、`sessions`。

- `context` 返回 `{cursor, messages}`，其中 `messages` 是根→光标路径的标准 LLM messages 数组。
- `branch` 把光标停在已有节点并命名下一次 append 的分支；`branch.summary` 额外追加一个摘要节点。历史节点永不被修改或删除。
- `snapshot.save` 返回版本化树快照；`snapshot.load` 在同一 sessionId 下恢复（`SNAPSHOT_VERSION` 版本化：`version: 1`）。

每次操作都返回 `{ok: true, value}` 或 `{ok: false, error: {code, message}}`，错误码为 `INVALID_ARGUMENT` | `SESSION_NOT_FOUND` | `SESSION_ALREADY_EXISTS` | `NODE_NOT_FOUND` | `INVALID_SNAPSHOT` | `NOT_FOUND`，因此工具与 Remote 结果始终是无损 JSON。

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

## 组合

把主机行加入当前 Cordis 组合（独立 Bundle 的 `cordis.patch.yml` 已携带）：

```yaml
- id: pi-agent-session-tree
  name: '@robiteame/dsh-pi-agent-session-tree'
```

浏览器面板以 `@robiteame/dsh-client-ui-session-tree` 提供。补丁集成把它挂载为 `conversation.details.panel`，官方 Bundle 把它挂载为叠加式 `shell.overlay`。本插件安装的 system-prompt 片段见 `SYSTEM_PROMPT.md`。

## 实现说明

- 存储为进程级共享，工具、命令与 Remote 服务共用，因此模型追加的内容立即可见于面板。
- Harness `Session` 事件是持久化真源；树是增量同步的投影。显式 `snapshot.save`/`snapshot.load` 事件仍可用于整树导出与恢复。
- 补丁集成把树标记持久化为 `session-tree/*` 事件。官方 Bundle 在光标移动时追加一条空内容官方 `assistant/message`，携带 `replace` surface 操作，并把分支元数据保存到 `$DSH_HOME/storages/session-tree/<sessionId>.json`。较早的事件不会被改写或删除。
- 模型可见 ⇔ 已记录：原生 Harness 消息事件始终同步为树节点；树不会合成从未记录过的历史。

## 模型体验

### 模型面

#### 模型看到什么

领域服务本身不注册任何提示、schema 或结果：模型面完全由 `@robiteame/dsh-tool-session-tree`（工具、`/tree` 命令、system-prompt 片段）承担。本包暴露的 Remote 方法只服务浏览器面板，绝不进入模型上下文。

#### Token 影响

无——本包不贡献任何模型可见文本。

#### KV 缓存影响

无——本包没有任何内容进入模型请求前缀。

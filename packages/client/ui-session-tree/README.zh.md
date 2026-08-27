# ui-session-tree

[English](README.md) | 中文

会话树插件的浏览器端：嵌入 `conversation.input.dock` 的面板，在编辑器上方渲染 agent 的会话树——不设独立页面。面板会：

- 通过生成的 `sessionTree` Remote 服务读取实时树（与 `session_tree` 工具和 `/tree` 命令共享同一个进程级存储），
- 在编辑器草稿以 `/tree` 开头时自动展开，
- 按分支分组渲染每个节点并高亮当前光标，
- 点击节点即跳转树光标并刷新。

亮/暗主题开箱即用：面板样式使用平台 `--dsw-alias-*` 设计令牌（`--dsw-alias-border-l1`、`--dsw-alias-label-primary`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-state-business-primary` 等），随宿主主题变化，无需任何主题专属代码。

## 组合

把该行加入 web-app 组合的客户端名册（web-app 补丁已携带）：

```yaml
- id: ui-session-tree
  name: '@deepseek-ai/dsh-client-ui-session-tree'
```

主机端（`@deepseek-ai/dsh-pi-agent-session-tree`）必须组合在主机名册上，Remote 服务才会存在。

## 模型体验

### 模型面

#### 模型看到什么

浏览器面板是基于 `sessionTree` Remote 服务的展示面：渲染树状态并在点击节点时跳转光标。它不注册任何提示、schema 或模型可见结果。

#### Token 影响

无——本插件渲染的任何内容都不进入模型上下文。

#### KV 缓存影响

无——本插件没有任何内容进入模型请求前缀。

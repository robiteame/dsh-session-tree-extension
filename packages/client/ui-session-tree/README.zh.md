# ui-session-tree

[English](README.md) | 中文

会话树插件的浏览器端。组件占用 DeepSeek Harness 原生右侧详情栏的
`conversation.details.panel` 槽位；不再渲染于输入框上方，也不会创建独立页面。

- 输入 `/tree` 打开或刷新右侧会话树。
- 鼠标点击节点后，该节点成为 `/fork`、`/clone` 的当前上下文，并显示明确高亮。
- 固定 44px、三轨道的图形栏使用纵向轨道和曲线连接线表达分支，视觉参考 IDEA Git Log；树深度不会转化为 margin/padding，因此不会横向无限增长。
- 分支头、角色、分支名、摘要、刷新、关闭和一键 fork 全部复用 Harness 的 `--dsw-alias-*` 原生主题 token，自动适配明暗主题。

## 组合

```yaml
- id: ui-session-tree
  name: '@deepseek-ai/dsh-client-ui-session-tree'
```

同时需要 Host 端两个扩展包，以及 `harness.patch` 对
`conversation.details.panel` 的 Harness 本体集成。

## 模型体验

本包只负责展示。它读取、导航共享 SessionTree；面板内容不会进入模型上下文，也不会改变 KV Cache 前缀。

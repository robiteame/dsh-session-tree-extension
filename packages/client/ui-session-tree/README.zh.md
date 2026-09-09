# ui-session-tree

[English](README.md) | 中文

会话树插件的浏览器端。在应用 `dev/harness.patch` 的源码集成中，组件占用
DeepSeek Harness 原生右侧详情栏的 `conversation.details.panel` 槽位；在未
修改的官方 Web profile 中使用叠加式 `shell.overlay` 槽位，因此不会占用工具
详情；不再渲染于输入框上方，也不会创建独立页面。

- 输入 `/tree` 打开或刷新右侧会话树。
- `/fork` 只展示可选择的用户消息节点，并在选中后创建当前项目下的独立会话副本；内联分支标题取选中节点上一条用户消息。`/clone` 直接把当前会话完整复制到同项目的新会话，无需先选节点。
- 固定 44px、三轨道的图形栏使用纵向轨道和曲线连接线表达分支，视觉参考 IDEA Git Log；树深度不会转化为 margin/padding，因此不会横向无限增长。
- 左侧垂直居中的展开/收起按钮控制子树显示；分支头、角色、分支名、摘要、刷新、关闭和用户消息 fork 全部复用 Harness 的 `--dsw-alias-*` 原生主题 token，自动适配明暗主题。

## 会话列表内联分叉菜单

`/fork` 成功创建分叉会话后，第二个叠加式 `shell.overlay` 条目
（`session-tree-branches`）会把可折叠菜单直接挂载到原父会话的原生列表项
之后。分叉子会话在菜单内以纵向连接轨道、转肘接点和逐级展开/收起控件
展示；子会话标题取选中节点上一条用户消息。分叉落地时菜单自动展开，并
跟随响应式会话列表更新——新分支出现无需刷新浏览器。

实现上只做表现层：分叉数据与父子关系完全来自官方原生分叉 API
（`ctx.sessions.fork` 会以 `parentId` 写入子会话），菜单的级联结构纯粹从
该响应式列表推导。子会话以内联方式展示时，其原生列表项会隐藏，并在菜单
卸载时恢复。一个很小的 UI 层标注注册表（`fork-lineage.ts`，持久化到
`localStorage`）只负责标记哪些子会话来自 `/fork`——因此 `/clone` 会话与
普通会话不会进入菜单，保持原有侧边栏展示不变。`sidebar` 槽位本身保持
原样：它是单占位槽（替换会连带移除官方 workspace/settings 座位），叠加式
`shell.overlay` 条目即内联渲染的正确落点。

## 组合

```yaml
- id: ui-session-tree
  name: '@robiteame/dsh-client-ui-session-tree'
```

官方独立 Bundle 已经同时提供 Host 端两个扩展包和本浏览器包。打补丁的源码
集成还需 `dev/harness.patch` 对 `conversation.details.panel` 的 Harness 本体集成。

## 模型体验

本包只负责展示。它读取、导航共享 SessionTree；面板内容不会进入模型上下文，也不会改变 KV Cache 前缀。

# dsh-session-tree v0.4.0 修复提示词

> 依据：[docs/test-report-0.4.0.md](./test-report-0.4.0.md) 第 8/10 章的发现（OBS-1/2/3、F-1/F-2）。
> 用法：将下方任意一段完整复制给编码代理（或新会话）即可执行，每段均自包含、无需附加上下文。
> 建议顺序：A（唯一的功能性问题）→ D（补测试防回归）→ B/C（可选优化）。

---

## 提示词 A【P0】修复：父会话游标回退后，合并图谱复制前缀去重失效（OBS-1）

```
你在仓库 dsh-session-tree-extension（DeepSeek-Harness 的多分支会话树插件，pnpm monorepo）中工作。
请修复以下已确认的客户端图谱投影缺陷，并按 TDD 先写失败测试再修复。

## 问题

右侧栏"会话树"合并图谱（SessionTreeDock → MergedSessionTreePanel → buildSessionGraphModel）按
"父子会话 root→cursor 路径的交集"去重复制前缀。当父会话游标通过 /tree jump 回退到某个祖先节点后，
父会话的路径不再包含曾经的深层节点，子会话（/fork 分叉、/clone 克隆）复制来的前缀随之停止去重，
同一条消息以会话限定行重复展示。

实测证据（真实浏览器 GUI 测试，2026-09-30）：
- 初始（s1.cursor=e7，c1 在 e2 分叉，c2 克隆全部前缀）：图谱 14 行，前缀正确去重；
- 在图谱中点击根节点触发 openSession(s1)+jumpSession(s1,e1) 后：图谱变为 21 行，
  出现 s1:e2 / c1:e2 / c2:e2..e7 等重复内容行（14→21，多出 7 行）。
- 数据与归属正确、append-only 不受影响，纯展示层问题。

## 根因

packages/client/ui-session-tree/src/client/session-graph.ts 的 mergeSession()（约 422-436 行）：

  const childPath = pathToNode(view)            // 子会话 root→cursor
  if (parentView !== undefined && parentKeys !== undefined) {
    const parentPath = pathToNode(parentView)   // 父会话 root→cursor  ← 问题所在
    const count = Math.min(childPath.length, parentPath.length)
    for (let index = 0; index < count; index++) {
      const childNode = childPath[index]!
      const parentNode = parentPath[index]!
      if (!sameNode(childNode, parentNode)) break   // sameNode = nodeId + sessionEventSeq 相同
      const parentKey = parentKeys.get(parentNode.nodeId)
      if (parentKey === undefined) break
      sharedChildIds.add(childNode.nodeId)
      sharedParentKeys.set(childNode.nodeId, parentKey)
    }
  }

父游标回退后 parentPath 变短，子会话路径中仍然复制自父的节点（父树中依旧存在，append-only 永不删除）
在 parentPath 中找不到 → 不再进入 sharedChildIds → 每个子会话各自生成 `${child}:${nodeId}` 行。

## 修复方向

把"与父会话 root→cursor 路径逐位比对"改为"与父会话节点集做链式一致性比对"：
从子路径第 0 个节点开始，逐个在父 view 的节点表中查找身份相同的节点（sameNode），并要求父节点链
与已匹配前缀连续（即第 i 个匹配节点的 parentId 指向第 i-1 个匹配节点，根为 null）。首个不匹配处
停止。这样：
- 复制前缀无论父游标在哪都正确去重（父节点永远在父树中）；
- 子会话自己的首个节点（如分叉点后的新节点）自然终止匹配；
- 不影响"兄弟分支复用同一 event id 必须保持独立行"的既有语义 —— 兄弟会话之间从不互相做
  parent→child 比对，只有拓扑上的父子会话参与。

注意 anchorNodeId/badge 计算（约 443-490 行）沿用 sharedChildIds，通常无需改动，但请核对
分叉徽章、克隆徽章、分支折叠键在"父游标已回退"状态下仍然落在正确行上。

## 验收标准

1. 新增测试（packages/client/ui-session-tree/tests/browser-plugin.client.spec.tsx，
   right-sidebar merged Session graph 分组）：构造父会话游标位于祖先的夹具
   （例如 s1 的 view cursor 指向 e1，nodes 仍含完整 e1..e7；c1 在 e2 分叉带复制前缀；
   c2 克隆全前缀），断言：
   a. 图谱行键不含重复内容行（总数与父游标在末端时一致，如 14 行）；
   b. 复制前缀行仍归属父会话键（s1:e2 而非 c1:e2）；
   c. 兄弟分支复用同一 nodeId+seq 时仍生成各自会话限定行（沿用现有断言）。
2. 既有测试全部保持绿色：pnpm verify（build + typecheck×2 + verify-bundle --pack + vitest 111 例）。
3. 手工复核（可选）：node node_modules/.bin/vite --config dev/browser-rig/vite.config.ts 打开
   http://localhost:5177，在图谱中点击根节点行，行数应保持 14（修复前变 21）。

## 约束

- 只改客户端投影层（session-graph.ts 及其测试）；不得触碰 Host 侧域模型、Remote 协议、
  任何 append-only 语义或磁盘格式。
- 不引入新的运行时依赖；保持纯函数风格（buildSessionGraphModel 无副作用）。
- 遵循仓库现有代码风格（无分号遗漏、中文注释仅用于不变式说明）。
```

---

## 提示词 B【P1·需产品决策】共享祖先行点击的路由语义（OBS-2）

```
你在仓库 dsh-session-tree-extension 中工作。处理一个交互语义问题（先给出建议与影响面，再实施）。

## 现状（实测）

SessionTreePanel.tsx 的 MergedSessionTreePanel.handleSelect（约 612-660 行）在点击节点行时，
目标会话取 row.badges.at(-1)?.sessionId ?? row.owners.at(-1)。对复制前缀共享行（同时属于多个会话），
该值是分支锚点顺序的末位 —— 实测路由到了谱系根属主会话 s1。后果：当前会话是 g1 时，用户点击
g1 自己路径上的祖先节点（该行为共享行），面板会切到 s1 会话（openSession(s1)+jumpSession(s1,…)），
而直觉上"点自己会话的节点"不应切换会话。

## 任务

1. 先判断期望语义（二选一，默认推荐 a）：
   a. 当前高亮会话若拥有该行（row.owners.includes(model.highlightedId)），则留在当前会话走
      select+jump 本会话路径；否则维持现状（跨会话先开后跳）。
   b. 维持"行属主优先"现状，仅补充文档说明。
2. 若选 a：修改目标会话解析顺序，补测试：
   - 共享行、当前会话拥有 → 只调用 select+jump，不调用 openSession；
   - 共享行、当前会话不拥有 → openSession+jumpSession（现状保持）；
   - 独有行 → 现状保持。
3. pnpm verify 全绿。约束：仅客户端交互层，不改图谱模型与 Remote。
```

---

## 提示词 C【P2】跳转/切换触发的双重 fan-out 重载（OBS-3）

```
你在仓库 dsh-session-tree-extension 中工作。优化一个已确认的冗余（非缺陷）。

## 现状（实测）

SessionTreePanel.tsx（MergedSessionTreePanel）中，点击节点会调用 reloadCurrent()（显式全量重载），
随后 openSession/listState 变更又触发 80ms 防抖的列表版本 effect（约 505 行）再次 fan-out，
Remote 日志可见同一轮交互出现两组连续的 list()×N 调用。功能无影响，仅重复加载。

## 任务

让显式 reload 与防抖 effect 复用同一"代际"（generation token）去重：显式 reload 递增 generation，
防抖 effect 在到期时若 generation 已被更新则跳过（或反之）。要求：
1. 手工交互路径仍至少刷新一次（点击节点后目标会话视图更新为最新 cursor）；
2. 列表外部变更（新会话加入）仍触发防抖重载；
3. 新增测试断言：单击一个节点后 load() 对每个会话恰好调用一次；
4. pnpm verify 全绿。仅改 SessionTreePanel.tsx 与测试。
```

---

## 提示词 D【P1】补齐测试盲区：叠加层降级路径与原生侧栏组件（F-1/F-2）

```
你在仓库 dsh-session-tree-extension 中工作。为两个覆盖率最低的客户端文件补测试（不改生产代码，
除非测试暴露真实缺陷——若暴露，先写复现测试再报告，不要顺手大改）。

## 背景（当前覆盖率，V8）

- SessionTreeOverlay.tsx：行覆盖 57.69%（L54-155、167-188 未覆盖）——官方旧版构建的
  叠加层抽屉 + SessionTreeOverlayController 分支；
- SessionTreeSidebarTab.tsx 与 slots.ts：0% ——原生右侧栏注册组件仅在打 dev/ 补丁的
  Harness 源码集成环境可达；
- session-list.ts：40%（11 行辅助函数）。

## 任务

1. packages/client/ui-session-tree/tests/browser-plugin.client.spec.tsx 为
   SessionTreeOverlayController 补分支测试：开/关抽屉、会话切换自动关闭、选择器经
   overlay 的 fork 回调路由（参照既有 overlayEntry()/bench() 夹具写法）。
2. 为 SessionTreeSidebarTab 增加最小渲染冒烟测试（jsdom render 断言关键行/标题/aria），
   并为 slots.ts 的注册函数补直接调用断言。
3. session-list.ts：补 retainedBy.mainView>0（0.2 形状）与 legacy current 双路径断言。
4. 验收：pnpm verify 全绿；上述文件行覆盖显著提升（目标：Overlay ≥85%，SidebarTab/slots ≥70%，
   session-list 100%）；不修改任何生产代码行为。

## 约束

遵循仓库既有测试风格（bench/installTestSlots 夹具、zh 字典断言中文文案、
fireEvent/waitFor），不引入新依赖。
```

---

## 附：验证命令（所有提示词通用）

```sh
pnpm verify          # build + typecheck(host/client) + verify-bundle --pack + vitest
pnpm test            # 仅测试
node node_modules/.bin/vite --config dev/browser-rig/vite.config.ts   # 实机复现台（localhost:5177）
```

# dsh-session-tree v0.5.0 自动化测试报告

| 项目 | 内容 |
|---|---|
| 被测对象 | dsh-session-tree DeepSeek Harness 插件工作区（4 个 npm 包） |
| 基线版本 | 0.5.0，git commit `5efe5ef` |
| 测试日期 | 2026-10-10 |
| 测试环境 | macOS 25.5.0 arm64 · Node v24.18.0 · pnpm 11.15.1 · Vitest 4.1.11 · TypeScript 6.0.3 |
| 测试类型 | 依赖/构建、双工程类型检查、包产物与供应链校验、单元/集成/UI 测试、输入硬化、确定性压力测试、覆盖率门禁、稳定性重复执行、真实浏览器 GUI 黑盒测试 |
| 总体结论 | **通过（PASS，含缺陷修复）** — 122/122 用例通过，5 次稳定性重复零失败，真实浏览器 10 个检查点通过且控制台零错误；发现并修复 4 个功能/数据完整性缺陷和 1 个测试基础设施缺口 |

---

## 1. 执行摘要

本轮对 v0.5.0 工作区执行了完整的 `pnpm verify` 质量门禁，并扩展了宿主领域模型、工具参数、Overlay/原生 Sidebar UI 的边界测试和真实浏览器 GUI 测试。

| 验证活动 | 结果 | 关键数据 |
|---|---|---|
| 冻结锁文件安装 | ✅ 通过 | `pnpm install --frozen-lockfile`，供应链策略检查通过 |
| 构建 | ✅ 通过 | pi / tool / ui 三个目标均成功产出 `lib/` |
| 类型检查 | ✅ 通过 | host + client 两个 strict TypeScript 工程 |
| 包产物校验 | ✅ 通过 | 4 个包 pack 干跑通过：17 + 7 + 19 + 4 = 47 个文件 |
| 功能测试 | ✅ 通过 | 6 个测试文件，**122/122**，0 跳过 |
| 覆盖率 | ✅ 达标 | 语句 84.77% / 分支 76.32% / 函数 89.00% / 行 **90.75%** |
| 稳定性 | ✅ 通过 | 1 次 verify + 5 次连续全量执行，零失败、零 flaky |
| 真实浏览器 GUI | ✅ 通过 | 10 个关键检查点通过，浏览器控制台错误 0 |

新增 11 个回归用例，并把 V8 覆盖率阈值纳入 `pnpm verify`，避免后续回退。

---

## 2. 被测范围

### 2.1 包与核心承诺

1. `@robiteame/dsh-pi-agent-session-tree`：append-only `SessionTree` / `SessionTreeStore`、SessionEvent 投影、stock/native/projection 三态降级、sidecar 持久化。
2. `@robiteame/dsh-tool-session-tree`：`session_tree` 工具、`/tree` `/fork` `/clone` `/session` 命令、系统提示词。
3. `@robiteame/dsh-client-ui-session-tree`：原生右侧 Sidebar、旧版 Overlay、合并谱系图、内联分叉菜单、fork lineage 持久化。
4. `@robiteame/dsh-session-tree`：载体 Bundle 与 `cordis.patch.yml` 组合层。

核心验收点包括：

- 历史节点不可修改/删除，jump/fork 只移动游标；
- root→cursor 的标准 LLM `messages` 上下文正确；
- 快照、sidecar、Session 日志可恢复且 resume-valid；
- 官方 Harness API 能力探测和三态降级诚实；
- `/tree` `/fork` `/clone`、工具和 UI 共享一致状态；
- 非法输入、损坏快照、加载失败和跨会话操作不破坏已有数据。

---

## 3. 自动化测试结果

### 3.1 质量门禁

执行：

```sh
pnpm install --frozen-lockfile
pnpm verify
```

结果：

- `scripts/build.mjs`：pi、tool、ui 全部构建成功；
- `tsc --project tsconfig.check.host.json`：通过；
- `tsc --project tsconfig.check.client.json`：通过；
- `scripts/verify-bundle.mjs --pack`：4 个包的清单、导出、依赖、禁止安装脚本、预构建产物和 pack 内容全部通过；
- `vitest run --coverage`：122/122 通过，覆盖率阈值通过。

### 3.2 新增回归测试

| 测试文件 | 新增关注点 |
|---|---|
| `packages/extensions/pi-agent-session-tree/tests/session-tree-hardening.spec.ts` | clone 选择节点重映射、非法快照字段、非法 append 参数、300 步确定性压力下 append-only/快照等价/路径不变量 |
| `packages/extensions/tool-session-tree/tests/session-tree-commands.spec.ts` | 不安全 clone 目标、失败工厂不留残留树、null/number 快照、结构化参数类型混淆 |
| `packages/client/ui-session-tree/tests/overlay-sidebar.client.spec.tsx` | OverlayController 状态机、fork prompt 发送/取消/错误/禁用态、原生 SidebarTab、currentSessionId、node text |

### 3.3 覆盖率

| 指标 | 覆盖率 | 门槛 |
|---|---:|---:|
| Statements | 84.77% | 80% |
| Branches | 76.32% | 70% |
| Functions | 89.00% | 80% |
| Lines | 90.75% | 85% |

覆盖重点：

- `session-tree.ts` 行覆盖 97.21%；
- `fork-lineage.ts` 行覆盖 98.21%；
- `SessionTreeOverlay.tsx` 行覆盖由旧报告的 57.69% 提升到 90.38%；
- `SessionTreeSidebarTab.tsx` 与 `session-list.ts` 达到 100% 行覆盖。

---

## 4. 发现的缺陷与修复

### F-1（中）：带选择节点的 Store.clone 抛出 `invalid session tree snapshot`

- 复现：源树 `select(nodeId)` 后执行 `SessionTreeStore.clone()`。
- 原因：克隆节点已重映射新 ID，但 `selectedNodeId` 仍保留源 ID；若选择节点不在 active path，目标快照直接失配。active branch head 在过滤不可达分支后也可能缺失。
- 影响：合法 clone 操作失败；部分分支状态下无法创建独立副本。
- 修复：选择节点存在时重映射，不在 active path 时安全置空；目标 active branch head 显式指向新 cursor。
- 回归：覆盖可达选择与不可达选择两条路径。

### F-2（中）：快照和 append 接受类型混淆的 JSON 字段

- 复现：传入 `metadata: []`、`model: 42`、`message.name: 7`、BigInt metadata、非法 content part 等。
- 原因：运行时校验漏掉 `model`、`metadata`、可选 message 字段，并把非普通对象视为 JSON object。
- 影响：恢复后的对象违反公开 TypeScript 类型；后续序列化/Remote 输出可能出现不可预测行为。
- 修复：严格验证 message、content、usage、metadata、model、cost、error；JSON object 仅接受普通对象或 null-prototype 对象。
- 回归：快照拒绝测试 + append 失败前后树快照完全一致。

### F-3（高）：clone 目标可覆盖源树，真实工厂失败会留下残留目标状态

- 复现：`targetSessionId === sessionId`，或 Agent factory 创建失败。
- 原因：clone 在创建 Agent 前就 `replace()` 目标 store 并写 sidecar；同源目标会覆盖源树。
- 影响：内存树和 sidecar 数据完整性风险；失败操作并非原子。
- 修复：拒绝空目标、同源目标和已存在目标；仅在 Agent 创建成功或确认是 standalone “no agent factory” 后写入目标树/sidecar。
- 回归：断言工厂失败后目标 store 不存在，并覆盖空目标/同源目标。

### F-4（中）：`snapshot.load` 对 null/原始类型返回错误分类不稳定

- 复现：工具或 `/tree snapshot load` 传入 `null`、数字等。
- 原因：读取 `snapshot.sessionId` 前未做 object/null 防护，外层统一捕获后错误码可能变成 `INVALID_ARGUMENT`。
- 影响：调用方无法稳定按 `INVALID_SNAPSHOT` 处理损坏快照。
- 修复：工具与命令两条入口都先验证 object/ownership，统一返回 `INVALID_SNAPSHOT`。

### F-5（低）：覆盖率没有固化为门禁

- 修复：加入 `@vitest/coverage-v8`、`pnpm test:coverage`、V8 报告和最低阈值，并让 `pnpm verify` 执行覆盖率测试。

---

## 5. 稳定性与压力测试

- 全量测试连续执行 5 次：5×122 全部通过；
- 加上最终 `pnpm verify` 的覆盖率执行，共 6 次全量执行零失败；
- 新增确定性伪随机压力测试执行 300 个混合操作（append / jump / fork / select / branchWithSummary），每步验证：
  - 旧节点字节级不变；
  - parent 拓扑无悬空、无环；
  - snapshot→new SessionTree→snapshot 等价；
  - currentPath 和 messages 稳定。

---

## 6. 真实浏览器 GUI 测试

使用仓库真实组件构建的 `dev/browser-rig/`，在真实浏览器中挂载 `SessionTreeDock` 与 `SessionBranchList`，不 mock 插件组件。

通过的检查点：

1. 初始合并图成功加载主会话、分叉、克隆和失败会话占位；
2. 损坏会话只显示局部错误占位，不影响其他分支；
3. 点击跨会话节点触发 `jumpSession` 与 `openSession`；
4. 从 `e1` 执行节点 fork，Remote 调用成功且节点数 8→9；
5. `/fork` 打开选择器，仅列出 2 个可分叉 typed user prompt；
6. 选择 prompt 后创建 `fk-1` 独立子会话并进入原生列表；
7. 内联分支菜单显示 3 个 `/fork` 分支，并保持独立折叠层级；
8. `/clone` 新增 `克隆 · 副本 1` 会话；
9. 主题从 light 切换到 dark；
10. 浏览器控制台 error 数为 0。

---

## 7. 风险与限制

| 编号 | 风险 | 说明 |
|---|---|---|
| R-1 | 未执行真实 Electron 装机链路 | 尚未在独立 DeepSeek Harness profile 中执行 `dsh plugin add` → 重启 → `/tree` `/fork` `/clone` 全链路 |
| R-2 | 原生 Surface API 依赖兼容模拟 | `selectMessageSurface()` 路径通过兼容 Session 与官方包测试；未在打补丁的 Harness 源码 checkout 做端到端构建 |
| R-3 | 平台矩阵有限 | 本轮为 macOS arm64 / Node 24；CI 覆盖 Ubuntu / Node 22、24，Windows pack 行为仍未实测 |
| R-4 | 上游 peer 告警 | `pnpm peers check` 报告 `@deepseek-ai/dsh-api-session-controller` / `dsh-tools` 的传递 peer 缺失；当前所有构建、类型和运行测试通过，属于目标 Harness 安装环境提供的可选运行面 |

---

## 8. 发布建议

测试结论为 **PASS**，核心行为、异常隔离、数据完整性和 UI 降级路径均满足当前质量门禁。

发布前建议：

1. 为本次修复重新生成 4 个发布 tarball，不要复用仓库中旧的 0.5.0 二进制包；
2. 建议提升到 `0.5.1`，在 changelog 记录 clone 原子性、快照校验和错误分类修复；
3. 若发布关键性较高，再补一次真实 Harness profile 装机冒烟；
4. 后续优先增加 Windows pack job 和 patched-Harness 源码集成 CI。

---

## 9. 复现命令

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm test:coverage

# 连续稳定性
for i in 1 2 3 4 5; do pnpm test; done

# 真实浏览器测试台
pnpm exec vite --config dev/browser-rig/vite.config.ts
# 打开 http://localhost:5177/
```

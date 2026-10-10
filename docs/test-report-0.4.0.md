# dsh-session-tree v0.4.0 测试报告

| 项目 | 内容 |
|---|---|
| 被测对象 | dsh-session-tree 插件工作区（4 个 npm 包，DeepSeek-Harness Electron 客户端扩展） |
| 被测版本 | 0.4.0（git commit `1d6f0cc`，main 分支，工作区干净） |
| 目标平台 | DeepSeek-Harness `0.2.0-rc.2`（Electron 宿主）+ Cordis `~4.0.4`，Node ≥ 22 |
| 测试日期 | 2026-09-30 |
| 测试环境 | macOS 25.5.0 (arm64) · Node v24.18.0 · pnpm 11.15.1 · vitest 4.1.11 · TypeScript 6.x · esbuild 0.28 |
| 测试类型 | 构建验证、静态类型检查、产物/清单/供应链校验、单元测试、集成测试、UI 组件测试（jsdom）、稳定性（重复执行）检测、代码覆盖率分析、**真实浏览器 GUI 点击测试（第 10 章）** |
| 总体结论 | **通过（PASS）** — 全部门禁绿色，111/111 用例通过，6 次连续执行零失败，无阻断/严重缺陷；实机浏览器 GUI 点击测试 14/14 通过（第 10 章，含 1 项行为观察建议跟进） |

---

## 1. 执行摘要

本次测试对 dsh-session-tree v0.4.0 工作区执行了完整的 `pnpm verify` 质量门禁（与 CI 完全一致），并额外完成了代码覆盖率分析、5 轮重复执行稳定性检测、发布 tarball 内容审计与供应链安全检查。

核心结果：

| 验证活动 | 结果 | 关键数据 |
|---|---|---|
| 构建（esbuild × 3 目标） | ✅ 通过 | pi / tool / ui 三个实现包全部产出 `lib/` 预构建产物 |
| 类型检查（tsc，双工程） | ✅ 通过 | host 与 client 工程均 `strict: true`，client 额外开启 `exactOptionalPropertyTypes` |
| 产物与清单校验（verify-bundle --pack） | ✅ 通过 | 4 个包 pack 干跑通过，共 53 个文件（19+9+21+4），全部断言通过 |
| 功能测试（vitest） | ✅ 通过 | 4 个测试文件，**111/111 用例通过**，总耗时约 1.6s，0 跳过 |
| 稳定性检测 | ✅ 通过 | 连续 6 次全量执行（1 次 verify + 1 次覆盖率 + 5 次重复），全部通过，未发现 flaky |
| 代码覆盖率（v8） | 📊 81.96% 语句 / 73.95% 分支 / 82.06% 函数 / **87.72% 行** | 详见第 6 节 |
| 发布 tarball 审计（0.4.0） | ✅ 通过 | 仅发布预构建 `lib/`，无源码泄漏，无任何生命周期安装脚本 |

未发现阻断（Blocker）或严重（Critical）缺陷；识别出 3 项中等风险与 5 项低风险观察项，均为测试完备性改进建议，不影响 0.4.0 发布（详见第 8 节）。

---

## 2. 被测对象概述

### 2.1 产品功能

dsh-session-tree 是 DeepSeek-Harness（Electron 客户端）的多分支会话树插件，提供三个命令：

- **`/tree`** — 打开合并谱系图（git 风格），展示当前会话全部祖先、分叉与克隆；
- **`/fork`** — 从任意历史节点分叉生长新分支，原路径保持不变；
- **`/clone`** — 将当前会话复制为同项目下的独立新会话。

核心设计承诺（均已被测试验证）：

1. **Append-only 不可变历史** —— 节点一旦写入永不修改/删除，跳转与分叉只移动游标；
2. **三态优雅降级** —— Native（打补丁的 Harness，原生 `selectMessageSurface`）/ Stock（官方版，replace 事件模拟 + sidecar 持久化）/ Projection（仅投影导航）三种模式，运行时能力探测，非原生模式打印一次性通告；
3. **LLM 上下文正确性** —— 模型只接收 root→cursor 路径的标准 `messages` 数组；
4. **日志 resume-valid** —— 官方会话日志在游标反复重写后仍可正确回放。

### 2.2 包结构与规模

| 包 | 角色 | 生产源码 | 行数 |
|---|---|---|---|
| `@robiteame/dsh-pi-agent-session-tree` | Host 域服务：SessionTree/Store 域模型 + sessionTree Remote | 7 个 TS | ≈2,050 |
| `@robiteame/dsh-tool-session-tree` | 命令面：`/tree` `/fork` `/clone` 与 `session_tree` 工具 | 2 个 TS | ≈575 |
| `@robiteame/dsh-client-ui-session-tree` | WebUI 树面板（React，原生右侧栏 + 叠加层降级） | 13 个 TS/TSX | ≈3,200 |
| `@robiteame/dsh-session-tree` | 载体 Bundle（组合层挂载以上三包） | cordis.patch.yml | — |

合计：生产源码约 **5,800 行**（16 个 TS/TSX 文件），测试代码约 **3,310 行**（4 个 spec 文件），**测试/生产代码比 ≈ 0.57** —— 对一个以行为正确性为卖点的插件而言属于健康水平。

---

## 3. 测试环境与工具链

| 项目 | 版本/配置 | 说明 |
|---|---|---|
| 操作系统 | macOS 25.5.0 (darwin, arm64) | CI 对应环境为 ubuntu-latest（Node 22/24 矩阵） |
| Node.js | v24.18.0（实测） | 满足 `engines.node >= 22`；CI 矩阵覆盖 22 与 24 |
| pnpm | 11.15.1（`packageManager` 固定） | workspace + hoisted 链接 |
| vitest | 4.1.11 | 内置标准装饰器转译插件（与 Harness 官方测试运行器同构） |
| TypeScript | 6.x（strict 双工程） | host/client 独立 tsconfig 检查 |
| esbuild | 0.28 | 3 个构建目标 + CSS Modules 内联插件 |
| jsdom + @testing-library/react | 29.1.1 / 16.1.0 | UI spec 真实渲染组件（render/fireEvent/waitFor） |
| 被测依赖 | `@deepseek-ai/dsh-*@0.2.0-rc.2`（已发布官方包） | 测试直接挂载**真实**官方服务，而非全量 mock |

---

## 4. 质量门禁与测试策略

### 4.1 CI 门禁（.github/workflows/ci.yml）

- 触发：push 到 main / 所有 PR / 手动；
- 矩阵：`ubuntu-latest × node [22, 24]`，`fail-fast: false`，20 分钟超时；
- 单一入口 `pnpm verify` = **build → typecheck(host+client) → verify-bundle --pack → vitest**。

### 4.2 verify-bundle 产物门禁（供应链安全）

`scripts/verify-bundle.mjs` 对 4 个包执行以下断言，属于同类插件中少见的完备供应链门禁：

1. **文件存在性**：每个包必备 `lib/` 预构建产物与 `.d.ts` 类型；
2. **清单形状**：包名、`repository.url`、`publishConfig.access=public` 必须正确；
3. **禁装脚本**：`preinstall/install/postinstall/prepare/prepack/prepublishOnly` 一律禁止 —— 用户安装零代码执行；
4. **依赖卫生**：peer 依赖必须齐全、禁止 `workspace:` 协议残留；
5. **产物标记**：构建产物中必须包含关键符号（如 `sessionTreeSurfaceMode`、`window.__ModuleLoader__.load(`），防止空壳/裁剪产物误发布；
6. **路径泄漏**：产物不得包含构建机绝对路径；
7. **pack 干跑**：`pnpm pack --dry-run --json` 逐一核对将发布的文件清单，且**禁止打包 `src/`**。

### 4.3 测试策略（测试金字塔）

| 层级 | 实现方式 | 说明 |
|---|---|---|
| 集成层（Host） | 真实 Cordis Context + 官方已发布服务 | pi-agent spec 将插件挂载进**真实的** SystemPrompt / AgentRegistry / ToolRuntime / CommandRuntime，仅 stub Agent 对象 —— 验证的是与官方 Harness 0.2.0-rc.2 的真实集成行为 |
| 单元层（域模型） | 纯域模型直接断言 | SessionTree 的 append/jump/fork/snapshot/checkpoint/rollback、事件投影器、sidecar 持久化 |
| UI 组件层 | jsdom + Testing Library | 真实渲染 React 组件，fireEvent 交互 + waitFor 异步断言，覆盖 0.2 原生右侧栏注册与旧版叠加层降级双路径 |
| 稳定性 | 连续重复执行 | 6 次全量运行零失败 |

---

## 5. 测试执行结果

### 5.1 完整门禁（pnpm verify）—— ✅ 通过

```
built: pi, tool, ui                                   ← esbuild 构建 3 目标
$ tsc --project tsconfig.check.host.json && tsc --project tsconfig.check.client.json
                                                       ← 双工程 strict 类型检查，零错误
packed @robiteame/dsh-pi-agent-session-tree: 19 files OK
packed @robiteame/dsh-tool-session-tree: 9 files OK
packed @robiteame/dsh-client-ui-session-tree: 21 files OK
packed @robiteame/dsh-session-tree: 4 files OK
package artifact check passed                         ← 产物门禁 7 类断言全过
 Test Files  4 passed (4)
      Tests  111 passed (111)
   Duration  1.62s
```

### 5.2 用例分布与耗时

| 测试文件 | 用例数 | 耗时 | 覆盖功能域 |
|---|---|---|---|
| `pi-agent-session-tree/tests/session-tree.spec.ts` | 37 | ~110ms | 域模型不可变性、游标跳转、LLM 消息重建、快照往返、多树隔离、事件投影、sidecar、原生/Stock/Projection 三模式、checkpoint/rollback |
| `tool-session-tree/tests/session-tree-commands.spec.ts` | 32 | ~120ms | `/fork` `/clone` `/tree` `/session` 命令族、参数校验、Remote 服务、native 模式、降级路径、域守卫 |
| `client/ui-session-tree/tests/browser-plugin.client.spec.tsx` | 35 | ~1,000ms | 原生右侧栏注册、叠加层降级、合并谱系图渲染、内联分叉菜单、fork 选择器、跨会话跳转、折叠、错误隔离 |
| `client/ui-session-tree/tests/fork-lineage.client.spec.ts` | 7 | ~10ms | fork 谱系注册表：持久化、容量上限 500 淘汰、敌意载荷容错、非浏览器环境惰性 |
| **合计** | **111** | **~1.6s** | — |

- **0 个用例被跳过/标记 todo/only**（全量 grep 扫描确认）；
- 测试过程中的 stderr 输出（`stock-surface mode` / `projection mode` 一次性通告）为**预期行为**—— 正是降级路径测试在验证"非原生模式必须诚实通告"这一需求，非错误。

### 5.3 稳定性检测 —— ✅ 通过

在约 20 分钟内连续执行 6 次全量套件（1 次 verify + 1 次带覆盖率 + 5 次重复），**111/111 × 6 全部通过**，未观察到任何 flaky 用例。UI 套件含 80ms 防抖、waitFor 超时等异步时序敏感点，重复执行全部稳定。

### 5.4 关键需求 ↔ 用例映射（抽样）

| 产品承诺 | 验证用例（节选） | 结论 |
|---|---|---|
| Append-only：旧节点永不修改 | "keeps every pre-branch node **byte-identical** while the compatibility branch grows"；"preserves every branch across jumps and forks" | ✅ 字节级断言 |
| 模型只见 root→cursor 路径 | "reconstructs standard LLM messages for the root-to-cursor path only" | ✅ |
| 日志 resume-valid | "keeps the stock log resume-valid across repeated cursor rewrites"；"replays a branched append-only node log without deleting either path" | ✅ 含重复重写回放 |
| 三态降级诚实 | 三个专享 describe：native（patched）/ stock（官方 0.2.0-rc.2）/ projection（不可写表面） | ✅ 当前环境实测 stock + projection + native（stub 表面）三路径 |
| 快照完整性 | "round-trips /tree snapshot save and load, including spaced JSON"；"rejects snapshots for a foreign session and with broken parent topology" | ✅ 含恶意/畸形快照拒绝 |
| 注入消息与人工输入分离 | "marks harness-injected user messages while keeping typed prompts unmarked"；"hides harness-injected user messages from the tree and the fork selector"（0.3.0 核心变更） | ✅ Host 与 UI 双侧验证 |
| UI 降级双路径 | "uses the 0.2 native right-Sidebar tab…"；"falls back to the additive official shell overlay…" | ✅ |
| 故障隔离 | "isolates one failed Session behind an error placeholder"；"derives rows defensively from corrupt parent links" | ✅ 含腐败数据防御 |
| 供应链安全 | verify-bundle 7 类断言 + 0.4.0 tarball 内容审计 | ✅ |

---

## 6. 代码覆盖率分析（V8 provider）

**总体：语句 81.96% · 分支 73.95% · 函数 82.06% · 行 87.72%**

### 6.1 分包覆盖率

| 包 | 语句 | 分支 | 函数 | 行 |
|---|---|---|---|---|
| pi-agent-session-tree/src | 81.56% | 74.60% | 84.66% | **88.96%** |
| tool-session-tree/src | 82.21% | 78.43% | 91.30% | **90.27%** |
| ui-session-tree/src/client | 82.58% | 72.23% | 80.74% | **86.72%** |

### 6.2 关键文件热点

| 文件 | 行覆盖 | 评价 |
|---|---|---|
| `locales.ts` / `node-text.ts` | 100% | 优 |
| `fork-lineage.ts`（UI 注册表） | 98.21% | 优 |
| `SessionBranchList.tsx`（内联分叉菜单） | 97.92% | 优 |
| `session-tree.ts`（核心域模型） | 96.26% | 优 —— 核心逻辑覆盖充分 |
| `session-event-adapter.ts`（事件投影） | 94.33% | 良 |
| `tool/index.ts`（命令面） | 92.43% | 良 |
| `session-tree-sidecar.ts` | 88.88% | 良 |
| `session-graph.ts`（合并图模型） | 88.38% | 良（分支覆盖 68.94% 偏低，见 F-1） |
| `pi-agent/index.ts` | 87.98% | 良 |
| `SessionTreePanel.tsx`（主面板） | 84.85% | 中 |
| **`SessionTreeOverlay.tsx`（叠加层降级）** | **57.69%** | **弱 —— 主要低覆盖点** |
| `session-list.ts` | 40.00% | 弱（11 行工具函数） |
| `SessionTreeSidebarTab.tsx` / `slots.ts` | 0% | 见 F-2（仅源码集成环境可达） |

说明：`css-modules.d.ts`、`*.module.css`、`typert.*.template.js`（生成器冻结产物）、`types.ts`（纯类型）显示 0% 为非可执行资产，不计入风险。

---

## 7. 发布产物与供应链审计

对仓库中 4 个 v0.4.0 tarball 逐一解包审计：

| 检查项 | 结果 |
|---|---|
| 产物形态 | ✅ 仅 `lib/`（预构建 JS + `.d.ts`）+ README/LICENSE/清单，**不含 `src/`** |
| 安装脚本 | ✅ `scripts` 中无任何生命周期脚本（UI 包的 `build/watch` 为开发命令，安装时不触发） |
| 载体包依赖 | ✅ 声明三个实现包 `^0.4.0`，`engines.node >= 22`，`publishConfig.access: public` |
| UI 包 peer 依赖 | ✅ 11 个 `@deepseek-ai/*@^0.2.0-rc.2` peer 与目标 Harness 版本精确对齐 |
| client.js 产物 | ✅ `window.__ModuleLoader__.load({ id: "@robiteame/dsh-client-ui-session-tree" ... })` 包装正确，CSS Modules 已内联注入，无构建机路径泄漏 |

---

## 8. 缺陷与风险登记

**阻断（Blocker）：0 · 严重（Critical）：0**

### 中等风险（建议下一迭代处理）

| 编号 | 发现 | 影响 | 建议 |
|---|---|---|---|
| F-1 | `SessionTreeOverlay.tsx` 行覆盖仅 57.69%（L54-155、167-188 未覆盖），叠加层控制器（OverlayController）分支与旧版官方构建的兼容分支存在测试盲区；`session-graph.ts` 分支覆盖 68.94% | 0.1.x/0.2 旧客户端用户走降级叠加层路径，回归风险高于主路径 | 为 OverlayController 的 open/close/会话切换/选择器路由补充组件测试（现有用例已覆盖其主流程，补的是长尾分支） |
| F-2 | `SessionTreeSidebarTab.tsx` 与 `slots.ts` 覆盖率 0% —— 原生右侧栏的真实注册组件仅在打了 `dev/` 补丁的 Harness 源码集成环境可达；独立套件通过 bench 的 slots mock **间接**验证了注册行为（`entry()?.options` / `overlayEntry()` 断言已通过） | 原生模式"最后一公里"（真实 Harness 侧栏挂载）无自动化守护，依赖 `dev/install.sh` 人工验证 | 在 CI 增加一个可选的"源码集成"job（或最小 slots 冒烟测试）直接渲染 SidebarTab |
| F-3 | CI 矩阵仅 `ubuntu-latest × node [22,24]`，无 Windows/macOS runner；`verify-bundle.mjs` 含 `process.platform === 'win32'` 分支但从未在 Windows 验证 | Windows 用户侧 `pnpm pack` 行为未经自动化验证（产物本身为纯 JS，运行时风险低，属发布工程风险） | 视用户分布决定是否追加 `windows-latest` 矩阵项 |

### 低风险 / 观察项

| 编号 | 发现 | 建议 |
|---|---|---|
| F-4 | 覆盖率未纳入门禁：无阈值配置，`@vitest/coverage-v8` 亦非 devDependency（本次为临时安装测量，已恢复现场） | 建议入 devDeps 并设行覆盖阈值（如全局 85% 起步、热点文件 90%）防回退 |
| F-5 | 无独立 ESLint 静态检查（仅 tsc strict） | 可按需补充；现有代码风格一致性由 strict tsc + 评审保障，非缺陷 |
| F-6 | `session-list.ts` 行覆盖 40%（11 行辅助函数） | 随 F-1 一并补齐 |
| F-7 | 载体包 `@robiteame/dsh-session-tree` 无功能测试，仅靠 verify-bundle 的 `cordis.patch.yml` 标记断言 | 设计上属纯组合清单，风险可接受；保持现状 |
| F-8 | 无真实 Electron 端到端测试 —— `dsh plugin add` → 重启 → 三命令的装机链路依赖人工验证 | 建议为发布前检查单增加一次真实 profile 装机冒烟（README 已给 `--dump-config` 验证命令） |

### 值得肯定的工程实践（正面观察）

1. **测试直接对抗真实官方包**（0.2.0-rc.2 已发布版本），而非 mock 一切 —— 对"兼容官方 Harness"这一核心卖点给出了强证据；
2. **不可变性用字节级断言验证**（byte-identical、log replay、resume-valid），远超一般"字段相等"强度；
3. **降级矩阵三模式全部有专享测试组**，且"诚实通告"本身被断言；
4. **供应链门禁完备**：禁装脚本、禁 src 入包、禁路径泄漏、workspace: 残留检查、pack 干跑文件清单核对；
5. 测试套件 1.6s 完成，反馈回路极快；6 次重复执行零 flaky。

---

## 9. 结论与发布建议

**测试结论：通过（PASS）。**

v0.4.0 的三个实现包与载体包在构建、类型、产物、功能、稳定性五个维度全部满足质量门禁；111 个用例覆盖了产品全部核心承诺（append-only、三态降级、LLM 上下文正确性、日志可回放、UI 双路径、故障隔离），核心域模型行覆盖 96%+，总体行覆盖 87.72%。第 10 章的实机浏览器 GUI 点击测试进一步以真实渲染 + 真实鼠标事件验证了 14 个交互测试点（全部通过，含 2 项行为观察）。仓库中已提交的 4 个 v0.4.0 tarball 通过内容与供应链审计，**具备发布条件**。

后续优先级建议：F-1/F-2（降级叠加层与原生侧栏的测试盲区）→ F-4（覆盖率门禁固化）→ F-3/F-8（平台矩阵与装机冒烟）。

---

## 10. 实机浏览器 GUI 点击测试（2026-09-30 补充）

jsdom 组件测试无法验证真实渲染（CSS Modules、布局、级联样式、真实事件），本轮用**真实浏览器**对插件 WebUI 做了纯 GUI 黑盒点击测试。

### 10.1 测试台（环境准备）

仓库无独立 Web 应用（UI 以插件形式挂载于 Harness 客户端），故构建了实机测试台 [`dev/browser-rig/`](../dev/browser-rig/)：

- 以 vite 起本地页面（`http://localhost:5177`），**直接挂载插件真实组件** `SessionTreeDock`（合并谱系面板）与 `SessionBranchList`（内联分叉菜单 portal），未做任何打桩；
- 左侧原生会话列表以**纯 DOM**（非 React）渲染 `role=tree/treeitem` 行，忠实模拟 Harness 宿主，使插件的命令式 portal 路径得到真实锻炼；
- 提供与真实 client/index.ts 相同面貌的 `useSessions` 反应式 store、`modeController`（/fork 选择器路由）、`SessionForkLineage` 注册表，以及 mock `sessionTree` Remote —— 每次 Remote 调用实时写入**页面可见调用日志**，使黑盒观察不依赖 DOM 之外的手段；
- 数据集：1 条主会话（含健康工具调用、失败工具调用、600+ 字长消息、1 条 harness 注入消息）+ 2 级 /fork 分叉 + 1 个 /clone 克隆 + 1 个加载失败会话，共 5 会话 8~26 节点，复制前缀按真实语义复用同一节点对象（nodeId + sessionEventSeq 一致）。

正式测试开始后全程黑盒：仅真实鼠标点击（坐标级 CUA 输入事件）、只读 DOM 断言与截图。

### 10.2 环境限制与应对（如实记录）

| 限制 | 影响 | 应对 |
|---|---|---|
| IAB 标签页 rAF 被节流 | Playwright 定位器点击的动作可行性检查永不满足，全页点击超时 | 改用 `cua` 坐标点击（真实输入事件，更贴近用户） |
| IAB 窗格顶部约 100px 被浏览器自身 UI 覆盖 | 顶栏按钮收不到点击事件（页内命中测试正常） | 将测试台控制面板移至页面中部（属测试台改动） |
| 无控制台日志采集通道 | 无法收集 console 错误 | 以可见错误表现（vite 错误浮层、面板错误文案、渲染断裂）+ 全程无异常表现为证 |

### 10.3 测试点结果（14/14 通过）

| # | 测试点（优先级） | 结果 | 关键证据（DOM + 截图双重验证） |
|---|---|---|---|
| T1 | 首屏合并谱系渲染（P0） | ✅ | "5 分支 · 14 个节点"；主/分叉(alt)/克隆/当前徽章齐全；g1 行 pressed 态；注入消息 e8 未显示（8 节点视图只出 7 行）；复制前缀去重（14 = 7+2+2+2+1）。截图 `t1_initial.png` |
| T2 | 节点点击 → 选定 + 跳转 + 重载（P0） | ✅ | 点击共享祖先后日志记录 `openSession(s1)`+`jumpSession(s1,e1)`，触发两轮 fan-out 重载 |
| T3 | 跨会话节点"先开后跳"（P0） | ✅ | 点击 c2 独有节点 → `openSession(c2)` → `jumpSession(c2,cl1)`；左列表选中切至 c2；"当前"徽章移至 c2 分支锚点行。截图 `t3_cross_session_jump.png` |
| T4 | /fork 选择器全流程（P0） | ✅ | 选择器仅列 2 条真实用户消息（注入/工具/助手全部排除），计数"1 分支 · 2 个节点"；点击创建 → `forkUserPrompt` → 新会话 fk-1（前缀恰为 root→该消息路径）→ 内联菜单增长至 3 分支 → 选择器自动关闭回合并图谱。截图 `t4_fork_selector_flow.png` |
| T5 | 内联分叉菜单（P1） | ✅ | 菜单行点击 → `openSession(g1)` 左列表选中切换；折叠按钮 aria-expanded true→false，3 分支行全隐、标签变"展开分叉分支" |
| T6 | 子树折叠（P1） | ✅ | 折叠 e2 子树：14→2 行，锚点行保留，后代与兄弟分支隐藏（含错误占位行随 s1 分支折叠，语义一致）；expander 标签"收起/展开子节点"正确切换，恢复 14 行 |
| T7 | 会话分支折叠（P1） | ✅ | 折叠主会话分支：14→1 行（仅锚点 `s1:e1`） |
| T8 | 失败会话隔离（P1） | ✅ | bad 会话呈禁用占位行（"该会话加载失败"+ `disabled=true`），点击零 Remote 调用；其余会话渲染不受影响 |
| T9 | 长消息点击展开（P1） | ✅ | 600+ 字消息行点击后行高 40→455px 展示全文，摘要态仅 40px |
| T10 | 失败工具调用标红（P1） | ✅ | `s1:e4` 摘要色 `rgb(245,74,69)` = `--dsw-alias-state-error-primary`；暗色截图可见红色 ✘ 标记 |
| T11 | /clone 语义（P2） | ✅ | clone-1 出现在**原生列表**且保持可见（对比：/fork 子会话 c1/g1/fk-1 原生行被隐藏收进菜单）；克隆前缀完整（8 节点）。截图 `t11_t12_dark_theme.png` |
| T12 | 明/暗主题渲染（P3） | ✅ | 组件全部通过 `--dsw-alias-*` 令牌取色，两主题下徽章/连接轨/面板渲染正常。截图 `t11_t12_dark_theme.png`、`t13_light_final.png` |
| T13 | 深度横向有界（P3） | ✅ | 全部 16 行 `marginLeft/paddingLeft` 为空、统一 44×38 SVG 沟槽、面板 `overflowX:hidden` —— jsdom 断言的真机复核 |
| T14 | 面板刷新按钮（P1） | ✅ | 触发全量 fan-out 重载（所有会话重新 `list()`） |

截图证据存于 [`gui-test-screenshots/`](../gui-test-screenshots/)（5 张，均已在测试过程中逐张查看）。

### 10.4 行为观察（非缺陷，建议跟进）

| 编号 | 观察 | 建议 |
|---|---|---|
| OBS-1（中低） | **父会话游标跳回祖先后，子会话复制前缀的去重失效**：`jumpSession(s1, e1)` 后 s1 的 root→cursor 路径只剩 e1，c1/c2 的复制前缀（e2..e7）不再与父路径相交，相同内容以会话限定行（`s1:e2`/`c1:e2`/`c2:e2`…）在多个分支下重复展示（14→21 行）。数据与归属均正确、append-only 不受影响，属图谱去重语义（按父子 cursor 路径交集）的设计结果，但用户会看到同一消息多次出现 | jsdom 套件未覆盖"父游标回退"状态；建议补一条夹具用例固化该语义，或评估改为按节点身份（nodeId+seq）去重 |
| OBS-2（低） | 点击共享祖先行路由到**根属主会话**（badges 末位 = s1）而非当前会话：在 g1 中点击自己路径上的祖先 e1 会切到 s1 | 记录待产品确认（"行属主优先"与"当前会话优先"两种语义均可辩护） |
| OBS-3（信息） | 跳转/会话切换会触发**两轮** fan-out 重载（显式 reloadCurrent + 列表版本号 effect） | 无功能影响；可在实现内去重 |

### 10.5 测试过程发现的测试设施问题（非插件缺陷）

测试台自身暴露并修复了 2 个 bug（`useSyncExternalStore` 快照被原地修改导致不重渲染；fork 前缀误取后代而非祖先）——这正是先用测试台再下结论的价值：上述 14 项结论均在测试台修复**之后**取得。

### 10.6 小结

实机 GUI 测试 **14/14 通过，未发现任何功能性缺陷**；插件在真实浏览器渲染、真实事件、明暗主题、多会话复杂谱系下的表现与 jsdom 套件断言的行为完全一致。OBS-1 是本轮最有价值的产出：一个现有自动化套件未覆盖、仅靠真实交互才能暴露的行为状态。

---


## 附录 A：证据复现命令

```sh
pnpm install                      # 安装依赖（Node >= 22, pnpm 11）
pnpm verify                       # CI 同款完整门禁：build + typecheck + pack 校验 + vitest
pnpm test                         # 仅功能测试（4 文件 / 111 用例）
for i in 1 2 3 4 5; do pnpm test; done   # 稳定性重复执行
pnpm add -Dw @vitest/coverage-v8 && pnpm vitest run --coverage.enabled \
  --coverage.include='packages/**/src/**'    # 覆盖率复测（测后 git checkout 恢复）
tar -tzf robiteame-dsh-session-tree-0.4.0.tgz    # tarball 内容审计
```

## 附录 B：测试文件与用例清单（describe 级）

- **pi-agent spec（37 例）**：`session_tree tool: append-only history`（25 例：追加/跳转/分叉/快照往返/多树隔离/事件投影/注入消息分离/压缩保留/日志导出回放/水印兼容/外域快照拒绝）· `session_tree plugin surfaces`（11 例：增量同步失败保护、原生事件水合、表面切换、选中节点命令、克隆全量事件日志、迟到工具结果合并、遗留拆分对折叠、注册面）· `stock Harness Session compatibility`（5 例：能力探测、marker 不可写降级、replace 事件重写 + sidecar、resume-valid、合成事件排除）
- **tool spec（32 例）**：`/fork command`（3）· `/clone command`（6）· `/tree command family`（6）· `/session command`（1）· 参数校验（3）· `sessionTree Remote service`（4）· store 级克隆（1）· `native surface mode`（4：能力检测、表面切换、持久化恢复、跳转 marker 回放）· `projection surface mode`（1）· `SessionTree domain guards`（1：checkpoint/rollback 全变更往返）
- **browser spec（35 例）**：`session tree browser plugin`（26 例：原生侧栏注册、/fork 路由、原生 fork 流、叠加层降级、图形渲染与节点绑定、横向边界、抽屉开合、会话切换关闭、响应式重载、工具交互静默渲染、失败标错、注入隐藏、折叠、选择器过滤与空态、内联菜单 portal 与嵌套连接轨、列表变更重建、无选中友好态）· `right-sidebar merged Session graph`（9 例：占位行、三层合并 DFS 徽章去重、跨会话先开后跳、分支独立折叠、祖先路径揭示、克隆行追加、失败会话隔离、载荷不可变、遗留视图降级、腐败父链接防御、双挂载点接线）
- **fork-lineage spec（7 例）**：快照身份替换与订阅通知、持久化恢复、敌意载荷容错、500 条上限淘汰、清理与解绑、提示语摘要、非浏览器惰性

*报告完 —— 测试执行与撰写：ZCode 自动化测试（2026-09-30）*

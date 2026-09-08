# awesome-dsh-plugin 收录申请(按官方 contributing.md 核实过)

提交方式:向 `github.com/awesome-dsh-plugin/awesome-dsh-plugin` 提 PR,
**只新增一个文件**:`data/plugins/robiteame__dsh-session-tree-extension.yml`,
内容如下(与现有条目 schema 一致):

```yaml
url: "https://github.com/robiteame/dsh-session-tree-extension"
name: "robiteame/dsh-session-tree-extension"
category: "tools"
description:
  en: "Pi-style append-only multi-branch session trees: fork or jump to any historical node without deleting history, clone a branch into a new session, and browse the tree in a WebUI panel. Works on stock Harness via graceful degradation."
  zh: "Pi 风格的追加式多分支会话树:在任意历史节点开分支或跳转而不删除旧历史,可将分支克隆为新会话,并在 WebUI 树面板中浏览(明暗主题)。在原版 Harness 上优雅降级运行。"
npm: "@robiteame/dsh-session-tree"
```

> `npm:` 字段属于可选附加项;若 CI lint 报不认识该字段,删掉这一行再推即可。
> 注意描述里含 `: ` 的值必须带引号(YAML 语法要求)。

## 提交前置检查单(官方 CI 会逐项检查)

| 要求 | 状态 |
|---|---|
| 仓库 `package.json` 声明 `dsh.bundle` | ✅ 已在根 package.json 声明,指向载体包组合层 |
| 真实可用代码(无占位) | ✅ 已发布 4 个 npm 包并有完整测试 |
| 仓库自带 CI,且不依赖已弃用的 Node 20 actions | ✅ `.github/workflows/ci.yml`:只用 Node 24 运行时的 `actions/checkout@v5` + `actions/setup-node@v5`,Node 22×24 矩阵跑完整 `pnpm verify`(2026-06-16 起 runner 强制 Node 24,`@v4` 系 action 会触发弃用告警,2026-09-23 后彻底移除) |
| 仓库年龄 ≥ 1 天 | ✅ |
| 仓库打了 `dsh-plugin` 主题标签 | ⬜ 提 PR 前记得在 GitHub 网页添加(见下) |
| 一个 PR 只加一个条目 | ✅ 我们只加一个文件 |

## 给仓库打 `dsh-plugin` 主题标签(网页操作)

1. 打开 `github.com/robiteame/dsh-session-tree-extension`
2. 右侧 About 栏点齿轮 ⚙️
3. 在 Topics 输入 `dsh-plugin` 回车 → Save changes

## 提 PR 的网页操作步骤

1. 打开 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin → 右上角 **Fork**
2. 在你的 fork 里进入 `data/plugins/` 目录 → **Add file → Create new file**
3. 文件名粘贴:`robiteame__dsh-session-tree-extension.yml`
4. 内容粘贴上面的 YAML → **Commit changes**
5. 页面会出现 "This branch is X commits ahead" → 点 **Contribute → Open pull request**
6. PR 标题:`plugin: add dsh-session-tree (append-only multi-branch session trees)`
7. 提交后等 CI 变绿;若 CI 报错按提示修改(推到同一分支即可,不要重开 PR)

维护者合并后,README 和市场网站会自动重新生成;次日即可在 DSH 插件市场内
搜索 `session tree` 并一键安装。

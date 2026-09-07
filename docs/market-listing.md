# dshmarket listing entry — for the awesome-dsh-plugin PR

After `npm publish` of all four packages, open a PR against
`github.com/awesome-dsh-plugin/awesome-dsh-plugin` adding this entry to the
curated list (fields follow the registry's `RegistryPlugin` shape):

```yaml
- name: dsh-session-tree
  owner: robiteame
  url: https://github.com/robiteame/dsh-session-tree-extension
  category: productivity
  description:
    en: >-
      Pi-style append-only multi-branch session trees. Fork or jump to any
      historical node without deleting history, clone a branch into a new
      session, and browse everything in a WebUI tree panel with light/dark
      themes. Works on stock Harness via graceful degradation.
    zh: >-
      Pi 风格的追加式多分支会话树。在任意历史节点开分支或跳转而不删除旧历史，
      可将分支克隆为新会话，并在 WebUI 树形面板中浏览（支持明暗主题）。
      在原版 Harness 上通过优雅降级正常运行。
  npm: '@robiteame/dsh-session-tree'
  install: dsh plugin --profile <profile> add @robiteame/dsh-session-tree
  added: '2026-09-07'
```

PR title suggestion:
`plugin: add dsh-session-tree (append-only multi-branch session trees)`

PR body (English, with the zh summary):

> Adds **dsh-session-tree** — a Pi-style append-only, multi-branch conversation
> tree for DeepSeek-Harness.
>
> - One-command install: `dsh plugin --profile <profile> add @robiteame/dsh-session-tree`
> - `session_tree` tool, `/tree` `/fork` `/clone` `/session` commands, and a
>   WebUI tree panel (additive overlay on official builds; native details dock
>   on patched builds)
> - Append-only semantics with versioned JSON snapshots; every operation
>   answers `{ok, value|error}`
> - Zero core modifications: capability-detected branch switching with
>   stock-surface emulation and a durable per-session sidecar; the optional
>   engine patch stays dev-only
> - Ships prebuilt artifacts, no lifecycle scripts; tested end-to-end against
>   Harness 0.1.2-alpha.3 (install, fork/jump/clone, panel, restart
>   persistence, uninstall)
>
> 中文摘要：Pi 风格追加式多分支会话树，一条命令安装，含 session_tree 工具、
> /tree /fork /clone /session 命令与 WebUI 树面板；不改 Harness 核心，原版构建
> 上优雅降级运行。

Attach or link a screenshot of the tree panel (see
`docs/` in the plugin repository) per the catalog's screenshot convention.

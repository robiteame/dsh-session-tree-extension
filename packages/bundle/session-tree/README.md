# @robiteame/dsh-session-tree

Carrier Bundle for [DeepSeek-Harness](https://github.com/deepseek-ai/deepseek-harness)
adding Pi-style append-only multi-branch session trees. Installing this one
package mounts all three implementation packages through its
`cordis.patch.yml` composition layer:

| Composition row | Package | Role |
|---|---|---|
| `pi-agent-session-tree` | `@robiteame/dsh-pi-agent-session-tree` | `SessionTree`/`SessionTreeStore` domain service and the `sessionTree` Remote (`list`/`jump`/`fork`/`session`) |
| `tool-session-tree` | `@robiteame/dsh-tool-session-tree` | `session_tree` tool, `/tree` `/fork` `/clone` `/session` commands, system-prompt section |
| `ui-session-tree` | `@robiteame/dsh-client-ui-session-tree` | WebUI tree panel (native right-Sidebar tab, with an overlay fallback on older builds) |

## Install

Desktop: **Settings → Plugins → Add plugin**, choose the official npm
registry, install `@robiteame/dsh-session-tree@0.7.3`, then restart. CLI with
the `0.2.1-rc.3` plugin manager or newer:

```sh
dsh plugin --profile <profile> add @robiteame/dsh-session-tree@0.7.3
```

This package carries no code of its own: `dependencies` pulls the three
implementation packages into the profile workspace and `dsh.bundle.patch`
points the composition loader at them. Requires DeepSeek-Harness 0.2.x and
Cordis 4.x, verified on `0.2.1-rc.5`. See
[INSTALL.md](https://github.com/robiteame/dsh-session-tree-extension/blob/main/INSTALL.md)
for verification, uninstall, and the mainland mirror that only serves `0.7.0`.

See the [repository README](https://github.com/robiteame/dsh-session-tree-extension)
for the full feature tour, degradation behaviour on official Harness builds,
and development instructions.

## License

MIT.

# Installation

## Desktop

1. Open **Settings → Plugins → Add plugin**.
2. Under **Registry**, choose the official npm registry
   (`https://registry.npmjs.org/`). On Windows and mainland-China networks the
   dialog may preselect the mainland mirror, which has not synced `0.7.2`.
3. Install `@robiteame/dsh-session-tree@0.7.3`, restart the app, then run
   `/tree`.

The plugin manager activates the carrier bundle and composes the
`pi-agent-session-tree`, `tool-session-tree`, and `ui-session-tree` rows.
Desktop profiles are managed by the app, so `dsh plugin --profile desktop`
is refused; use the in-app dialog.

## CLI

A Harness CLI with the `0.2.1-rc.3` plugin manager or newer:

```sh
dsh plugin --profile <profile> add @robiteame/dsh-session-tree@0.7.3
```

Offline install from the prebuilt tarball (no build step):

```sh
dsh plugin --profile <profile> add robiteame-dsh-session-tree-0.7.3.tgz
```

Restart the profile and confirm the composition:

```sh
dsh --profile <profile> --dump-config   # pi-agent-session-tree, tool-session-tree, ui-session-tree
```

## Requirements

- DeepSeek-Harness 0.2.x and Cordis 4.x. The published peer range is
  `^0.2.1-rc.2`, which includes the current `0.2.2-rc.1` desktop.
- Node.js 22 or newer.
- No lifecycle scripts: the packages ship prebuilt `lib/` artifacts, so no
  `allowBuilds` entries are needed.

## Uninstall

Desktop: remove the bundle from Plugins. CLI:

```sh
dsh plugin --profile <profile> remove @robiteame/dsh-session-tree
```

## Troubleshooting

### Only `0.7.0` is offered

Registries are asked in order and the first answer wins. The mainland mirror
(`registry.npmmirror.com`) has not synced `0.7.2` for the carrier or the
tool/UI packages, so an install that resolves through it gets `0.7.0`. The
Desktop dialog may select the mirror automatically after its npm-vs-mirror
ping race, or because pnpm's own configuration names it.

Choose the official npm registry in the dialog before installing, or route
the scope for CLI installs:

```sh
npm config set @robiteame:registry https://registry.npmjs.org
dsh plugin --profile <profile> add @robiteame/dsh-session-tree@0.7.3
```

Confirm the version is visible from the registry that answered:

```sh
pnpm view @robiteame/dsh-session-tree versions --registry https://registry.npmjs.org
```

### Web boot fails on `0.7.0`

The `0.7.0` browser bundle aborts boot with
`cannot get property "sidebarRightTabs" without inject`. Version `0.7.2` reads
the optional Sidebar services through `ctx.get()` instead. Upgrade, restart
the app or profile, and reload the WebUI.

## Contributors — source integration

Building and testing the packages standalone needs no Harness checkout:

```sh
pnpm install
pnpm verify     # build + typecheck + pack dry-run + vitest
```

Inside a `dsh-v0.2.1-rc.2` source checkout (native branch switching via
`Session.selectMessageSurface()`):

```sh
dev/install.sh /path/to/deepseek-harness
cd /path/to/deepseek-harness && pnpm install && pnpm run build
```

The script applies `dev/session-branch-surface.patch` (optional engine
capability; skip with `ST_NO_SURFACE=1`) and `dev/harness.patch`, then copies
the packages and docs. See [`dev/README.md`](./dev/README.md). The source
patches have not been validated against `0.2.1-rc.5`.

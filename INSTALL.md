# Installation

## Users — install the published Bundle

### DeepSeek Harness Desktop

Open **Settings → Plugins → Market**, search for
`@robiteame/dsh-session-tree`, install it, and restart the app. The desktop
plugin manager activates the carrier bundle and composes its three rows; after
the restart, `/tree` opens the panel.

Older desktop builds bundle the `0.2.1-rc.2` CLI, whose `dsh plugin` command only
forwards to pnpm and does not activate a new bundle. Use the in-app market
there.

### CLI (`0.2.1-rc.3` and newer)

The supported CLI install is one command against your profile; the `0.2.1-rc.3`
plugin manager activates the newly installed bundle:

```sh
dsh plugin --profile <profile> add @robiteame/dsh-session-tree
```

or, fully offline, with the prebuilt tarball (no install scripts, no build
step):

```sh
dsh plugin --profile <profile> add robiteame-dsh-session-tree-0.7.2.tgz
```

The carrier package pulls its three implementation packages
(`@robiteame/dsh-pi-agent-session-tree`, `@robiteame/dsh-tool-session-tree`,
`@robiteame/dsh-client-ui-session-tree`) as dependencies and mounts them
through its `cordis.patch.yml` composition layer. After the install, restart
the profile and check the composition:

```sh
dsh --profile <profile> --dump-config
```

The dump should contain the `pi-agent-session-tree`, `tool-session-tree`, and
`ui-session-tree` rows. In the WebUI, `/tree` opens the panel, clicking a node
binds it as the active context, and `/fork` `/clone` `/session` operate on the
tree. `session_tree`'s `context`/`session` operations report the active
`surface` mode.

### Requirements

- DeepSeek-Harness `^0.2.1-rc.2` and Cordis `~4.0.5`. The current development
  and verification baseline is published `0.2.1-rc.5`; earlier releases were
  also verified against `0.2.1-rc.2` and `0.2.1-rc.3`.
- Node.js 22 or newer.
- No `allowBuilds` entries: the packages declare no lifecycle scripts and ship
  prebuilt artifacts.

### Uninstall

Desktop: remove the plugin from the in-app market. CLI:

```sh
dsh plugin --profile <profile> remove @robiteame/dsh-session-tree
```

The composition rows disappear with the bundle entry; nothing else in the
Harness installation is touched — the plugin never modifies Harness files.

### Troubleshooting older installs

#### `ERR_PNPM_NO_MATCHING_VERSION` for a session-tree dependency

The old `@robiteame/dsh-session-tree@0.3.0` carrier references implementation
packages whose `0.3.0` versions are unavailable on npm. Upgrade the carrier to
`0.7.2`; its three implementation packages are all available on the official
npm registry. Some mirrors also serve an older `latest` tag: on 2026-11-11,
npmmirror still advertised `0.7.0` for the carrier and UI packages while the
official registry advertised `0.7.2`.

For CLI installs, use a Harness CLI at `0.2.1-rc.3` or newer, route the
`@robiteame` scope to the official registry, and install the fixed version:

```sh
npm config set @robiteame:registry https://registry.npmjs.org
dsh plugin --profile <profile> add @robiteame/dsh-session-tree@0.7.2
```

The registry setting applies to `@robiteame` packages. Restart the profile
after installation and check the three composition rows with `--dump-config`
as described above. On older Desktop builds, use the in-app market to upgrade
and activate the bundle.

#### Web boot fails with `cannot get property "sidebarRightTabs" without inject`

This affects the `0.7.0` browser bundle. Upgrade to `0.7.2` using the steps
above, restart the profile or Desktop app, and reload the WebUI so it loads the
updated client bundle. Version `0.7.2` includes the fix: optional
`sidebarRightTabs`, `sidebarRight`, and `uiWorkspace` services are read through
Cordis' inject-free `ctx.get()` API. Older layouts can still use the overlay
fallback when the native Sidebar services are absent.

See [installation issue #1](https://github.com/robiteame/dsh-session-tree-extension/issues/1)
and [Web boot issue #2](https://github.com/robiteame/dsh-session-tree-extension/issues/2).

## Contributors — source integration

Building and testing the packages standalone happens in this repository
without a Harness checkout:

```sh
pnpm install
pnpm verify     # build + typecheck + pack dry-run + vitest (stock packages)
```

To run inside a DeepSeek-Harness `dsh-v0.2.1-rc.2` source checkout (native branch switching via
`Session.selectMessageSurface()` and source integration):

```sh
dev/install.sh /path/to/deepseek-harness
cd /path/to/deepseek-harness
pnpm install
pnpm run build
```

The script applies `dev/session-branch-surface.patch` (optional engine
capability; skip with `ST_NO_SURFACE=1`) and `dev/harness.patch` (composition and TypeScript registration), then
copies the three packages and docs. See
[`dev/README.md`](./dev/README.md). These source patches have not been validated
against `0.2.1-rc.5`. The current official WebUI already exposes
the extensible right Sidebar, so no UI or generated catalog patch is required.

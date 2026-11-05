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

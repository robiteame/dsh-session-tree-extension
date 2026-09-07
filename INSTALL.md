# Installation

## Users — install the published Bundle

The supported install is one command against your profile:

```sh
dsh plugin --profile <profile> add @robiteame/dsh-session-tree
```

or, fully offline, with the prebuilt tarball (no install scripts, no build
step):

```sh
dsh plugin --profile <profile> add robiteame-dsh-session-tree-0.1.0.tgz
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

- DeepSeek-Harness `0.1.2-alpha.3` or a compatible `0.1.2` build (provides the
  `@deepseek-ai/*` peers) and Cordis `^4.0.2`.
- Node.js 22 or newer.
- No `allowBuilds` entries: the packages declare no lifecycle scripts and ship
  prebuilt artifacts.

### Uninstall

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

To run inside a DeepSeek-Harness source checkout (native branch switching via
`Session.selectMessageSurface()`, native details dock):

```sh
dev/install.sh /path/to/deepseek-harness
cd /path/to/deepseek-harness
pnpm install
pnpm run build
```

The script applies `dev/session-branch-surface.patch` (optional engine
capability; skip with `ST_NO_SURFACE=1`) and `dev/harness.patch` (composition,
tsconfig, lockfile), then copies the three packages and docs. See
[`dev/README.md`](./dev/README.md). If the harness translation-pairing check
flags `docs/tool-catalog.md` after installation, rerun
`pnpm run verify-translation-pairing --write docs/tool-catalog.md`.

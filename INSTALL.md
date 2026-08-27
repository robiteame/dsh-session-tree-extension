# Installation

The extension ships as three workspace packages that must live inside a
DeepSeek-Harness checkout, because their peer dependencies are workspace
packages (`workspace:^`). The integration edits to the harness itself are
captured in `harness.patch`.

## One command

```sh
./install.sh /path/to/deepseek-harness
```

## Manual steps

From this repository:

```sh
HARNESS=/path/to/deepseek-harness
cp -R packages/extensions/pi-agent-session-tree "$HARNESS/packages/extensions/"
cp -R packages/extensions/tool-session-tree      "$HARNESS/packages/extensions/"
cp -R packages/client/ui-session-tree            "$HARNESS/packages/client/"
cp -R docs/subsystems/session-tree.md            "$HARNESS/docs/subsystems/"
cp -R docs/subsystems/session-tree.zh.md         "$HARNESS/docs/subsystems/"
cp -R docs/subsystems/session-tree.i18n.yaml     "$HARNESS/docs/subsystems/"
```

Then apply the harness-side edits and refresh the lockfile:

```sh
cd "$HARNESS"
git apply /path/to/dsh-session-tree-extension/harness.patch
pnpm install
```

The patch registers:

- `sessionTree` in the `api-remotes` client assembly and tsconfig references
  (so the browser gets `ctx.remote.sessionTree`).
- Host rows `pi-agent-session-tree` + `tool-session-tree` in the `dsh-base`
  bundle composition.
- The `ui-session-tree` browser row in the `dsh-web-app` bundle composition.
- The three packages in `tsconfig.base.json` paths and the host/client
  aggregate project references.
- `sessionTree` in the generated Cordis API catalog and `session_tree` in the
  generated tool schema catalog.

## Build and run

```sh
cd "$HARNESS"
pnpm run build        # Host tsdown regenerates the sessionTree Typert Remote contract
pnpm run dev:web      # or the profile's usual run command
```

Then type `/tree` in the composer and open the dock panel.

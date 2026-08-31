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

Apply the Harness integration patch **before** copying the extension packages,
then install dependencies:

```sh
HARNESS=/path/to/deepseek-harness
cd "$HARNESS"
git apply /path/to/dsh-session-tree-extension/harness.patch

cp -R /path/to/dsh-session-tree-extension/packages/extensions/pi-agent-session-tree packages/extensions/
cp -R /path/to/dsh-session-tree-extension/packages/extensions/tool-session-tree      packages/extensions/
cp -R /path/to/dsh-session-tree-extension/packages/client/ui-session-tree            packages/client/
cp /path/to/dsh-session-tree-extension/docs/subsystems/session-tree.md                docs/subsystems/
cp /path/to/dsh-session-tree-extension/docs/subsystems/session-tree.zh.md             docs/subsystems/
cp /path/to/dsh-session-tree-extension/docs/subsystems/session-tree.i18n.yaml         docs/subsystems/
cp /path/to/dsh-session-tree-extension/docs/tool-catalog.md                         docs/
cp /path/to/dsh-session-tree-extension/docs/tool-catalog.zh.md                      docs/
cp /path/to/dsh-session-tree-extension/docs/tool-catalog.i18n.yaml                  docs/

pnpm install
```

Applying the patch first is required because it contains only changes to
upstream Harness integration files; extension package sources are copied as new
paths and intentionally do not appear in `harness.patch`.

The patch registers:

- Host rows `pi-agent-session-tree` + `tool-session-tree` in the `dsh-base`
  bundle composition and package dependencies.
- The `ui-session-tree` browser row in the `dsh-web-app` bundle composition and
  package dependencies.
- The three packages in `tsconfig.base.json` paths and the host/client
  aggregate project references.
- Workspace lockfile importers for all three packages. The browser package
  mounts the generated `sessionTree` Remote contribution directly, so the
  central `api-remotes` assembly does not need a fragile source edit.
- The Cordis/tool catalog generator manifests and generated catalog source,
  so `verify-cordis-catalog` and `verify-tool-catalog` remain exhaustive.

## Build and run

```sh
cd "$HARNESS"
pnpm run build        # Host tsdown regenerates the sessionTree Typert Remote contract
pnpm run dev:web      # or the profile's usual run command
```

Then type `/tree` in the composer and open the dock panel.

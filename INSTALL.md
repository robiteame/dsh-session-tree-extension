# Installation

The repository root is an independently installable DeepSeek-Harness Bundle.
It has its own `package.json`, root `cordis.patch.yml`, generated Host and
browser artifacts under `lib/`, and a `prepare` script that can build a fresh
Git checkout. Install this root package for normal profile use; the three
directories under `packages/` are source modules used by the legacy Harness
workspace integration.

## Official `dsh plugin` installation

The standard command adds the Bundle to the Web profile and activates both its
Host and WebUI faces:

```sh
dsh plugin --profile web add file:/absolute/path/to/dsh-session-tree-extension
```

The package can be supplied as a local path, a GitHub checkout, or a tarball.
After `dsh plugin` succeeds, the profile manifest should contain
`@deepseek-ai/dsh-session-tree` in `dsh.profile.bundles`.

### Local path

Build a local checkout before linking it into the profile:

```sh
cd /path/to/dsh-session-tree-extension
pnpm install
pnpm build
dsh plugin --profile web add file:/path/to/dsh-session-tree-extension
```

Use the explicit `file:` form for a reliable standalone install: pnpm copies
the package into the profile, allowing Harness' module fallback to provide its
host peers. A bare absolute directory is a pnpm link and is intended only for
development with a complete compatible runtime closure; Node's realpath rules
can otherwise select a second Cordis copy or miss peers. A local `file:`
directory install does not need a Git `prepare` allowlist entry.

### GitHub repository

Install the published repository directly (pin a commit for reproducibility):

```sh
dsh plugin --profile web add github:robiteame/dsh-session-tree-extension#COMMIT_SHA
```

The `#COMMIT_SHA` suffix is optional; replace `COMMIT_SHA` with the full or
abbreviated revision you intend to trust. Git dependencies contain source
rather than generated artifacts. pnpm runs this
package's self-contained `prepare` script to produce `lib/` during installation.
With pnpm 10 or newer, lifecycle scripts are blocked until the consumer grants
permission. If the first command fails with pnpm's `allowBuilds` diagnostic,
copy the exact package key it prints into
`$DSH_HOME/profiles/web/pnpm-workspace.yaml` and rerun the command:

```yaml
allowBuilds:
  '@deepseek-ai/dsh-session-tree@github:robiteame/dsh-session-tree-extension#RESOLVED_SHA': true
```

The value above shows the usual shape. The key must match pnpm's diagnostic
exactly because its resolved Git specifier varies by pnpm version. This
permission executes the Git checkout's build code on the local machine, so
review and pin the source revision before allowing it.

### Prebuilt tarball

Building a tarball moves the build step out of profile installation and avoids
the Git lifecycle permission. `pnpm pack` itself runs this package's `prepare`
script; the explicit `pnpm build` below provides a separate build check:

```sh
cd /path/to/dsh-session-tree-extension
pnpm install
pnpm build
pnpm pack
dsh plugin --profile web add /path/to/dsh-session-tree-extension/deepseek-ai-dsh-session-tree-0.1.2-alpha.3.tgz
```

Check the generated archive before distributing it:

```sh
pnpm pack --dry-run
pnpm pack:check
```

The archive must include `package.json`, `cordis.patch.yml`, `lib/index.js`,
`lib/client.js`, and the Typert artifacts (`lib/typert.host.js` and
`lib/typert.remote-client.js`). A tarball install has no source `prepare` step
in the target profile and therefore needs no `allowBuilds` entry.

## Verify a profile install

Inspect the composed configuration without starting the server:

```sh
dsh --profile web --dump-config
```

The output should include a `session-tree` row whose package name is
`@deepseek-ai/dsh-session-tree`. Then start the Web profile:

```sh
dsh --profile web
```

The running profile should expose the `session_tree` tool, `/tree`, `/fork`,
`/clone`, and `/session` commands, plus the session-tree panel. On an unmodified
official Harness the panel is an additive right-side overlay that leaves Tool
details intact; the legacy patched Harness uses the named native details panel.
Restart the profile after adding, removing, or updating a Bundle so the Bundle
membership and module graph are rebuilt.

## Compatibility

The standalone Bundle is built and tested with DeepSeek-Harness
`0.1.2-alpha.3`, Cordis `4.0.2`, and Node.js 22 or newer. It follows the pnpm
10+ build-script policy described above; the Git flow was verified with pnpm
11. Its Host artifact keeps Harness modules external so the profile can share
one Cordis and one set of Harness services; the target installation must
provide compatible published versions. Harness revisions that change Loader,
Typert, command, or WebUI contracts may require a corresponding Bundle rebuild
or source update.

### Behaviour on an unmodified official Harness

Official `0.1.2-alpha.3` has neither the selected-message-surface API nor the
durable `session-tree/*` event vocabulary that this repository's
`harness.patch` adds. The standalone Bundle detects that at runtime and
degrades cleanly instead of failing: the tree remains visible and browsable,
and jump/fork/clone/snapshot operations work inside the live process. Two
stock-mode limits follow from that design:

- The next model turn cannot be rewritten to a historical node in place,
  because `Session.selectMessageSurface()` does not exist; applying
  `harness.patch` in a source checkout restores that switch.
- Branch/cursor/selection markers and explicit snapshots are not appended to
  the Session log, because stock persistence would reject the unknown event
  types. Restart-safe branch persistence therefore requires a patched Harness
  checkout or a kept-alive profile process.

## Legacy source-checkout integration

`install.sh` remains available for development inside a DeepSeek-Harness source
checkout and is intentionally separate from the official Bundle install:

```sh
./install.sh /path/to/deepseek-harness
```

The script applies `harness.patch`, copies the three source packages into the
Harness workspace, copies the session-tree documentation, and refreshes the
Harness lockfile. It preserves the original workspace-based flow and should be
used when you need to edit or debug the extension alongside Harness source.

The source integration and standalone Bundle are alternative deployment modes.
Do not enable the root `session-tree` row in a composition that still has the
legacy `pi-agent-session-tree`, `tool-session-tree`, and `ui-session-tree` rows:
they own the same service, tool, commands, Remote, and panel. Disable the three
legacy rows through a later profile patch before migrating, or leave the
standalone Bundle uninstalled in that checkout.

### Manual legacy steps

Apply the Harness integration patch **before** copying the extension packages,
then install dependencies:

```sh
HARNESS=/path/to/deepseek-harness
cd "$HARNESS"
git apply /path/to/dsh-session-tree-extension/harness.patch

cp -R /path/to/dsh-session-tree-extension/packages/extensions/pi-agent-session-tree packages/extensions/
cp -R /path/to/dsh-session-tree-extension/packages/extensions/tool-session-tree      packages/extensions/
cp -R /path/to/dsh-session-tree-extension/packages/client/ui-session-tree            packages/client/
cp /path/to/dsh-session-tree-extension/docs/subsystems/session-tree.md              docs/subsystems/
cp /path/to/dsh-session-tree-extension/docs/subsystems/session-tree.zh.md            docs/subsystems/
cp /path/to/dsh-session-tree-extension/docs/subsystems/session-tree.i18n.yaml        docs/subsystems/
cp /path/to/dsh-session-tree-extension/docs/tool-catalog.md                          docs/
cp /path/to/dsh-session-tree-extension/docs/tool-catalog.zh.md                       docs/
cp /path/to/dsh-session-tree-extension/docs/tool-catalog.i18n.yaml                   docs/

pnpm install
pnpm run build
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
- The Cordis/tool catalog generator manifests and generated catalog source, so
  `verify-cordis-catalog` and `verify-tool-catalog` remain exhaustive.

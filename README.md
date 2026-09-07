# dsh-session-tree-extension

Append-only, multi-branch conversation trees for
[DeepSeek-Harness](https://github.com/deepseek-ai/deepseek-harness) — a
PI-Agent-style SessionTree. The agent's history becomes a tree of immutable
nodes, forkable at any historical node, with standard LLM message
reconstruction, versioned JSON snapshots, and a WebUI tree panel. On an
unmodified official Harness it opens as an additive right-side overlay; the
legacy `harness.patch` integration uses the native named details sidebar (no
standalone page or manual ID entry).

## What is here

| Path | Role |
|---|---|
| `packages/extensions/pi-agent-session-tree/` | Host domain service: `SessionTree`/`SessionTreeStore`, the Typert `sessionTree` Remote (`list`, `jump`), and pure payload types |
| `packages/extensions/tool-session-tree/` | Model-facing surface: the `session_tree` tool, the `/tree`, `/fork`, `/clone`, `/session` commands, and the system-prompt section |
| `packages/client/ui-session-tree/` | Browser half: the native right-details-sidebar panel on patched Harness, the additive right-side overlay on an official Bundle (light/dark via `--dsw-alias-*` tokens) |
| `docs/subsystems/session-tree.md` | Subsystem reference (en/zh) |
| `harness.patch` | Latest-Harness integration only (bundle composition/dependencies, tsconfig registrations, lockfile importers); package sources are copied separately |

The repository root is also a standalone DeepSeek-Harness Bundle. It packages the
Host service, model-facing surfaces, and WebUI client into one package, so a
profile install does not need a sibling Harness workspace. The three directories
under `packages/` remain the source layout used by the legacy source integration;
do not install those child packages separately when using `dsh plugin`.

## Install as a dsh Bundle

The supported profile installation command is:

```sh
dsh plugin --profile web add file:/absolute/path/to/dsh-session-tree-extension
```

The command accepts a local checkout, a GitHub repository, or a prebuilt tarball.
After a successful install, the package is added to the profile's
`dsh.profile.bundles` list. One Bundle row then loads all of the following:

- the `SessionTreeService` Host service and its Typert `sessionTree` Remote;
- the `session_tree` tool and `/tree`, `/fork`, `/clone`, and `/session` commands;
- the WebUI tree panel and its browser Remote client (native named details
  sidebar when `harness.patch` is present, additive overlay otherwise).

Verify the composed layer before starting the Web profile:

```sh
dsh --profile web --dump-config
dsh --profile web
```

The dump should contain a `session-tree` row. Once the WebUI is open, `/tree`
opens or refreshes the panel; selecting a node enables the branch-aware
`/fork` and `/clone` flows. The standalone Bundle's overlay is deliberately
additive and leaves the official Tool-details occupant untouched.

### Local checkout

Build the checkout once, then add its absolute path:

```sh
cd /path/to/dsh-session-tree-extension
pnpm install
pnpm build
dsh plugin --profile web add file:/path/to/dsh-session-tree-extension
```

Use the explicit `file:` form for a reliable standalone install: pnpm copies
the built package into the profile, where Harness' module fallback can resolve
the host peers. A bare `/absolute/path` is a pnpm link; it is useful for
development only when that checkout has a complete compatible runtime closure,
and it can otherwise resolve a second Cordis copy or miss peers through Node's
realpath rules. A local `file:` install does not require the Git `prepare` build
allowance. `pnpm build` is still recommended before installing so that a
partially built checkout cannot be selected by the profile.

### GitHub checkout

The repository can be installed directly from GitHub. To follow the latest
`main`:

```sh
dsh plugin --profile web add github:robiteame/dsh-session-tree-extension#main
```

Pin a revision when a profile must be repeatable:

```sh
dsh plugin --profile web add github:robiteame/dsh-session-tree-extension#COMMIT_SHA
```

Replace `COMMIT_SHA` with the full or abbreviated Git revision you intend to
trust. Git installs fetch source and run this package's self-contained
`prepare` script to generate `lib/` before the Bundle is loaded.

With pnpm 10 or newer, the first Git install may be rejected because lifecycle
scripts are disabled by default. Copy the exact package key printed by pnpm
into the profile workspace file (normally
`$DSH_HOME/profiles/web/pnpm-workspace.yaml`), then rerun the same command:

```yaml
allowBuilds:
  '@deepseek-ai/dsh-session-tree@https://codeload.github.com/robiteame/dsh-session-tree-extension/tar.gz/RESOLVED_SHA': true
```

pnpm 11 resolves Git sources to a codeload URL in that key; older pnpm versions
may print a different resolved specifier. Always copy the key from pnpm's own
diagnostic rather than editing the example. This permission executes the
package's source build on the local machine, so only allow a revision you
trust.

### Tarball (no install-time build)

To avoid running a Git `prepare` script, build and install a tarball. By
default, `pnpm pack` runs this package's `prepare` script, so an explicit
`pnpm build` is optional but useful as a separate verification step:

```sh
cd /path/to/dsh-session-tree-extension
pnpm install
pnpm build
pnpm pack
dsh plugin --profile web add /path/to/dsh-session-tree-extension/deepseek-ai-dsh-session-tree-0.1.2-alpha.3.tgz
```

The tarball contains `package.json`, `cordis.patch.yml`, and the generated
`lib/` Host, client, and Typert artifacts. It does not need an `allowBuilds`
entry because no source build runs in the profile.

## Compatibility

This Bundle is tested against DeepSeek-Harness `0.1.2-alpha.3` and Cordis
`4.0.2` (Node.js 22 or newer). Harness modules are externalized from the Host
artifact so the profile can share the installation's single Cordis and service
instances; the target profile must therefore provide the matching published
Harness package versions. Older or newer Harness revisions may change Loader,
Typert, command, or WebUI contracts and are not guaranteed to work. Rebuild the
Bundle after deliberately upgrading the Harness revision and re-run the profile
checks.

### Stock official Harness behaviour

The `dsh plugin` flow runs against an unmodified official Harness, so the
Bundle uses only Harness' public surface and persistence contracts:

- **Historical node switches.** Stock `0.1.2-alpha.3` has no
  `Session.selectMessageSurface()`. On jump/fork/branch, the Bundle appends an
  official empty-content `assistant/message` event carrying a `replace`
  `surfaceOp`, then rewrites the live surface nodes to the selected path. The
  empty assistant event projects to no transcript message but invalidates
  Harness' derived-history cache, so the next model turn starts from the
  clicked historical leaf. The event remains append-only and uses only known
  official types.
- **Durable tree metadata.** Stock persistence does not recognize
  `session-tree/*` events. Branch names, cursor, selection, and explicit
  snapshots are stored in a plugin-owned sidecar at
  `$DSH_HOME/storages/session-tree/<sessionId>.json`. It is written
  atomically during sync/flush and restored before the next pre-step, which
  keeps branches alive across a profile restart.

The sidecar is separate from Harness' own session artifact: when a raw
`session.jsonl.zstd` is exported or copied between machines, copy the matching
sidecar file too, or restore the tree with `/tree snapshot save/load`. A
patched Harness source checkout still uses the native selected-surface API and
durable `session-tree/*` events instead.

## Semantics

- **Append-only** — every node is immutable; branching and jumping only move
  the cursor. Old branches are never edited or deleted.
- **Every entry is a node** — messages, tool calls, model switches, compaction
  records, branch summaries, and custom entries all become typed nodes
  (`message`, `tool_call`, `model_change`, `compaction`, `branch_summary`,
  `custom`; `tool_result` survives only for orphan results with no matching
  call); each has a unique `nodeId` and a `parentId` (root is `null`). A node
  may have multiple children — that is the fork.
- **One entry per tool interaction** — a `tool/call` and its `tool/result` fold
  into a single `tool_call` node whose `content` carries both the call part and
  the result part (`isError` plus the node's `error` mark failures), whether
  the pair arrives in one event batch or across sync batches. Legacy snapshots
  with split pairs fold on restore.
- **Cursor navigation** — `jump(nodeId)` moves the active leaf to a historical
  node; the next append grows a new branch from there. Sibling branches stay
  intact. Tree navigation is a projection-side view: historical nodes are
  never deleted, and the durable Harness Session log remains the source of
  truth.
- **LLM context** — `context` returns the standard `messages` array for the
  root→cursor path only.
- **Compaction** — Harness surface replacement is recorded as an immutable
  `compaction` node instead of pretending the shadowed messages were deleted.
- **Snapshots** — `snapshot.save`/`snapshot.load` round-trip the whole tree as
  versioned JSON (`version: 1`).
- **Multiple trees** — one independent tree per agent session.
- **Errors** — every operation answers `{ok: true, value}` or
  `{ok: false, error: {code, message}}`.

## Legacy source integration

```sh
./install.sh /path/to/deepseek-harness
```

This existing workflow is preserved for developing directly inside a
DeepSeek-Harness source checkout. The script copies the three source packages
into the checkout, applies `harness.patch` to the Harness working tree, and
refreshes its lockfile. It intentionally uses the Harness workspace package
links and is separate from the standalone root Bundle described above. See
[INSTALL.md](INSTALL.md) for the manual steps and the composition rows it adds.

Treat the Bundle and `install.sh` as alternative deployment modes. Enabling the
root `session-tree` row in a Harness checkout whose profile already contains
the legacy `pi-agent-session-tree`, `tool-session-tree`, and `ui-session-tree`
rows would register the same service, tool, commands, and panel twice. Disable
those three legacy rows in a later profile patch before migrating that checkout
to the Bundle, or keep using the source integration alone.

## Quick start

```sh
cd /path/to/deepseek-harness
pnpm install
pnpm run build        # regenerate Typert contracts + client bundles
pnpm run dev:web      # or the profile's usual run command
```

For standalone Bundle development, the equivalent checks run from this
repository root:

```sh
pnpm install
pnpm build
pnpm pack:check
```

Type `/tree` in the composer to open or refresh the tree panel. Click any
node to bind it as the active context; `/fork [branch]` and `/clone` then read
that selection automatically. If no node is selected they return the friendly
message `请先在右侧会话树选中目标节点`. The sidebar uses a bounded graph gutter
and vertical rows, so deep or large trees never create horizontal overflow.

The commands read the sidebar selection automatically: `/fork [branch]` forks
in place from the clicked node, `/clone` opens an independent Harness session
carrying the full source conversation, and `/session` reports tree status
(nodes/messages/branches/tokens/cost). The lower-level `/tree` subcommands
(`jump <nodeId>`, `branch`, `fork`, `clone`, `snapshot save|load`) remain
available for automation and backwards compatibility.

## License

MIT.

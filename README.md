# dsh-session-tree

[![npm](https://img.shields.io/npm/v/@robiteame/dsh-session-tree)](https://www.npmjs.com/package/@robiteame/dsh-session-tree)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Harness](https://img.shields.io/badge/DeepSeek--Harness-0.1.2--alpha.3-orange)](https://github.com/deepseek-ai/deepseek-harness)

Append-only, multi-branch conversation trees for
[DeepSeek-Harness](https://github.com/deepseek-ai/deepseek-harness) — a
PI-Agent-style SessionTree. The agent's history becomes a tree of immutable
nodes, forkable at any historical node, with standard LLM message
reconstruction, versioned JSON snapshots, and a WebUI tree panel.

Published as four npm packages under the `@robiteame` scope:

| Package | Role |
|---|---|
| [`@robiteame/dsh-session-tree`](./packages/bundle/session-tree) | Carrier Bundle: one install mounts everything below through its composition layer |
| [`@robiteame/dsh-pi-agent-session-tree`](./packages/extensions/pi-agent-session-tree) | Host domain service: `SessionTree`/`SessionTreeStore`, JSON snapshots, the `sessionTree` Remote (`list`/`jump`/`fork`/`session`) |
| [`@robiteame/dsh-tool-session-tree`](./packages/extensions/tool-session-tree) | Model-facing surface: the `session_tree` tool, `/tree` `/fork` `/clone` `/session` commands, system-prompt section |
| [`@robiteame/dsh-client-ui-session-tree`](./packages/client/ui-session-tree) | WebUI tree panel: additive right-side overlay on official builds, native details dock on patched builds |

## Install (users)

One command — from the plugin market UI, or from a Harness checkout's CLI:

```sh
dsh plugin --profile <profile> add @robiteame/dsh-session-tree
```

Prebuilt tarballs install the same way and need no build scripts:

```sh
dsh plugin --profile <profile> add robiteame-dsh-session-tree-0.1.0.tgz
```

After installing, restart the profile. The composition gains three rows
(`pi-agent-session-tree`, `tool-session-tree`, `ui-session-tree`) that load the
Host service, the tool and commands, and the browser panel. Type `/tree` in the
composer to open the panel; click a node to bind it as the active context, then
`/fork [branch]` and `/clone` operate on that selection. `/session` reports
tree status (nodes/messages/branches/tokens/cost) and the active surface mode.

Verify the composed layer:

```sh
dsh --profile <profile> --dump-config   # should list the three session-tree rows
```

Requires DeepSeek-Harness `0.1.2-alpha.3` (or a compatible `0.1.2` build) and
Cordis `^4.0.2`; the target installation provides those peers. No install
scripts run — the tarballs ship prebuilt `lib/` artifacts.

## Branch switching and graceful degradation

The plugin never modifies Harness core files. It capability-detects the
optional branch-selection engine API at runtime:

- **Native mode** — on a checkout carrying
  [`dev/session-branch-surface.patch`](./dev/session-branch-surface.patch)
  (`Session.selectMessageSurface()`), jump/fork switch the model-visible
  history directly: the next turn genuinely starts from the new branch.
- **Stock mode** — on an unmodified official Harness, the plugin emulates the
  switch through official append APIs (an empty `replace` surface event) plus a
  plugin-owned sidecar under `$DSH_HOME/storages/session-tree/` for durable
  branch state. The log stays resume-valid.
- **Projection mode** — if even the emulation is unavailable, navigation moves
  the tree projection and panel only, and the next turn keeps the canonical
  history.

Every mode is honest about itself: `session_tree`'s `context`/`session`
operations and `/tree` outputs carry a `surface` field (`native`, `stock`, or
`projection`), and the Host log prints a one-time notice when a session runs in
a non-native mode. Move the raw `session.jsonl.zstd` between machines together
with the matching sidecar file, or carry the projection explicitly with
`/tree snapshot save/load`.

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
  intact. The durable Harness Session log remains the source of truth.
- **LLM context** — `context` returns the standard `messages` array for the
  root→cursor path only.
- **Compaction** — surface replacement is recorded as an immutable `compaction`
  node instead of pretending the shadowed messages were deleted.
- **Snapshots** — `snapshot.save`/`snapshot.load` round-trip the whole tree as
  versioned JSON (`version: 1`).
- **Multiple trees** — one independent tree per agent session.
- **Errors** — every operation answers `{ok: true, value}` or
  `{ok: false, error: {code, message}}`.

## Development (contributors)

The repository is a pnpm workspace building the three implementation packages
standalone (no Harness checkout needed):

```sh
pnpm install
pnpm verify      # build + typecheck (host & client) + pack dry-run + vitest
pnpm pack:all    # produce the four tarballs
```

Tests run against the published Harness packages (`0.1.2-alpha.3`) — the
stock-mode paths — with `vitest` from the repository root. The browser spec in
`packages/client/ui-session-tree` needs the Harness client test runtime and
runs inside a source-integrated checkout.

### Source integration against a Harness checkout

For debugging against Harness source (native mode, native details dock):

```sh
dev/install.sh /path/to/deepseek-harness     # applies both dev patches + copies packages
cd /path/to/deepseek-harness && pnpm install && pnpm run build
```

See [`dev/README.md`](./dev/README.md) for what each patch does. This flow is
for contributors only — user installs never touch a Harness checkout.

## License

MIT.

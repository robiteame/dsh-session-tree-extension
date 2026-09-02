# dsh-session-tree-extension

Append-only, multi-branch conversation trees for
[DeepSeek-Harness](https://github.com/deepseek-ai/deepseek-harness) — a
PI-Agent-style SessionTree. The agent's history becomes a tree of immutable
nodes, forkable at any historical node, with standard LLM message
reconstruction, versioned JSON snapshots, and a WebUI tree panel rendered in
the existing right details sidebar (no standalone page or manual ID entry).

## What is here

| Path | Role |
|---|---|
| `packages/extensions/pi-agent-session-tree/` | Host domain service: `SessionTree`/`SessionTreeStore`, the Typert `sessionTree` Remote (`list`, `jump`), and pure payload types |
| `packages/extensions/tool-session-tree/` | Model-facing surface: the `session_tree` tool, the `/tree`, `/fork`, `/clone`, `/session` commands, and the system-prompt section |
| `packages/client/ui-session-tree/` | Browser half: the native right-details-sidebar tree panel (light/dark via `--dsw-alias-*` tokens) |
| `docs/subsystems/session-tree.md` | Subsystem reference (en/zh) |
| `harness.patch` | Latest-Harness integration only (bundle composition/dependencies, tsconfig registrations, lockfile importers); package sources are copied separately |

## Semantics

- **Append-only** — every node is immutable; branching and jumping only move
  the cursor. Old branches are never edited or deleted.
- **Every entry is a node** — messages, tool calls, tool results, model
  switches, compaction records, branch summaries, and custom entries all
  become typed nodes (`message`, `tool_call`, `tool_result`, `model_change`,
  `compaction`, `branch_summary`, `custom`); each has a unique `nodeId` and a
  `parentId` (root is `null`). A node may have multiple children — that is the
  fork.
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

## Install into a DeepSeek-Harness checkout

```sh
./install.sh /path/to/deepseek-harness
```

The script copies the three packages into the checkout, applies `harness.patch`
to the harness working tree, and refreshes the lockfile. See
[INSTALL.md](INSTALL.md) for the manual steps and the composition rows it adds.

## Quick start

```sh
cd /path/to/deepseek-harness
pnpm install
pnpm run build        # regenerate Typert contracts + client bundles
pnpm run dev:web      # or the profile's usual run command
```

Type `/tree` in the composer to open or refresh the right sidebar. Click any
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

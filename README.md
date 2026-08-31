# dsh-session-tree-extension

Append-only, multi-branch conversation trees for
[DeepSeek-Harness](https://github.com/deepseek-ai/deepseek-harness) — a
PI-Agent-style SessionTree. The agent's history becomes a tree of immutable
nodes, forkable at any historical node, with standard LLM message
reconstruction, versioned JSON snapshots, and a WebUI tree panel embedded in
the existing chat composer (no standalone page).

## What is here

| Path | Role |
|---|---|
| `packages/extensions/pi-agent-session-tree/` | Host domain service: `SessionTree`/`SessionTreeStore`, the Typert `sessionTree` Remote (`list`, `jump`), and pure payload types |
| `packages/extensions/tool-session-tree/` | Model-facing surface: the `session_tree` tool, the `/tree` command family, and the system-prompt section |
| `packages/client/ui-session-tree/` | Browser half: the `conversation.input.dock` tree panel (light/dark via `--dsw-alias-*` tokens) |
| `docs/subsystems/session-tree.md` | Subsystem reference (en/zh) |
| `harness.patch` | Latest-Harness integration only (bundle composition/dependencies, tsconfig registrations, lockfile importers); package sources are copied separately |

## Semantics

- **Append-only** — every node is immutable; branching and jumping only move
  the cursor. Old branches are never edited or deleted.
- **Cursor navigation** — `jump(nodeId)` selects the same root-to-node path on
  Harness' actual model-visible message surface and leaves every sibling branch
  intact; the next turn grows from that historical leaf.
- **LLM context** — `context` returns the standard `messages` array for the
  root→cursor path only.
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

Type `/tree` in the composer, then:

```
/tree list
/tree context
/tree branch <nodeId> <name>
/tree jump <nodeId>
/tree snapshot save
```

The dock panel above the composer renders every branch, highlights the cursor,
and jumps on node click.

## License

MIT.

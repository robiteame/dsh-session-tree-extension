# ui-session-tree

English | [中文](README.zh.md)

Browser half of the session-tree plugin. In a patched source checkout it
occupies the native `conversation.details.panel` seat in DeepSeek Harness'
right details sidebar; in an official unmodified Web profile it uses the
additive `shell.overlay` seat so the shipped Tool-details surface remains
available. The tree stays in the sidebar; the latest-prompt editor uses the
native composer extension slots and creates no standalone page.

- `/tree` opens or refreshes the right sidebar.
- **Edit latest prompt** beside the composer stops the current run before
  opening an editor above the composer. **Resend** starts a corrected child
  branch with the prior history and original attachments. Cancel leaves the
  source stopped. Ctrl/Cmd+Enter resends; normal Enter inserts a newline.
  Both desktop and browser use the same additive `conversation.input.right`
  and `conversation.input.dock` slots, preserving the ordinary composer draft.
  A newer prompt still waiting in the queue is edited through the native
  queue controls; the plugin reports this case instead of editing an older turn.
- `/fork` shows only user-prompt nodes and, once one is chosen, opens an
  independent session copy under the current project. Its inline branch title
  is the user message immediately before the selected node; `/clone` duplicates
  the whole current conversation into a new same-project session without
  requiring a selected node.
- The production panel merges every non-subagent Session in the current
  lineage into one graph. Session topology comes from the reactive native
  Session list, while node topology comes from a read-only, debounced fan-out
  of `sessionTree.list`. Native fork/clone prefixes are deduplicated only when
  both `nodeId` and `sessionEventSeq` match; branch-specific nodes keep
  session-qualified identities.
- Fork points carry main/fork/clone badges and optional branch names. The open
  Session and its path stay highlighted, clicking another Session's node opens
  that Session before jumping, and Session branches or node subtrees collapse
  independently. A failed Session load becomes a local placeholder and does
  not break the rest of the graph.
- A fixed 44px, five-lane graph gutter draws vertical rails and curved branch
  connectors in an IDEA Git-log style. Lanes are bounded and reused; tree depth
  never becomes CSS margin or padding, so horizontal width is bounded.
- Branch heads, role, branch name, summary, refresh, close, and one-click fork
  use native `--dsw-alias-*` design tokens in light and dark themes.

## Inline fork branch menu

After `/fork` creates a child session, a second additive `shell.overlay` entry
(`session-tree-branches`) portals a collapsible menu directly after the source
Session's native list row. This is the left-side session-list menu; it is
separate from the merged graph in the right details panel. Forked children
appear inside that menu with connector rails, elbow joints, and per-level
expand/collapse controls. The child title is the user message immediately
preceding the selected node. The menu opens when a fork lands and follows the
reactive Session list, so new branches appear without a browser refresh.

Each fork row has a delete button on hosts with `uiWorkspace.archiveSession`.
It removes the session from the list using native archiving, preserving its
history and fork annotations for restoration. Surviving child forks remain
visible under the nearest unarchived ancestor; restoring the parent restores
their nesting. Pending removals disable repeat clicks, and failed removals
show an inline error and allow retry.

Presentation-only by construction: the fork data and parent linkage come
from the host, and the menu derives its cascade from the reactive Session list.
Completed prefixes use `ctx.sessions.fork`; before the first completed turn,
`sessionTree.forkSession(..., fromStart: true)` creates an empty child with
the same project and parent. The selected prompt is placed in its composer
without sending it.
While a child is represented inline, its native list row is hidden and restored
when the menu unmounts. A small UI-layer lineage registry (`fork-lineage.ts`,
persisted to
`localStorage`) only marks which children came from `/fork` — so `/clone`
sessions and ordinary sessions never enter the menu and keep their original
sidebar presentation. The `sidebar` slot itself stays untouched: it is
single-occupant (replacing it would remove the shipped workspace and settings
seats), so the additive `shell.overlay` entry is the seat for inline rendering.

## Composition

```yaml
- id: ui-session-tree
  name: '@robiteame/dsh-client-ui-session-tree'
```

The official standalone Bundle already supplies both Host services and this
browser package. A patched source checkout additionally requires the two Host
packages and the `conversation.details.panel` integration from
`dev/harness.patch`.

## Model Experience

This is presentation-only. It reads and navigates the shared SessionTree; no
panel content enters model context or changes KV-cache prefixes.

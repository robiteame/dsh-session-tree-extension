# ui-session-tree

English | [中文](README.zh.md)

Browser half of the session-tree plugin. In a patched source checkout it
occupies the native `conversation.details.panel` seat in DeepSeek Harness'
right details sidebar; in an official unmodified Web profile it uses the
additive `shell.overlay` seat so the shipped Tool-details surface remains
available. It never renders above the composer and creates no standalone page.

- `/tree` opens or refreshes the right sidebar.
- `/fork` shows only user-prompt nodes and, once one is chosen, opens an
  independent session copy under the current project. Its inline branch title
  is the user message immediately before the selected node; `/clone` duplicates
  the whole current conversation into a new same-project session without
  requiring a selected node.
- A fixed 44px, three-lane graph gutter draws vertical rails and curved branch
  connectors in an IDEA Git-log style. Tree depth never becomes CSS margin or
  padding, so horizontal width is bounded.
- Branch heads, role, branch name, summary, refresh, close, and one-click fork
  use native `--dsw-alias-*` design tokens in light and dark themes.

## Inline fork branch menu

After `/fork` creates a child session, a second additive `shell.overlay` entry
(`session-tree-branches`) portals a collapsible menu directly after the source
Session's native list row. Forked children appear inside that menu with
connector rails, elbow joints, and per-level expand/collapse controls. The
child title is the user message immediately preceding the selected node. The
menu opens when a fork lands and follows the reactive Session list, so new
branches appear without a browser refresh.

Presentation-only by construction: the fork data and the parent linkage come
from the official native fork API (`ctx.sessions.fork` writes each child with
`parentId`), and the menu derives its cascade purely from that reactive list.
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

# ui-session-tree

English | [中文](README.zh.md)

Browser half of the session-tree plugin. In a patched source checkout it
occupies the native `conversation.details.panel` seat in DeepSeek Harness'
right details sidebar; in an official unmodified Web profile it uses the
additive `shell.overlay` seat so the shipped Tool-details surface remains
available. It never renders above the composer and creates no standalone page.

- `/tree` opens or refreshes the right sidebar.
- Clicking a node binds that exact node as the active `/fork` and `/clone`
  context and shows a clear selected-state highlight.
- A fixed 44px, three-lane graph gutter draws vertical rails and curved branch
  connectors in an IDEA Git-log style. Tree depth never becomes CSS margin or
  padding, so horizontal width is bounded.
- Branch heads, role, branch name, summary, refresh, close, and one-click fork
  use native `--dsw-alias-*` design tokens in light and dark themes.

## Composition

```yaml
- id: ui-session-tree
  name: '@deepseek-ai/dsh-client-ui-session-tree'
```

The official standalone Bundle already supplies both Host services and this
browser package. A patched source checkout additionally requires the two Host
packages and the `conversation.details.panel` integration from
`harness.patch`.

## Model Experience

This is presentation-only. It reads and navigates the shared SessionTree; no
panel content enters model context or changes KV-cache prefixes.

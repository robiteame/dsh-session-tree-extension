# ui-session-tree

English | [中文](README.zh.md)

Browser half of the session-tree plugin: an embedded `conversation.input.dock`
panel that renders the agent's conversation tree above the composer — no
standalone page. The panel:

- reads the live tree through the generated `sessionTree` Remote service (the
  same process-wide store the `session_tree` tool and `/tree` command write),
- auto-expands when the composer draft starts with `/tree`,
- renders every node grouped by branch, highlighting the cursor,
- jumps the tree cursor on node click and refreshes.

Both light and dark themes come for free: the panel styles use the platform
`--dsw-alias-*` design tokens (`--dsw-alias-border-l1`,
`--dsw-alias-label-primary`, `--dsw-alias-interactive-bg-hover`,
`--dsw-alias-state-business-primary`, ...), so it follows the host theme with
no theme-specific code.

## Composition

Add the row to the web-app composition's client roster (the web-app patch
already carries it):

```yaml
- id: ui-session-tree
  name: '@deepseek-ai/dsh-client-ui-session-tree'
```

The host half (`@deepseek-ai/dsh-pi-agent-session-tree`) must be composed on
the host roster for the Remote service to exist.

## Model Experience

### Model-facing surface

#### What the model sees

The browser panel is a presentation surface over the `sessionTree` Remote service: it renders tree state and jumps the cursor on node click. It registers no prompt, schema, or model-visible result.

#### Token effect

None — nothing this plugin renders enters model context.

#### KV Cache effect

None — nothing from this plugin joins the model request prefix.

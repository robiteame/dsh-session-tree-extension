# pi_agent_session_tree

English | [中文](README.zh.md)

Append-only multi-branch conversation trees for DeepSeek-Harness: the agent's
sole conversation history is a tree keyed by agent session, forkable at any
historical node, with standard LLM message reconstruction, JSON snapshots, and
an embedded WebUI tree panel.

## Surface

| Surface | Name | Notes |
|---|---|---|
| Tool | `session_tree` | one tree per agent session; operations below |
| Command | `/tree` | `list`, `branches`, `tree`, `context`, `jump <nodeId>`, `branch <nodeId> <name>`, `snapshot save`, `snapshot load <json>` |
| Remote service | `sessionTree` | `list(agent)`, `jump(agent, nodeId)` — drives the browser panel |
| Browser slot | `conversation.input.dock` | collapsible tree panel above the composer; click a node to jump |

## Tool operations

`create`, `append`, `list`, `branches`, `tree`, `jump`, `context`, `branch`,
`branch.summary`, `snapshot.save`, `snapshot.load`, `sessions`.

- `context` returns `{cursor, messages}` where `messages` is the standard LLM
  messages array for the root→cursor path.
- `branch` parks the cursor at an existing node and names the next append's
  branch; `branch.summary` additionally appends a summary node. Historical
  nodes are never modified or deleted.
- `snapshot.save` returns the versioned tree snapshot; `snapshot.load` restores
  it under the same sessionId (see `SESSION_FORMAT_VERSION`-style versioning:
  `version: 1`).

Every operation answers `{ok: true, value}` or `{ok: false, error: {code, message}}`
with codes `INVALID_ARGUMENT` | `SESSION_NOT_FOUND` | `NODE_NOT_FOUND` |
`INVALID_SNAPSHOT`, so tool and Remote results are always lossless JSON.

## Tool examples

```json
{"operation":"create","sessionId":"demo"}
{"operation":"append","sessionId":"demo","message":{"role":"user","content":"Explore option A"}}
{"operation":"append","sessionId":"demo","message":{"role":"assistant","content":"Baseline answer"}}
{"operation":"branch","sessionId":"demo","nodeId":"<root-nodeId>","branch":"option-b"}
{"operation":"append","sessionId":"demo","message":{"role":"user","content":"Explore option B"},"branch":"option-b"}
{"operation":"context","sessionId":"demo"}
{"operation":"snapshot.save","sessionId":"demo"}
{"operation":"snapshot.load","sessionId":"demo","snapshot":{"version":1,"sessionId":"demo","cursor":null,"activeBranch":"main","nodes":[]}}
```

## Composition

Add the host row to the active Cordis composition (the web-app patch already
carries it):

```yaml
- id: pi-agent-session-tree
  name: '@deepseek-ai/dsh-pi-agent-session-tree'
```

The browser panel ships as `@deepseek-ai/dsh-client-ui-session-tree`
(`conversation.input.dock`; it expands when the composer draft starts with
`/tree` and jumps on node click). See `SYSTEM_PROMPT.md` for the system-prompt
fragment this plugin installs.

## Implementation notes

- The store is process-wide and shared by the tool, the command, and the
  Remote service, so model appends appear in the panel immediately.
- Trees are in-memory; `snapshot.save`/`snapshot.load` are the durability
  channel. This package owns no session-log events — the tree is an additive
  overlay, never a rewrite of native chat history.
- Model-visible ⇔ logged: every model turn the agent commits through
  `session_tree append` becomes a tree node; the tree does not synthesize
  history that was never logged.

## Model Experience

### Model-facing surface

#### What the model sees

The domain service registers no prompt, schema, or result of its own: the model-facing surface is entirely owned by `@deepseek-ai/dsh-tool-session-tree` (tool, `/tree` command, system-prompt section). The Remote methods this package exposes serve the browser panel only and never enter model context.

#### Token effect

None — this package contributes no model-visible text.

#### KV Cache effect

None — nothing from this package joins the model request prefix.

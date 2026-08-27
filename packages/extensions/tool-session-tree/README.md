# tool-session-tree

English | [中文](README.zh.md)

Model-facing companion of the session-tree service: the `session_tree` tool,
the `/tree` command family, and a system-prompt section over the shared
append-only session-tree store. All state lives in
`sessionTreeStore` (`@deepseek-ai/dsh-pi-agent-session-tree`), so the model,
the command line, and the browser panel observe the same trees.

## Surfaces

| Surface | Name | Notes |
|---|---|---|
| Tool | `session_tree` | one tree per agent session; operations below |
| Command | `/tree` | `list`, `branches`, `tree`, `context`, `jump <nodeId>`, `branch <nodeId> <name>`, `snapshot save`, `snapshot load <json>` |

## Tool operations

`create`, `append`, `list`, `branches`, `tree`, `jump`, `context`, `branch`,
`branch.summary`, `snapshot.save`, `snapshot.load`, `sessions`.

- `context` returns `{cursor, messages}` — the standard LLM messages array for
  the root→cursor path.
- `branch` parks the cursor at an existing node and names the next append's
  branch; `branch.summary` additionally appends a summary node. Historical
  nodes are never modified or deleted.
- `snapshot.save` returns the versioned snapshot; `snapshot.load` restores it
  under the same sessionId (`version: 1`).

Every operation answers `{ok: true, value}` or
`{ok: false, error: {code, message}}`, so tool results are always lossless
JSON with a stable failure vocabulary.

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

## Model Experience

### System prompt

#### What the model sees

A fixed section tells the model that the tree is the sole conversation history: read `context` before answering, append every turn, branch from historical nodes without editing them, and use snapshots for durability.
##### SessionTree guidance

```markdown
SessionTree is the sole conversation history for this agent. Before answering, call session_tree with operation 'context' for your active session and treat its returned messages as the complete context; never assume a linear chat history. Append every user and assistant turn with operation 'append'. To explore an alternative, call 'branch' with a historical nodeId and a branch name (or 'branch.summary' to record a summary of the abandoned path), then append new messages; never modify or delete historical nodes. Use 'branches' and 'tree' to enumerate the conversation tree, and 'snapshot.save'/'snapshot.load' to export or restore the whole tree as JSON. All operations report failures as {ok:false,error:{code,message}}.
```

#### Token effect

Small fixed input cost on every request where this plugin's prompt registration is in scope, plus the returned JSON for each `context` call.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged. The `context` result is dynamic output and never joins the reusable prefix.

### Tool schemas and results

#### What the model sees

The generated [`session_tree` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-session-tree) (one `operation` discriminant plus JSON payload fields). Successful results are compact JSON envelopes; a failed operation returns `{ok: false, error: {code, message}}` instead of throwing.

#### Token effect

Fixed schema cost plus one compact result per call.

#### KV Cache effect

Schemas are prefix-stable while their definitions and visibility are unchanged. Calls and results append after the reusable request prefix.

## Known Limitations and Deferred Work

- **Trees are in-memory** — history survives only via
  `snapshot.save`/`snapshot.load`; no session-log event stream backs the tree.
- **The store is process-wide** — a restarted process starts empty unless a
  snapshot is restored.

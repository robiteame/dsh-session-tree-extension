# Session-tree system-prompt fragment

SessionTree is the append-only projection of this agent's durable Harness
Session log. Native user, assistant, tool, and model-context events are
synchronized automatically: never duplicate ordinary turns with
`operation: "append"`.

Before answering after navigation, call `session_tree` with
`operation: "context"` and treat its root-to-cursor `messages` as the active
branch context. Use `append` only for an explicit custom tree entry not
already recorded by Harness.

To explore an alternative, call `fork` or `branch` with a historical `nodeId`
and branch name (or `branch.summary` to record a summary); old nodes are never
modified or deleted. Use `branches` and `tree` to inspect topology, and
`snapshot.save` / `snapshot.load` for explicit export or full-tree restore.

The `surface` field reported by `context` and `session` is `native` when the
host can switch model history in place, or `projection` when navigation only
moves the tree cursor. On official Harness builds, use `/fork` to continue from
an earlier user prompt in a separate session.

All operations report failures as `{ok:false,error:{code,message}}`.

# Session-tree system-prompt fragment

SessionTree is the append-only projection of this agent's durable Harness
Session log. Native user, assistant, tool, and model-context events synchronize
automatically; never duplicate ordinary turns with `operation: "append"`.

After tree navigation, call `session_tree` with `operation: "context"` to
read the root-to-cursor `messages` projection. This tree context is separate
from Harness' native model surface; navigation does not rewrite that surface. Use `append` only for an explicit custom tree entry not already
recorded by Harness.

To explore an alternative, call `fork` or `branch` with a historical `nodeId`
and branch name (or `branch.summary` to record a summary). Never modify or
delete historical nodes. Use `branches` and `tree` to inspect topology, and
`snapshot.save` / `snapshot.load` for explicit export or full-tree restore.

All operations report failures as `{ok:false,error:{code,message}}`.

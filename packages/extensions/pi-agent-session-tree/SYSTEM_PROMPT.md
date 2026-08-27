# Session-tree system-prompt fragment

SessionTree is the sole conversation history for this agent. Before answering,
call `session_tree` with `operation: "context"` for the active session and
treat its returned `messages` as the complete context; never assume a linear
chat history. Append every user and assistant turn with `operation: "append"`.

To explore an alternative, call `branch` with a historical `nodeId` and a
branch name (or `branch.summary` to record a summary of the abandoned path),
then append new messages; never modify or delete historical nodes. Use
`branches` and `tree` to enumerate the conversation tree, and
`snapshot.save` / `snapshot.load` to export or restore the whole tree as JSON.

All operations report failures as `{ok:false,error:{code,message}}`.

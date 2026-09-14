# Changelog

## 0.3.0 — 2026-09-14

### Changed

- The WebUI Session Tree now merges every non-subagent Session in the current
  lineage into one git-style graph. Native fork/clone prefixes are deduplicated
  by both `nodeId` and `sessionEventSeq`; branch-specific nodes keep
  session-qualified identities. Fork points carry main/fork/clone badges, the
  open Session's path is highlighted, Session branches and node subtrees can
  collapse independently, and clicking another Session's node opens that
  Session before jumping. Tree loading fans out after an 80 ms debounce and
  isolates per-Session failures behind placeholders. The previous separate
  right-panel branch summary is absorbed into this graph.
- Session-tree user messages now separate typed human prompts from
  harness-injected context (skill catalog prompts, system-prompt snapshots,
  context notices). Injected `user/message` events are still projected into the
  append-only tree — jump/fork re-select the model-visible surface from the
  tree path, so dropping them would strip skill and runtime context from later
  model turns — but they carry `metadata.injected` and are hidden from every
  user-facing surface: the `/tree` panel, the `/fork` prompt selector, the
  `/fork` `userNodeCount`, and the previous-prompt fork-menu title. Producer
  `source.kind` drives the split (`'user'` is typed input; `'plugin'`,
  `'skill-catalog'`, and other kinds are injected); legacy string or missing
  sources stay presented as human input. The sidecar format version bumped
  1 → 2 so cached trees built before the marker re-project from the native
  Session log.
- The `/tree` panel row preview expands on click (toggling the complete node
  message in a bounded scroll area) instead of on hover; the native hover
  title tooltip on the summary was removed and the row-count stat now counts
  only displayed (non-injected) nodes.
- The packages now target DeepSeek-Harness `0.1.5-rc.2`: the tree-restore
  cursor is written as a real `system/message` surface event, which needs the
  surface semantics introduced in the `0.1.5` line. The `@deepseek-ai/*` peer
  ranges moved from `^0.1.2-alpha.3` to `^0.1.5-rc.2` accordingly.

### Fixed

- The `/fork` prompt selector lists every typed prompt again instead of only
  the tree root. Prompts-only mode re-parents each user message to its nearest
  displayed prompt, so a prompt whose assistant/tool ancestor is filtered out
  no longer becomes unreachable in the row graph.

## 0.2.1 — 2026-09-10

### Fixed

- Compatibility with published Harness builds whose core `Session` class does
  not expose the agent-facing `events` array: the tree sync, fork seed,
  surface-seq, and canonical-surface walks now read the log through
  `snapshotEvents()` when `events` is absent. `/tree`, `/fork`, and `/clone`
  previously died in those hosts with
  `gateway/internal: Cannot read properties of undefined (reading 'at')`;
  they now run end-to-end there (verified against the packaged web profile).

## 0.2.0 — 2026-09-09

### Changed

- The WebUI `/fork` presentation moved from the left-docked branch rail to
  inline collapsible branch menus portaled directly beneath their source
  Session's native row. The native list keeps owning the source row; native
  rows for `/fork` descendants are hidden while `/clone` rows stay untouched.
  Topology and liveness still come exclusively from the official reactive
  Session list.
- Fork branch titles now derive from the user prompt preceding the selected
  node instead of the selected node's own text, so menu entries read as the
  turn the branch continues from.

### Added

- `previousUserPrompt` on sessionTree fork views and the typert remote
  payloads: the preceding user prompt carried alongside `prompt` for use as
  the inline fork-menu title.
- Repository CI (`.github/workflows/ci.yml`): Node 22/24 matrix running the
  full `pnpm verify` gate. Uses only Node-24-runtime actions
  (`actions/checkout@v5`, `actions/setup-node@v5`); Node-20 actions are
  deprecated on GitHub runners and fully removed after 2026-09-23. pnpm is
  activated through corepack and pinned via `packageManager` in the root
  `package.json`.

## 0.1.0 — 2026-09-07

First publishable release of the session-tree plugin as npm packages.

### Added

- Four npm packages under `@robiteame`: the `dsh-session-tree` carrier Bundle
  (composition layer mounting the three implementation packages) plus
  `dsh-pi-agent-session-tree`, `dsh-tool-session-tree`, and
  `dsh-client-ui-session-tree`, each shipping prebuilt `lib/` artifacts with
  semver peer ranges (DeepSeek-Harness `^0.1.2-alpha.3`, Cordis `^4.0.2`) and
  no lifecycle scripts.
- `sessionTreeSurfaceMode()` and the `surface` field on `session_tree`
  `context`/`session` operations and `/tree` outputs, reporting the active
  engine mode (`native`, `stock`, or `projection`).
- One-time Host-log notices for stock-surface and projection modes.
- Standalone build (`scripts/build.mjs`), typecheck (host + client passes),
  artifact verification (`scripts/verify-bundle.mjs`), and a vitest suite that
  runs against the published Harness packages without a checkout.

### Changed

- Renamed the packages from the `@deepseek-ai` development scope to
  `@robiteame` (typert contracts, composition rows, imports, and docs follow).
- The repository root became a private orchestrator; the previous root
  standalone bundle was replaced by the four-package carrier structure.
- `harness.patch` moved to `dev/` and was split: the optional
  `Session.selectMessageSurface()` engine capability now lives in
  `dev/session-branch-surface.patch`; composition/registration remains in
  `dev/harness.patch`; the installer moved to `dev/install.sh`.

### Fixed

- Cloning on a stock Harness dropped the clone's derived history: synthetic
  cursor events are no longer copied into the clone seed, and the store
  watermark is clamped for empty event logs.
- Repeated stock-surface cursor rewrites could leave a stored session that
  fails resume validation (`surface replace: start seq … not found`). Replace
  events are now computed against the canonical replayed surface, keeping the
  durable log resume-valid across unlimited navigations (regression-tested).
- Unwritable stock surfaces are detected before appending; such builds degrade
  to projection mode instead of leaving a truncated live path.

### Verified

- End-to-end on an unpatched Harness `0.1.2-alpha.3` checkout via tarball
  install: `/tree list|context|jump|fork`, `/fork`, `/clone`, `/session`,
  panel rendering with click-selection, light/dark themes, restart-safe
  branch state through the sidecar, and clean uninstall.
- Native branch switching (patched checkout): the model-visible history
  genuinely switches after jump/fork; full suite passes in both modes.

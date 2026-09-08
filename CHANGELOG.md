# Changelog

## Unreleased

### Added

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

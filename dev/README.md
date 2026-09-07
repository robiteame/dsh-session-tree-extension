# Development artifacts

Everything in this directory exists only for contributor workflows against a
[DeepSeek-Harness](https://github.com/deepseek-ai/deepseek-harness) source
checkout. None of it ships in the published npm packages.

## `session-branch-surface.patch` — optional engine capability

Adds two things to `packages/core/session`:

- `Session.selectMessageSurface(nodes)` / `Session.messageSurfaceNodes()` — the
  branch-selected message surface used for true in-place model-history
  switching, and
- the durable `session-tree/*` event vocabulary in the session
  known-event-types table.

**This patch is development-only.** The published packages never require it:
`@robiteame/dsh-pi-agent-session-tree` capability-detects the API at runtime
(`typeof session.selectMessageSurface === 'function'`). Without the patch the
plugin runs in stock-surface emulation mode on official builds (an official
empty `replace` surface event plus the plugin-owned sidecar; `/tree` outputs
report `surface: "stock"` and the Host log notes it once per session). With
the patch applied, jump/fork switch the model-visible history directly.

An upstream PR to merge this capability into DeepSeek-Harness is planned;
until it lands, apply the patch only in dev checkouts. *(upstream PR link:
TODO)*

## `harness.patch` — composition and registration

The remaining source-integration changes: `dsh-base`/`dsh-web-app` composition
rows and dependencies for the three packages, `tsconfig.base.json` paths,
host/client project references, catalog generator registrations, tool-catalog
documentation rows, and lockfile importers. Rows reference the
`@robiteame/*` package names; project references point at each package's
`tsconfig.harness.json`.

## `install.sh` — source-integration installer

```sh
dev/install.sh /path/to/deepseek-harness
ST_NO_SURFACE=1 dev/install.sh /path/to/deepseek-harness   # skip the engine patch
```

Applies both patches (order matters: surface patch first, on upstream files),
copies the three packages and the session-tree docs into the checkout, then
`pnpm install && pnpm run build` as usual. The catalog hash refresh in the
patch assumes stock `docs/tool-catalog.md`; if the harness translation-pairing
check complains after install, rerun
`pnpm run verify-translation-pairing --write docs/tool-catalog.md`.

The bundle/user install path is entirely separate — see the repository
README.

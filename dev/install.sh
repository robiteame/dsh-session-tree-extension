#!/bin/sh
# Developer source integration: install the session-tree packages into a
# DeepSeek-Harness checkout. User-facing installs go through the published
# @robiteame/dsh-session-tree carrier bundle instead (see the repository
# README); this script exists for hacking on the plugin against Harness
# source.
set -eu

TARGET=${1:-$(pwd)}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ ! -f "$TARGET/pnpm-workspace.yaml" ]; then
  printf 'error: %s is not a DeepSeek-Harness checkout (missing pnpm-workspace.yaml)\n' "$TARGET" >&2
  exit 1
fi

# Optional branch-surface engine patch: adds Session.selectMessageSurface()
# and the durable session-tree/* event vocabulary. Without it the plugin runs
# in stock-surface emulation mode (capability-detected at runtime). Skip with
# ST_NO_SURFACE=1.
if [ "${ST_NO_SURFACE:-0}" != "1" ] && (cd "$TARGET" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
  if (cd "$TARGET" && git apply --check "$ROOT/dev/session-branch-surface.patch" 2>/dev/null); then
    (cd "$TARGET" && git apply "$ROOT/dev/session-branch-surface.patch")
    printf '%s\n' "Applied dev/session-branch-surface.patch (native branch switching)."
  elif (cd "$TARGET" && git apply --reverse --check "$ROOT/dev/session-branch-surface.patch" 2>/dev/null); then
    printf '%s\n' "session-branch-surface.patch is already applied."
  else
    printf '%s\n' "error: dev/session-branch-surface.patch does not apply cleanly to this checkout" >&2
    exit 1
  fi
fi

# Composition, tsconfig registration, lockfile importers, and the optional
# native details-panel slot. Applied after the surface patch and to the same
# upstream files only; extension package sources are copied as new paths.
if (cd "$TARGET" && git apply --check "$ROOT/dev/harness.patch" 2>/dev/null); then
  (cd "$TARGET" && git apply "$ROOT/dev/harness.patch")
  printf '%s\n' "Applied dev/harness.patch (composition, tsconfig, and lockfile)."
elif (cd "$TARGET" && git apply --reverse --check "$ROOT/dev/harness.patch" 2>/dev/null); then
  printf '%s\n' "dev/harness.patch is already applied; refreshing extension package sources."
else
  printf '%s\n' "error: dev/harness.patch does not apply cleanly to this checkout" >&2
  exit 1
fi

mkdir -p "$TARGET/packages/extensions" "$TARGET/packages/client" "$TARGET/docs/subsystems"

cp -R "$ROOT/packages/extensions/pi-agent-session-tree" "$TARGET/packages/extensions/"
cp -R "$ROOT/packages/extensions/tool-session-tree"      "$TARGET/packages/extensions/"
cp -R "$ROOT/packages/client/ui-session-tree"            "$TARGET/packages/client/"
cp "$ROOT/docs/subsystems/session-tree.md"        "$TARGET/docs/subsystems/"
cp "$ROOT/docs/subsystems/session-tree.zh.md"     "$TARGET/docs/subsystems/"
cp "$ROOT/docs/subsystems/session-tree.i18n.yaml" "$TARGET/docs/subsystems/"
cp "$ROOT/docs/tool-catalog.md" "$TARGET/docs/"
cp "$ROOT/docs/tool-catalog.zh.md" "$TARGET/docs/" 2>/dev/null || true
cp "$ROOT/docs/tool-catalog.i18n.yaml" "$TARGET/docs/" 2>/dev/null || true

# Remove build residue from the copied packages so the harness rebuilds cleanly.
find "$TARGET/packages/extensions/pi-agent-session-tree" \
     "$TARGET/packages/extensions/tool-session-tree" \
     "$TARGET/packages/client/ui-session-tree" \
     -type d \( -name node_modules -o -name lib \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$TARGET/packages/extensions/pi-agent-session-tree" \
     "$TARGET/packages/extensions/tool-session-tree" \
     "$TARGET/packages/client/ui-session-tree" \
     -name '*.tsbuildinfo' -delete 2>/dev/null || true

printf '%s\n' "Installed packages at:"
printf '%s\n' "  $TARGET/packages/extensions/pi-agent-session-tree"
printf '%s\n' "  $TARGET/packages/extensions/tool-session-tree"
printf '%s\n' "  $TARGET/packages/client/ui-session-tree"

printf '%s\n' "Run 'pnpm install && pnpm run build' in $TARGET, then type /tree in the WebUI."
printf '%s\n' "Note: dev/harness.patch rewrites docs/tool-catalog content; if the harness"
printf '%s\n' "verify-translation-pairing check complains, rerun 'pnpm run verify-translation-pairing --write docs/tool-catalog.md'."

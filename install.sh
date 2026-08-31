#!/bin/sh
# Install dsh-session-tree-extension into a DeepSeek-Harness checkout.
set -eu

TARGET=${1:-$(pwd)}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ ! -f "$TARGET/pnpm-workspace.yaml" ]; then
  printf 'error: %s is not a DeepSeek-Harness checkout (missing pnpm-workspace.yaml)\n' "$TARGET" >&2
  exit 1
fi

# Apply harness-side integration first, while the checkout still contains the
# upstream files targeted by the patch. The extension packages copied below are
# new paths and must never be part of this patch; applying in the opposite order
# makes an idempotent reinstall report false conflicts.
if [ -f "$ROOT/harness.patch" ] && (cd "$TARGET" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
  if (cd "$TARGET" && git apply --check "$ROOT/harness.patch" 2>/dev/null); then
    (cd "$TARGET" && git apply "$ROOT/harness.patch")
    printf '%s\n' "Applied harness.patch (composition, tsconfig, and lockfile)."
  elif (cd "$TARGET" && git apply --reverse --check "$ROOT/harness.patch" 2>/dev/null); then
    printf '%s\n' "harness.patch is already applied; refreshing extension package sources."
  else
    printf '%s\n' "error: harness.patch does not apply cleanly to this checkout" >&2
    exit 1
  fi
fi

mkdir -p "$TARGET/packages/extensions" "$TARGET/packages/client" "$TARGET/docs/subsystems"

cp -R "$ROOT/packages/extensions/pi-agent-session-tree" "$TARGET/packages/extensions/"
cp -R "$ROOT/packages/extensions/tool-session-tree"      "$TARGET/packages/extensions/"
cp -R "$ROOT/packages/client/ui-session-tree"            "$TARGET/packages/client/"
cp "$ROOT/docs/subsystems/session-tree.md"        "$TARGET/docs/subsystems/"
cp "$ROOT/docs/subsystems/session-tree.zh.md"     "$TARGET/docs/subsystems/"
cp "$ROOT/docs/subsystems/session-tree.i18n.yaml" "$TARGET/docs/subsystems/"
cp "$ROOT/docs/tool-catalog.md" "$TARGET/docs/"

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

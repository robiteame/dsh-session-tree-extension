#!/bin/sh
# Install dsh-session-tree-extension into a DeepSeek-Harness checkout.
set -eu

TARGET=${1:-$(pwd)}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ ! -f "$TARGET/pnpm-workspace.yaml" ]; then
  printf 'error: %s is not a DeepSeek-Harness checkout (missing pnpm-workspace.yaml)\n' "$TARGET" >&2
  exit 1
fi

mkdir -p "$TARGET/packages/extensions" "$TARGET/packages/client" "$TARGET/docs/subsystems"

cp -R "$ROOT/packages/extensions/pi-agent-session-tree" "$TARGET/packages/extensions/"
cp -R "$ROOT/packages/extensions/tool-session-tree"      "$TARGET/packages/extensions/"
cp -R "$ROOT/packages/client/ui-session-tree"            "$TARGET/packages/client/"
cp "$ROOT/docs/subsystems/session-tree.md"        "$TARGET/docs/subsystems/"
cp "$ROOT/docs/subsystems/session-tree.zh.md"     "$TARGET/docs/subsystems/"
cp "$ROOT/docs/subsystems/session-tree.i18n.yaml" "$TARGET/docs/subsystems/"

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

if [ -f "$ROOT/harness.patch" ]; then
  if (cd "$TARGET" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
    if (cd "$TARGET" && git apply --check "$ROOT/harness.patch" 2>/dev/null); then
      (cd "$TARGET" && git apply "$ROOT/harness.patch")
      printf '%s\n' "Applied harness.patch (composition, tsconfig, remotes, catalogs)."
    else
      printf '%s\n' "harness.patch did not apply cleanly; apply it manually (see INSTALL.md)." >&2
    fi
  else
    printf '%s\n' "Not a git checkout; apply harness.patch manually (see INSTALL.md)." >&2
  fi
fi

printf '%s\n' "Run 'pnpm install && pnpm run build' in $TARGET, then type /tree in the WebUI."

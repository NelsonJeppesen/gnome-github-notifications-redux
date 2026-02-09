#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="github-notifications-redux@jeppesen.io"
DEST="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

echo "Installing ${UUID} to ${DEST} ..."

mkdir -p "${DEST}/schemas"

cp "${SCRIPT_DIR}/metadata.json" \
  "${SCRIPT_DIR}/extension.js" \
  "${SCRIPT_DIR}/prefs.js" \
  "${SCRIPT_DIR}/stylesheet.css" \
  "${SCRIPT_DIR}/github-symbolic.svg" \
  "${DEST}/"
cp "${SCRIPT_DIR}"/schemas/*.xml "${DEST}/schemas/"

# Compile schemas -- try glib-compile-schemas from PATH or fall back to nix
if command -v glib-compile-schemas &>/dev/null; then
  glib-compile-schemas "${DEST}/schemas/"
elif command -v nix-shell &>/dev/null; then
  nix-shell -p glib.dev --run "glib-compile-schemas '${DEST}/schemas/'"
else
  echo "ERROR: glib-compile-schemas not found. Install glib development tools." >&2
  exit 1
fi

echo "Done. Restart GNOME Shell and enable the extension:"
echo "  gnome-extensions enable ${UUID}"

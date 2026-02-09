#!/usr/bin/env bash
# install.sh — GitHub Notifications Redux
#
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Quick local installer for development.  Copies the extension files into
# the per-user GNOME Shell extensions directory and compiles GSettings
# schemas so the extension can be enabled immediately.
#
# Usage:
#   bash install.sh
#
# After running, restart GNOME Shell (or log out / log in on Wayland) and:
#   gnome-extensions enable github-notifications-redux@jeppesen.io

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="github-notifications-redux@jeppesen.io"
DEST="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

echo "Installing ${UUID} to ${DEST} ..."

mkdir -p "${DEST}/schemas"

# Copy core extension files
cp "${SCRIPT_DIR}/metadata.json" \
  "${SCRIPT_DIR}/extension.js" \
  "${SCRIPT_DIR}/prefs.js" \
  "${SCRIPT_DIR}/stylesheet.css" \
  "${SCRIPT_DIR}/github-symbolic.svg" \
  "${DEST}/"

# Copy GSettings schema XML
cp "${SCRIPT_DIR}"/schemas/*.xml "${DEST}/schemas/"

# Compile GSettings schemas — try PATH first, then fall back to nix-shell
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

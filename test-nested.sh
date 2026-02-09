#!/usr/bin/env bash
# test-nested.sh — GitHub Notifications Redux
#
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Launch a nested GNOME Shell session (1000x1000 virtual monitor) with this
# extension installed and enabled.  Useful for quick manual testing without
# restarting your real desktop.
#
# A private D-Bus session is used so the nested shell does not collide with
# the running desktop's GNOME Shell instance.
#
# Usage:
#   bash test-nested.sh          # install + launch nested session
#   bash test-nested.sh --prefs  # same, then also open the prefs dialog

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="github-notifications-redux@jeppesen.io"
DEST="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

# ── 1. Install the extension locally ─────────────────────────────────────────
echo "==> Installing extension to ${DEST} ..."
bash "${SCRIPT_DIR}/install.sh"

# ── 2. Determine a free Wayland display name ─────────────────────────────────
NESTED_DISPLAY="wayland-test-$$"

# ── 3. Launch nested GNOME Shell ─────────────────────────────────────────────
echo "==> Starting nested GNOME Shell (1000x1000) on ${NESTED_DISPLAY} ..."
echo "    Close the window or press Ctrl-C to stop."
echo ""

# Run inside a private D-Bus session so dconf/gsettings writes don't affect
# the real desktop.  --headless avoids claiming the logind session.
dbus-run-session -- bash -c '
    UUID="'"${UUID}"'"
    NESTED_DISPLAY="'"${NESTED_DISPLAY}"'"

    # Enable the extension inside the nested session private dconf
    gsettings set org.gnome.shell enabled-extensions "['"'"'${UUID}'"'"']"
    gsettings set org.gnome.shell disable-user-extensions false

    gnome-shell --headless                           \
                --wayland-display="${NESTED_DISPLAY}" \
                --virtual-monitor 1000x1000          \
                --force-animations                   &
    SHELL_PID=$!

    # Give gnome-shell a moment to initialise
    sleep 3

    # If --prefs was passed, open the preferences dialog in the nested session
    if [[ "${1:-}" == "--prefs" ]]; then
        echo "==> Opening extension preferences ..."
        WAYLAND_DISPLAY="${NESTED_DISPLAY}" gnome-extensions prefs "${UUID}" &
    fi

    wait $SHELL_PID
' -- "${1:-}"

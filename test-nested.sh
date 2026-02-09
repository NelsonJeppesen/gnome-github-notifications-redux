#!/usr/bin/env bash
# Launch a nested GNOME Shell session (1000x1000) with this extension installed
# and enabled.  Useful for quick manual testing without restarting your desktop.
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

# We need a private D-Bus session so the nested shell doesn't collide with the
# running desktop's GNOME Shell.  Use --headless so it doesn't try to claim
# the logind session (which is already owned by the real desktop).
dbus-run-session -- bash -c '
    UUID="'"${UUID}"'"
    NESTED_DISPLAY="'"${NESTED_DISPLAY}"'"

    # Enable the extension in the nested session private dconf
    gsettings set org.gnome.shell enabled-extensions "['"'"'${UUID}'"'"']"
    gsettings set org.gnome.shell disable-user-extensions false

    gnome-shell --headless                          \
                --wayland-display="${NESTED_DISPLAY}" \
                --virtual-monitor 1000x1000         \
                --force-animations                  &
    SHELL_PID=$!

    # Give gnome-shell a moment to start up
    sleep 3

    # If --prefs was passed, open the preferences dialog inside the nested session
    if [[ "${1:-}" == "--prefs" ]]; then
        echo "==> Opening extension preferences ..."
        WAYLAND_DISPLAY="${NESTED_DISPLAY}" gnome-extensions prefs "${UUID}" &
    fi

    wait $SHELL_PID
' -- "${1:-}"

# Changelog

All notable changes to GitHub Notifications Redux are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-02-19

### Added

- "Group Notifications By" option in Appearance preferences with four modes:
  None (flat list, default), Repository, Type (PR/Issue/Commit/Release), and
  Reason (mention, review requested, subscribed, etc.). When grouping is active,
  the popup menu displays section headers with a count badge followed by the
  notifications in that group.

### Changed

- Extension metadata version bumped to 2.

## [1.0.2] - 2026-02-11

### Fixed

- Desktop notifications never showing — `notification.setTransient(true)` threw
  a TypeError (no such method in GNOME Shell 49's MessageTray API), which was
  silently caught before `addNotification()` could run. Replaced with the
  correct GObject property setter `notification.isTransient = true`.
- Release notification URLs opening as 404 — the GitHub API returns a numeric
  release ID (`/releases/12345`) that doesn't work in the browser. Now fetches
  the release details to resolve the correct tag-based URL
  (`/releases/tag/v1.2.3`), with a fallback to the repo's releases page.

## [1.0.1] - 2026-02-10

### Fixed

- Auto-refresh returning fewer notifications than manual "Refresh Now" — stopped
  sending `If-Modified-Since` on polling requests so every fetch gets the full
  unread notification list instead of a potentially stale 304 Not Modified.

## [1.0.0] - 2026-02-09

First release targeting GNOME Shell 49, fully compliant with
[GNOME Extensions Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).

### Added

- Notification count indicator in the top panel with configurable refresh
  interval (15 s – 5 min).
- Inline notification list in the popup menu showing repository name, subject
  title, type icon, open-in-browser button, and mark-as-read button (up to 25
  items with overflow indicator).
- Desktop alert notifications for new unread items (optional).
- GitHub Enterprise support — auto-detects `api.github.com` vs
  `DOMAIN/api/v3` based on configured domain.
- Preferences window with two pages:
  - **Authentication** — token, domain, and a "Test Connection" button that
    verifies the token and displays status, rate limit, and OAuth scopes.
  - **Behavior** — refresh interval, auto-hide indicator, hide count, show
    alert toggle.
- Nix flake with `nix build` (produces installable zip), `nix develop` (dev
  shell), and `nix run .#test-nested` (nested GNOME Shell session).
- `install.sh` script for manual installation.
- `test-nested.sh` script for launching a nested GNOME Shell session
  (`--prefs` flag opens preferences directly).
- Comprehensive `README.md` with project structure, installation methods,
  configuration guide, and contributing link.
- `CONTRIBUTING.md` with development setup, code style, review guidelines
  summary, and PR workflow.

### Fixed

- Unhandled promise rejection when opening preferences from the popup menu
  (`openPreferences()` is async in GNOME Shell 49).
- Appearance settings (auto-hide indicator, hide count) not taking effect until
  the next API poll — `_updateVisibility()` is now called immediately on
  settings change.
- Unnecessary HTTP session recreation on every settings change — `_initHttp()`
  is now only called when the domain or token changes.
- Excessive `console.log` calls removed (only `console.error` on actual errors).
- `GLib.source_remove()` replaced with `GLib.Source.remove()`.
- Broken gettext `_()` calls that used template literals with dynamic values —
  split into static translatable strings.
- GitHub Enterprise notification URL resolution that only stripped an `api.`
  prefix — now correctly strips `/api/v3/repos/`.
- Duplicate HTTP status code checks (literal `205` alongside
  `Soup.Status.RESET_CONTENT`).
- Missing null guard on `bytes.get_data()` before `TextDecoder.decode()`.
- `_notifSection` and `_label` not nulled in `disable()`.

### Removed

- Unused `handle` GSettings key (was in schema and prefs UI but never
  referenced in extension logic).
- MIT license — replaced with GPL-3.0-or-later to meet GNOME review
  requirements.

### Changed

- License changed from MIT to GPL-3.0-or-later.
- SPDX-License-Identifier headers added to all source files.
- Magic values extracted into documented constants (`MAX_MENU_ITEMS`,
  `TYPE_ICONS`, `RETRY_INTERVALS`, `DEFAULT_ICON`).
- `prefs.js` refactored from a monolithic `fillPreferencesWindow` into named
  builder methods (`_buildAuthPage`, `_buildTestRow`, `_runConnectionTest`,
  `_buildBehaviorPage`).
- Comprehensive JSDoc and inline comments added to all files.

[1.1.0]: https://github.com/NelsonJeppesen/gnome-github-notifications-redux/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/NelsonJeppesen/gnome-github-notifications-redux/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/NelsonJeppesen/gnome-github-notifications-redux/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/NelsonJeppesen/gnome-github-notifications-redux/releases/tag/v1.0.0

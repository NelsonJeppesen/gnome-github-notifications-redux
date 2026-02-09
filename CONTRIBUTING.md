# Contributing to GitHub Notifications Redux

Thank you for your interest in contributing!

## Development Setup

1. **Clone the repository**

   ```sh
   git clone https://github.com/NelsonJeppesen/gnome-github-notifications-redux.git
   cd gnome-github-notifications-redux
   ```

2. **Enter the Nix dev shell** (recommended)

   ```sh
   nix develop
   ```

   This provides `glib-compile-schemas`, `gjs`, `jq`, `xmllint`, and
   `nodejs` for validation.

3. **Install locally for testing**

   ```sh
   bash install.sh
   ```

4. **Test in a nested session** (no desktop restart needed)

   ```sh
   bash test-nested.sh
   bash test-nested.sh --prefs   # also opens the preferences dialog
   ```

## Code Style

- Use ES6+ features: `class`, `async`/`await`, `const`/`let`, arrow functions
- Indent with 4 spaces
- Use `??` (nullish coalescing) instead of `||` where appropriate
- Follow the existing comment style (JSDoc for public methods, inline for
  non-obvious logic)

## GNOME Shell Extension Rules

This extension targets [extensions.gnome.org](https://extensions.gnome.org)
and must comply with the
[GNOME Shell Extensions Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).
Key rules:

| Rule | Summary |
|---|---|
| **No work before `enable()`** | Do not create objects, connect signals, or add main loop sources in the constructor or at import time. |
| **Clean up in `disable()`** | Destroy all widgets, disconnect all signals, remove all GLib sources, and null all references. |
| **No GTK in `extension.js`** | Never import `Gtk`, `Gdk`, or `Adw` in the GNOME Shell process. |
| **No Shell libs in `prefs.js`** | Never import `Clutter`, `Meta`, `St`, or `Shell` in the preferences process. |
| **No excessive logging** | Only log errors and truly important events. Remove debug `console.log` calls before submitting. |
| **`GLib.Source.remove()`** | Use `GLib.Source.remove()` (capital S) to remove main loop sources. |
| **GPL-compatible license** | Extensions must be distributed under GPL-2.0-or-later compatible terms. |

## Running Checks

```sh
nix flake check
```

This validates:

- GSettings schema compilation
- JavaScript syntax (Node.js `--check`)
- `metadata.json` structure and UUID
- SVG well-formedness

## Submitting Changes

1. Fork the repository and create a feature branch
2. Make your changes, ensuring all checks pass
3. Write clear commit messages
4. Open a pull request against `main`

## License

By contributing, you agree that your contributions will be licensed under the
[GPL-3.0-or-later](LICENSE).

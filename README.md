# gnome-github-notifications-redux

A GNOME Shell 49 extension that shows your GitHub notification count in the top panel.

Inspired by [gnome-github-notifications](https://github.com/alexduf/gnome-github-notifications), rewritten from scratch for modern GNOME using ESModules, Soup 3.0, and Adwaita preferences.

## Features

- GitHub notification count in the top panel
- Click to open notifications in your browser
- Mark all notifications as read from the menu
- Desktop notifications when new items arrive
- Configurable polling interval (respects GitHub's `X-Poll-Interval`)
- Participating-only filter
- Auto-hide indicator when inbox is empty
- GitHub Enterprise support
- Modern Adwaita preferences dialog

## Requirements

- GNOME Shell 49
- A GitHub personal access token with the `notifications` scope

## Install

### With Nix (recommended)

```sh
nix build
nix run .#install
```

### Manual

```sh
bash install.sh
```

Then restart GNOME Shell and enable:

```sh
gnome-extensions enable github-notifications-redux@jeppesen.io
```

## Development

Enter the dev shell:

```sh
nix develop
```

Run all checks (schema validation, JS syntax, metadata, SVG):

```sh
nix flake check
```

Build the extension package and `.zip`:

```sh
nix build
```

## Configuration

Right-click the GitHub icon in the panel, or run:

```sh
gnome-extensions prefs github-notifications-redux@jeppesen.io
```

You will need a GitHub personal access token. Generate one at
https://github.com/settings/tokens/new?scopes=notifications&description=GNOME+Notifications+Redux

## License

MIT

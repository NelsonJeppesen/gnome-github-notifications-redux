/*
 * prefs.js — GitHub Notifications Redux
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (c) 2026 Nelson Alex Jeppesen
 *
 * Preferences window for the extension, built with libadwaita widgets.
 * Runs in a separate GTK 4 process — never import Clutter/St/Shell here.
 *
 * Pages:
 *   1. Authentication — domain, personal access token, connection test
 *   2. Behavior       — refresh interval, desktop alerts, participating-only,
 *                        auto-hide indicator, hide count
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';
import Soup from 'gi://Soup?version=3.0';

import {ExtensionPreferences, gettext as _} from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export default class GitHubNotificationsPreferences extends ExtensionPreferences {
    /**
     * Populate the Adwaita preferences window with pages and rows.
     *
     * Called automatically by GNOME Shell when the user opens the extension
     * preferences dialog.
     *
     * @param {Adw.PreferencesWindow} window — the window to fill.
     */
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        this._buildAuthPage(window, settings);
        this._buildBehaviorPage(window, settings);
    }

    // ── Authentication Page ───────────────────────────────────────────────────

    /**
     * Build the "Authentication" preferences page.
     *
     * Contains the GitHub hostname entry, personal access token entry,
     * help text, and a connection test button.
     *
     * @param {Adw.PreferencesWindow} window
     * @param {Gio.Settings} settings
     */
    _buildAuthPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Authentication'),
            icon_name: 'dialog-password-symbolic',
        });
        window.add(page);

        /* ── Credentials group ────────────────────────────────────────── */
        const credGroup = new Adw.PreferencesGroup({
            title: _('GitHub Credentials'),
            description: _('Configure your GitHub access token'),
        });
        page.add(credGroup);

        /* Domain (most users leave this as github.com) */
        const domainRow = new Adw.EntryRow({
            title: _('GitHub Hostname'),
            show_apply_button: true,
        });
        settings.bind('domain', domainRow, 'text',
            Gio.SettingsBindFlags.DEFAULT);
        credGroup.add(domainRow);

        /* Personal access token (masked input) */
        const tokenRow = new Adw.PasswordEntryRow({
            title: _('Personal Access Token'),
            show_apply_button: true,
        });
        settings.bind('token', tokenRow, 'text',
            Gio.SettingsBindFlags.DEFAULT);
        credGroup.add(tokenRow);

        /* ── Help text group ──────────────────────────────────────────── */
        const helpGroup = new Adw.PreferencesGroup();
        page.add(helpGroup);

        helpGroup.add(new Adw.ActionRow({
            title: _('How to get a token'),
            subtitle: _(
                'Visit https://github.com/settings/tokens/new\n' +
                'Select only the "notifications" scope, then generate ' +
                'and paste above.\n' +
                'Only GitHub Enterprise users need to change the hostname.'),
            activatable: false,
        }));

        /* ── Connection test group ────────────────────────────────────── */
        this._buildTestRow(page, settings);
    }

    /**
     * Build the "Test Connection" row that verifies the token against the
     * GitHub API with a single lightweight request.
     *
     * @param {Adw.PreferencesPage} page
     * @param {Gio.Settings} settings
     */
    _buildTestRow(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Connection Test'),
        });
        page.add(group);

        const row = new Adw.ActionRow({
            title: _('Verify Credentials'),
            subtitle: _('Test your token against the GitHub API'),
        });

        /* Status label (updated after the test completes) */
        const statusLabel = new Gtk.Label({
            label: '',
            hexpand: true,
            xalign: 1,
            css_classes: ['dim-label'],
        });
        row.add_suffix(statusLabel);

        /* "Test" button */
        const btn = new Gtk.Button({
            label: _('Test'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        row.add_suffix(btn);
        row.set_activatable_widget(btn);

        btn.connect('clicked', () => {
            this._runConnectionTest(settings, statusLabel, btn);
        });

        group.add(row);
    }

    /**
     * Execute a lightweight API call to verify the configured credentials.
     *
     * Fetches a single notification (per_page=1) and inspects the HTTP
     * status to determine whether the token is valid.  Updates the status
     * label with the result.
     *
     * @param {Gio.Settings} settings
     * @param {Gtk.Label} statusLabel — label to show result text.
     * @param {Gtk.Button} btn — button to disable during the test.
     */
    _runConnectionTest(settings, statusLabel, btn) {
        const domain = settings.get_string('domain');
        const token = settings.get_string('token');

        if (!token) {
            statusLabel.label = _('No token set');
            statusLabel.css_classes = ['error'];
            return;
        }

        statusLabel.label = _('Testing\u2026');
        statusLabel.css_classes = ['dim-label'];
        btn.sensitive = false;

        const session = new Soup.Session({
            user_agent: 'gnome-github-notifications-redux',
        });

        /* Build URL the same way the main extension does */
        const base = domain === 'github.com'
            ? 'https://api.github.com'
            : `https://${domain}/api/v3`;
        const url = `${base}/notifications?per_page=1`;

        const message = Soup.Message.new('GET', url);
        message.get_request_headers().append(
            'Authorization', `Bearer ${token}`);
        message.get_request_headers().append(
            'Accept', 'application/vnd.github+json');

        session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, null,
            (_session, result) => {
                try {
                    session.send_and_read_finish(result);
                    const status = message.get_status();

                    if (status === Soup.Status.OK ||
                        status === Soup.Status.NOT_MODIFIED) {
                        const headers = message.get_response_headers();
                        const scopes =
                            headers.get_one('X-OAuth-Scopes') || '';
                        const remaining =
                            headers.get_one('X-RateLimit-Remaining') || '?';

                        /* Translators: shown after a successful connection
                           test; %s1 = remaining rate limit, %s2 = scopes */
                        statusLabel.label =
                            _('OK') + ` (rate: ${remaining}, ` +
                            `scopes: ${scopes || 'n/a'})`;
                        statusLabel.css_classes = ['success'];
                    } else if (status === Soup.Status.UNAUTHORIZED) {
                        statusLabel.label =
                            _('401 Unauthorized \u2013 bad token');
                        statusLabel.css_classes = ['error'];
                    } else {
                        statusLabel.label = `HTTP ${status}`;
                        statusLabel.css_classes = ['error'];
                    }
                } catch (e) {
                    statusLabel.label = e.message;
                    statusLabel.css_classes = ['error'];
                } finally {
                    btn.sensitive = true;
                }
            },
        );
    }

    // ── Behavior Page ─────────────────────────────────────────────────────────

    /**
     * Build the "Behavior" preferences page.
     *
     * Contains the refresh interval spinner, desktop notification toggle,
     * participating-only toggle, auto-hide indicator toggle, and hide-count
     * toggle.
     *
     * @param {Adw.PreferencesWindow} window
     * @param {Gio.Settings} settings
     */
    _buildBehaviorPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: _('Behavior'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        /* ── Notifications group ──────────────────────────────────────── */
        const notifGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
            description: _(
                'Configure how notifications are fetched and displayed'),
        });
        page.add(notifGroup);

        /* Refresh interval (seconds) — minimum 60s per GitHub API */
        const refreshAdj = new Gtk.Adjustment({
            lower: 60,
            upper: 86400,
            step_increment: 1,
            page_increment: 10,
        });
        const refreshRow = new Adw.SpinRow({
            title: _('Refresh Interval (seconds)'),
            subtitle: _('Minimum 60 s enforced by GitHub API'),
            adjustment: refreshAdj,
        });
        settings.bind('refresh-interval', refreshAdj, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(refreshRow);

        /* Desktop notifications toggle */
        const alertRow = new Adw.SwitchRow({
            title: _('Desktop Notifications'),
            subtitle: _(
                'Show a desktop notification when new notifications arrive'),
        });
        settings.bind('show-alert', alertRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(alertRow);

        /* Participating-only toggle */
        const participatingRow = new Adw.SwitchRow({
            title: _('Participating Only'),
            subtitle: _(
                'Only show notifications where you are directly involved'),
        });
        settings.bind('show-participating-only', participatingRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(participatingRow);

        /* ── Appearance group ─────────────────────────────────────────── */
        const appearanceGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Configure the panel indicator appearance'),
        });
        page.add(appearanceGroup);

        /* Group notifications by */
        const groupByModel = new Gtk.StringList();
        groupByModel.append(_('None'));
        groupByModel.append(_('Repository'));
        groupByModel.append(_('Type'));
        groupByModel.append(_('Reason'));

        const GROUP_BY_VALUES = ['none', 'repo', 'type', 'reason'];

        const groupByRow = new Adw.ComboRow({
            title: _('Group Notifications By'),
            subtitle: _('How to group notifications in the popup menu'),
            model: groupByModel,
        });

        /* Initialise the combo from the current setting */
        const currentGroupBy = settings.get_string('group-by');
        const currentIdx = GROUP_BY_VALUES.indexOf(currentGroupBy);
        if (currentIdx >= 0)
            groupByRow.set_selected(currentIdx);

        /* Write back to GSettings when the user picks a different option */
        groupByRow.connect('notify::selected', () => {
            const idx = groupByRow.get_selected();
            if (idx >= 0 && idx < GROUP_BY_VALUES.length)
                settings.set_string('group-by', GROUP_BY_VALUES[idx]);
        });

        appearanceGroup.add(groupByRow);

        /* Auto-hide indicator when no notifications */
        const hideWidgetRow = new Adw.SwitchRow({
            title: _('Auto-hide Indicator'),
            subtitle: _(
                'Hide the panel icon when there are no notifications'),
        });
        settings.bind('hide-widget', hideWidgetRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(hideWidgetRow);

        /* Hide notification count label */
        const hideCountRow = new Adw.SwitchRow({
            title: _('Hide Count'),
            subtitle: _('Hide the notification count number'),
        });
        settings.bind('hide-notification-count', hideCountRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(hideCountRow);

        /* ── About group ──────────────────────────────────────────────── */
        const aboutGroup = new Adw.PreferencesGroup({
            title: _('About'),
        });
        page.add(aboutGroup);

        aboutGroup.add(new Adw.ActionRow({
            title: _('Version'),
            subtitle: `${this.metadata.version}`,
            activatable: false,
        }));
    }
}

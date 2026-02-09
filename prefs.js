import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';
import Soup from 'gi://Soup?version=3.0';

import {ExtensionPreferences, gettext as _} from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export default class GitHubNotificationsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // -- Authentication page ----------------------------------------------
        const authPage = new Adw.PreferencesPage({
            title: _('Authentication'),
            icon_name: 'dialog-password-symbolic',
        });
        window.add(authPage);

        const authGroup = new Adw.PreferencesGroup({
            title: _('GitHub Credentials'),
            description: _('Configure your GitHub access token and username'),
        });
        authPage.add(authGroup);

        // Domain
        const domainRow = new Adw.EntryRow({
            title: _('GitHub Hostname'),
            show_apply_button: true,
        });
        settings.bind('domain', domainRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        authGroup.add(domainRow);

        // Token
        const tokenRow = new Adw.PasswordEntryRow({
            title: _('Personal Access Token'),
            show_apply_button: true,
        });
        settings.bind('token', tokenRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        authGroup.add(tokenRow);

        // Handle
        const handleRow = new Adw.EntryRow({
            title: _('GitHub Username'),
            show_apply_button: true,
        });
        settings.bind('handle', handleRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        authGroup.add(handleRow);

        // Help text
        const helpGroup = new Adw.PreferencesGroup();
        authPage.add(helpGroup);

        const helpLabel = new Adw.ActionRow({
            title: _('How to get a token'),
            subtitle: _(
                'Visit https://github.com/settings/tokens/new\n' +
                'Select only the "notifications" scope, then generate and paste above.\n' +
                'Only GitHub Enterprise users need to change the hostname.'
            ),
            activatable: false,
        });
        helpGroup.add(helpLabel);

        // -- Test connection ------------------------------------------------------
        const testGroup = new Adw.PreferencesGroup({
            title: _('Connection Test'),
        });
        authPage.add(testGroup);

        const testRow = new Adw.ActionRow({
            title: _('Verify Credentials'),
            subtitle: _('Test your token against the GitHub API'),
        });

        const testStatusLabel = new Gtk.Label({
            label: '',
            hexpand: true,
            xalign: 1,
            css_classes: ['dim-label'],
        });
        testRow.add_suffix(testStatusLabel);

        const testButton = new Gtk.Button({
            label: _('Test'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        testRow.add_suffix(testButton);
        testRow.set_activatable_widget(testButton);

        testButton.connect('clicked', () => {
            const domain = settings.get_string('domain');
            const token = settings.get_string('token');

            if (!token) {
                testStatusLabel.label = _('No token set');
                testStatusLabel.css_classes = ['error'];
                return;
            }

            testStatusLabel.label = _('Testing...');
            testStatusLabel.css_classes = ['dim-label'];
            testButton.sensitive = false;

            const session = new Soup.Session({
                user_agent: 'gnome-github-notifications-redux',
            });
            const url = `https://api.${domain}/notifications?per_page=1`;
            const message = Soup.Message.new('GET', url);
            message.get_request_headers().append('Authorization', `Bearer ${token}`);
            message.get_request_headers().append('Accept', 'application/vnd.github+json');

            session.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, null,
                (_session, result) => {
                    try {
                        session.send_and_read_finish(result);
                        const status = message.get_status();

                        if (status === Soup.Status.OK || status === Soup.Status.NOT_MODIFIED) {
                            const scopes = message.get_response_headers().get_one('X-OAuth-Scopes') || '';
                            const rateRemaining = message.get_response_headers().get_one('X-RateLimit-Remaining') || '?';
                            testStatusLabel.label = _(`OK (rate: ${rateRemaining}, scopes: ${scopes || 'n/a'})`);
                            testStatusLabel.css_classes = ['success'];
                        } else if (status === Soup.Status.UNAUTHORIZED) {
                            testStatusLabel.label = _('401 Unauthorized - bad token');
                            testStatusLabel.css_classes = ['error'];
                        } else {
                            testStatusLabel.label = _(`HTTP ${status}`);
                            testStatusLabel.css_classes = ['error'];
                        }
                    } catch (e) {
                        testStatusLabel.label = _(`Error: ${e.message}`);
                        testStatusLabel.css_classes = ['error'];
                    } finally {
                        testButton.sensitive = true;
                    }
                },
            );
        });

        testGroup.add(testRow);

        // -- Behavior page ----------------------------------------------------
        const behaviorPage = new Adw.PreferencesPage({
            title: _('Behavior'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(behaviorPage);

        const notifGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
            description: _('Configure how notifications are fetched and displayed'),
        });
        behaviorPage.add(notifGroup);

        // Refresh interval
        const refreshAdj = new Gtk.Adjustment({
            lower: 60,
            upper: 86400,
            step_increment: 1,
            page_increment: 10,
        });
        const refreshRow = new Adw.SpinRow({
            title: _('Refresh Interval (seconds)'),
            subtitle: _('Minimum 60s enforced by GitHub API'),
            adjustment: refreshAdj,
        });
        settings.bind('refresh-interval', refreshAdj, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(refreshRow);

        // Show alerts
        const alertRow = new Adw.SwitchRow({
            title: _('Desktop Notifications'),
            subtitle: _('Show a desktop notification when new notifications arrive'),
        });
        settings.bind('show-alert', alertRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(alertRow);

        // Participating only
        const participatingRow = new Adw.SwitchRow({
            title: _('Participating Only'),
            subtitle: _('Only show notifications where you are directly involved'),
        });
        settings.bind('show-participating-only', participatingRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(participatingRow);

        // -- Appearance -------------------------------------------------------
        const appearanceGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Configure the panel indicator appearance'),
        });
        behaviorPage.add(appearanceGroup);

        // Hide widget
        const hideWidgetRow = new Adw.SwitchRow({
            title: _('Auto-hide Indicator'),
            subtitle: _('Hide the panel icon when there are no notifications'),
        });
        settings.bind('hide-widget', hideWidgetRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(hideWidgetRow);

        // Hide count
        const hideCountRow = new Adw.SwitchRow({
            title: _('Hide Count'),
            subtitle: _('Hide the notification count number'),
        });
        settings.bind('hide-notification-count', hideCountRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(hideCountRow);
    }
}

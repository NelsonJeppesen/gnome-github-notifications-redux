import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';

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

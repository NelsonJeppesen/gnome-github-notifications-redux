import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';


export default class GitHubNotificationsExtension extends Extension {
    // -- lifecycle ------------------------------------------------------------

    enable() {
        this._settings = this.getSettings();
        this._notifications = [];
        this._lastModified = null;
        this._githubInterval = 60;
        this._retryAttempts = 0;
        this._retryIntervals = [60, 120, 240, 480, 960, 1920, 3600];
        this._timeoutId = null;
        this._settingsChangedId = null;
        this._httpSession = null;
        this._notificationSource = null;

        this._loadSettings();
        this._initHttp();
        this._initIndicator();

        this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
            this._loadSettings();
            this._updateVisibility();

            // Only recreate the HTTP session when connection settings change
            if (key === 'domain' || key === 'token') {
                this._initHttp();
            }

            this._lastModified = null;  // force a full re-fetch, not a 304
            this._stopLoop();
            this._scheduleFetch(5, false);
        });

        this._fetchNotifications();
    }

    disable() {
        this._stopLoop();

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        this._indicator?.destroy();
        this._indicator = null;

        this._httpSession?.abort();
        this._httpSession = null;

        this._notificationSource = null;
        this._settings = null;
        this._notifications = [];
        this._lastModified = null;
    }

    // -- settings -------------------------------------------------------------

    _loadSettings() {
        this._domain = this._settings.get_string('domain');
        this._token = this._settings.get_string('token');
        this._hideWidget = this._settings.get_boolean('hide-widget');
        this._hideCount = this._settings.get_boolean('hide-notification-count');
        this._refreshInterval = this._settings.get_int('refresh-interval');
        this._showAlert = this._settings.get_boolean('show-alert');
        this._participatingOnly = this._settings.get_boolean('show-participating-only');
    }

    // -- UI -------------------------------------------------------------------

    _initIndicator() {
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        // Box layout for icon + label
        const box = new St.BoxLayout({style_class: 'panel-status-indicators-box'});
        this._indicator.add_child(box);

        // Icon
        const icon = new St.Icon({style_class: 'system-status-icon'});
        icon.gicon = Gio.icon_new_for_string(`${this.path}/github-symbolic.svg`);
        box.add_child(icon);

        // Notification count label
        this._label = new St.Label({
            text: '0',
            style_class: 'github-notifications-count',
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });
        box.add_child(this._label);

        // -- Popup menu -------------------------------------------------------

        // Dynamic notification list section (rebuilt on each open)
        this._notifSection = new PopupMenu.PopupMenuSection();
        this._indicator.menu.addMenuItem(this._notifSection);

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Static utility actions
        this._indicator.menu.addAction('Mark All Read', () => {
            this._markAllRead();
        });

        this._indicator.menu.addAction('Refresh Now', () => {
            this._stopLoop();
            this._fetchNotifications();
        });

        this._indicator.menu.addAction('Preferences', () => {
            this.openPreferences().catch(e =>
                console.error(`[GitHub Notifications] Failed to open preferences: ${e.message}`));
        });

        // Rebuild the notification list every time the menu opens
        this._indicator.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._rebuildNotificationList();
        });

        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._updateVisibility();
    }

    _rebuildNotificationList() {
        this._notifSection.removeAll();

        if (this._notifications.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No notifications', {
                reactive: false,
                style_class: 'github-notif-empty',
            });
            this._notifSection.addMenuItem(emptyItem);
            return;
        }

        // Limit to a reasonable number to avoid huge menus
        const maxItems = 25;
        const items = this._notifications.slice(0, maxItems);

        for (const notif of items) {
            const item = this._createNotificationItem(notif);
            this._notifSection.addMenuItem(item);
        }

        if (this._notifications.length > maxItems) {
            const moreItem = new PopupMenu.PopupMenuItem(
                `… and ${this._notifications.length - maxItems} more`, {
                    reactive: false,
                    style_class: 'github-notif-overflow',
                });
            this._notifSection.addMenuItem(moreItem);
        }
    }

    _createNotificationItem(notif) {
        const repoName = notif.repository?.full_name || '';
        const title = notif.subject?.title || 'Untitled';
        const type = notif.subject?.type || '';

        // Type icon
        let iconName = 'mail-unread-symbolic';
        if (type === 'PullRequest')
            iconName = 'document-send-symbolic';
        else if (type === 'Issue')
            iconName = 'dialog-warning-symbolic';
        else if (type === 'Commit')
            iconName = 'document-edit-symbolic';
        else if (type === 'Release')
            iconName = 'emblem-system-symbolic';

        const item = new PopupMenu.PopupBaseMenuItem({
            style_class: 'github-notif-item',
        });

        // Type icon on the left
        const typeIcon = new St.Icon({
            icon_name: iconName,
            style_class: 'github-notif-type-icon',
            icon_size: 16,
        });
        item.add_child(typeIcon);

        // Text column: repo on top, title below
        const textBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'github-notif-text-box',
        });

        const repoLabel = new St.Label({
            text: repoName,
            style_class: 'github-notif-repo',
        });
        repoLabel.clutter_text.ellipsize = 3; // PANGO_ELLIPSIZE_END
        textBox.add_child(repoLabel);

        const titleLabel = new St.Label({
            text: title,
            style_class: 'github-notif-title',
        });
        titleLabel.clutter_text.ellipsize = 3;
        textBox.add_child(titleLabel);

        item.add_child(textBox);

        // "Open" button
        const openBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'web-browser-symbolic',
                icon_size: 16,
            }),
            style_class: 'github-notif-btn github-notif-open-btn',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        openBtn.connect('clicked', () => {
            this._openSingleNotification(notif);
            this._indicator.menu.close();
        });
        item.add_child(openBtn);

        // "Mark read" (dismiss) button
        const readBtn = new St.Button({
            child: new St.Icon({
                icon_name: 'object-select-symbolic',
                icon_size: 16,
            }),
            style_class: 'github-notif-btn github-notif-read-btn',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        readBtn.connect('clicked', () => {
            this._markThreadRead(notif);
        });
        item.add_child(readBtn);

        // Clicking the row itself also opens
        item.connect('activate', () => {
            this._openSingleNotification(notif);
        });

        return item;
    }

    _updateVisibility() {
        if (this._indicator) {
            this._indicator.visible = !this._hideWidget || this._notifications.length > 0;
        }
        if (this._label) {
            this._label.visible = !this._hideCount;
        }
    }

    // -- HTTP -----------------------------------------------------------------

    _initHttp() {
        if (this._httpSession) {
            this._httpSession.abort();
        }
        this._httpSession = new Soup.Session({
            user_agent: 'gnome-github-notifications-redux',
        });
    }

    _buildApiUrl() {
        let url = `https://api.${this._domain}/notifications`;
        if (this._participatingOnly)
            url += '?participating=1';
        return url;
    }

    _getEffectiveInterval() {
        let interval = this._refreshInterval;
        if (this._retryAttempts > 0) {
            const idx = Math.min(this._retryAttempts - 1, this._retryIntervals.length - 1);
            interval = this._retryIntervals[idx];
        }
        return Math.max(interval, this._githubInterval);
    }

    // -- polling loop ---------------------------------------------------------

    _stopLoop() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _scheduleFetch(delaySecs, isRetry) {
        if (isRetry) {
            this._retryAttempts++;
        } else {
            this._retryAttempts = 0;
        }
        this._stopLoop();
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            delaySecs,
            () => {
                this._fetchNotifications();
                this._timeoutId = null;
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    // -- GitHub API -----------------------------------------------------------

    async _fetchNotifications() {
        if (!this._token || !this._httpSession) {
            console.log('[GitHub Notifications] Skipping fetch: no token or session');
            this._scheduleFetch(this._getEffectiveInterval(), false);
            return;
        }

        const url = this._buildApiUrl();
        console.log(`[GitHub Notifications] Fetching ${url}`);
        const message = Soup.Message.new('GET', url);

        // Bearer token auth (modern GitHub approach)
        message.get_request_headers().append('Authorization', `Bearer ${this._token}`);
        message.get_request_headers().append('Accept', 'application/vnd.github+json');

        if (this._lastModified) {
            message.get_request_headers().append('If-Modified-Since', this._lastModified);
        }

        try {
            const bytes = await this._httpSession.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, null);

            const status = message.get_status();
            console.log(`[GitHub Notifications] HTTP ${status}`);

            if (status === Soup.Status.OK || status === Soup.Status.NOT_MODIFIED) {
                const responseHeaders = message.get_response_headers();

                const lastMod = responseHeaders.get_one('Last-Modified');
                if (lastMod)
                    this._lastModified = lastMod;

                const pollInterval = responseHeaders.get_one('X-Poll-Interval');
                if (pollInterval)
                    this._githubInterval = parseInt(pollInterval, 10) || 60;

                if (status === Soup.Status.OK && bytes) {
                    const decoder = new TextDecoder('utf-8');
                    const text = decoder.decode(bytes.get_data());
                    const data = JSON.parse(text);
                    console.log(`[GitHub Notifications] Got ${data.length} notification(s)`);
                    this._updateNotifications(data);
                } else {
                    console.log('[GitHub Notifications] 304 Not Modified');
                }

                this._scheduleFetch(this._getEffectiveInterval(), false);
                return;
            }

            if (status === Soup.Status.UNAUTHORIZED) {
                console.error('[GitHub Notifications] 401 Unauthorized. Check your token.');
                this._label?.set_text('!');
                this._scheduleFetch(this._getEffectiveInterval(), true);
                return;
            }

            // Other HTTP errors — log the response body for debugging
            let body = '';
            if (bytes) {
                try {
                    body = new TextDecoder('utf-8').decode(bytes.get_data());
                } catch (_) { /* ignore */ }
            }
            console.error(`[GitHub Notifications] HTTP ${status}: ${body}`);
            this._scheduleFetch(this._getEffectiveInterval(), true);
        } catch (e) {
            console.error(`[GitHub Notifications] Fetch error: ${e.message}`);
            this._scheduleFetch(this._getEffectiveInterval(), true);
        }
    }

    async _markAllRead() {
        if (!this._token || !this._httpSession)
            return;

        const url = `https://api.${this._domain}/notifications`;
        const message = Soup.Message.new('PUT', url);

        message.get_request_headers().append('Authorization', `Bearer ${this._token}`);
        message.get_request_headers().append('Accept', 'application/vnd.github+json');

        const body = JSON.stringify({last_read_at: new Date().toISOString()});
        message.set_request_body_from_bytes(
            'application/json',
            new GLib.Bytes(new TextEncoder().encode(body)),
        );

        try {
            await this._httpSession.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, null);

            const status = message.get_status();
            if (status === Soup.Status.RESET_CONTENT || status === Soup.Status.OK ||
                status === Soup.Status.NO_CONTENT || status === 202) {
                this._notifications = [];
                this._label?.set_text('0');
                this._updateVisibility();
                this._rebuildNotificationList();
                console.log('[GitHub Notifications] Marked all as read');
            } else {
                console.error(`[GitHub Notifications] Mark read failed: HTTP ${status}`);
            }
        } catch (e) {
            console.error(`[GitHub Notifications] Mark read error: ${e.message}`);
        }
    }

    // -- notification handling ------------------------------------------------

    _updateNotifications(data) {
        const previousCount = this._notifications.length;
        this._notifications = data;

        this._label?.set_text(`${data.length}`);
        this._updateVisibility();
        console.log(`[GitHub Notifications] Updated: ${previousCount} -> ${data.length}, visible=${this._indicator?.visible}, hideWidget=${this._hideWidget}`);

        if (data.length > previousCount && this._showAlert) {
            this._sendDesktopNotification(data.length);
        }
    }

    _sendDesktopNotification(count) {
        try {
            const source = new MessageTray.Source({
                title: 'GitHub Notifications',
                iconName: 'mail-unread-symbolic',
            });
            Main.messageTray.add(source);

            const notification = new MessageTray.Notification({
                source,
                title: 'GitHub Notifications',
                body: `You have ${count} unread notification${count !== 1 ? 's' : ''}`,
            });
            notification.setTransient(true);
            notification.connect('activated', () => this._openNotifications());

            source.addNotification(notification);
        } catch (e) {
            console.error(`[GitHub Notifications] Desktop notification error: ${e.message}`);
        }
    }

    // -- actions --------------------------------------------------------------

    _openNotifications() {
        try {
            let url = `https://${this._domain}/notifications`;
            if (this._participatingOnly)
                url += '/participating';

            Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (e) {
            console.error(`[GitHub Notifications] Cannot open URI: ${e.message}`);
        }
    }

    /**
     * Convert a GitHub API URL to a browser-friendly HTML URL.
     *
     * API URLs look like:
     *   https://api.github.com/repos/owner/repo/pulls/42
     *   https://api.github.com/repos/owner/repo/issues/7
     *   https://api.github.com/repos/owner/repo/commits/abc123
     *
     * We convert to:
     *   https://github.com/owner/repo/pull/42
     *   https://github.com/owner/repo/issues/7
     *   https://github.com/owner/repo/commit/abc123
     */
    _resolveNotificationUrl(notif) {
        const subjectUrl = notif.subject?.url;
        const repoFullName = notif.repository?.full_name;
        const domain = this._domain;

        if (subjectUrl) {
            try {
                // Convert API URL to HTML URL
                // e.g. https://api.github.com/repos/owner/repo/pulls/42
                //   -> https://github.com/owner/repo/pull/42
                let htmlUrl = subjectUrl
                    .replace(`https://api.${domain}/repos/`, `https://${domain}/`)
                    .replace(/\/pulls\//, '/pull/')
                    .replace(/\/commits\//, '/commit/');
                return htmlUrl;
            } catch (_) { /* fall through */ }
        }

        // Fallback: open the repo page
        if (repoFullName)
            return `https://${domain}/${repoFullName}`;

        // Last resort: global notifications page
        return `https://${domain}/notifications`;
    }

    _openSingleNotification(notif) {
        try {
            const url = this._resolveNotificationUrl(notif);
            console.log(`[GitHub Notifications] Opening: ${url}`);
            Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (e) {
            console.error(`[GitHub Notifications] Cannot open URI: ${e.message}`);
        }
    }

    async _markThreadRead(notif) {
        if (!this._token || !this._httpSession)
            return;

        const threadId = notif.id;
        if (!threadId)
            return;

        const url = `https://api.${this._domain}/notifications/threads/${threadId}`;
        const message = Soup.Message.new('PATCH', url);

        message.get_request_headers().append('Authorization', `Bearer ${this._token}`);
        message.get_request_headers().append('Accept', 'application/vnd.github+json');

        try {
            await this._httpSession.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, null);

            const status = message.get_status();
            if (status === Soup.Status.RESET_CONTENT || status === Soup.Status.OK ||
                status === Soup.Status.NO_CONTENT || status === 205) {
                // Remove from local list and update UI
                this._notifications = this._notifications.filter(n => n.id !== threadId);
                this._label?.set_text(`${this._notifications.length}`);
                this._updateVisibility();
                this._rebuildNotificationList();
                console.log(`[GitHub Notifications] Thread ${threadId} marked as read`);
            } else {
                console.error(`[GitHub Notifications] Mark thread read failed: HTTP ${status}`);
            }
        } catch (e) {
            console.error(`[GitHub Notifications] Mark thread read error: ${e.message}`);
        }
    }
}

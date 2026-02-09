/*
 * extension.js — GitHub Notifications Redux
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (c) 2026 Nelson Alex Jeppesen
 *
 * Main extension module for GNOME Shell.  Polls the GitHub Notifications API,
 * displays an unread count in the top panel, and provides a popup menu to
 * browse, open, and dismiss individual notifications.
 *
 * Architecture
 * ────────────
 *  • PanelMenu.Button  — indicator icon + count label in the top bar
 *  • PopupMenuSection  — dynamically rebuilt list of notification rows
 *  • Soup 3.0          — async HTTP for the GitHub REST API
 *  • GLib timeout       — polling loop with exponential back-off on errors
 *  • MessageTray        — optional desktop notification alerts
 */

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

/**
 * Maximum number of notification items shown in the popup menu before
 * an overflow "… and N more" label is appended.
 */
const MAX_MENU_ITEMS = 25;

/**
 * Map of GitHub notification subject types to symbolic icon names used
 * in the GNOME Shell icon theme.
 */
const TYPE_ICONS = {
    PullRequest: 'document-send-symbolic',
    Issue: 'dialog-warning-symbolic',
    Commit: 'document-edit-symbolic',
    Release: 'emblem-system-symbolic',
};

/** Default icon when the notification type is unknown. */
const DEFAULT_ICON = 'mail-unread-symbolic';

/**
 * Back-off schedule (in seconds) used when consecutive fetch attempts fail.
 * Index 0 is used after the first failure, index 1 after the second, etc.
 * The last value is reused for all subsequent retries.
 */
const RETRY_INTERVALS = [60, 120, 240, 480, 960, 1920, 3600];


export default class GitHubNotificationsExtension extends Extension {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Called by GNOME Shell when the extension is enabled.
     *
     * Initialises settings, HTTP session, panel indicator, and starts the
     * first notification fetch.  All resources created here are torn down
     * in {@link disable}.
     */
    enable() {
        /* Mutable state — reset on every enable cycle */
        this._notifications = [];
        this._lastModified = null;
        this._githubInterval = 60;     // seconds; updated from X-Poll-Interval
        this._retryAttempts = 0;
        this._timeoutId = null;
        this._settingsChangedId = null;
        this._httpSession = null;

        /* Bind GSettings and read current values */
        this._settings = this.getSettings();
        this._loadSettings();

        /* Create the Soup HTTP session and panel indicator */
        this._initHttp();
        this._initIndicator();

        /*
         * React to any settings change: reload values, refresh visibility,
         * and (when credentials change) recreate the HTTP session.  After
         * any change we force a full re-fetch to pick up the new config.
         */
        this._settingsChangedId = this._settings.connect(
            'changed',
            (_settings, key) => {
                this._loadSettings();
                this._updateVisibility();

                if (key === 'domain' || key === 'token')
                    this._initHttp();

                this._lastModified = null;   // force full re-fetch (not 304)
                this._stopLoop();
                this._scheduleFetch(5, false);
            },
        );

        /* Kick off the first poll immediately */
        this._fetchNotifications();
    }

    /**
     * Called by GNOME Shell when the extension is disabled or GNOME Shell
     * is shutting down.
     *
     * Every resource created in {@link enable} is released here: main-loop
     * sources removed, signals disconnected, widgets destroyed, and
     * references nulled so nothing leaks between enable/disable cycles.
     */
    disable() {
        this._stopLoop();

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        this._indicator?.destroy();
        this._indicator = null;
        this._notifSection = null;
        this._label = null;

        this._httpSession?.abort();
        this._httpSession = null;

        this._settings = null;
        this._notifications = [];
        this._lastModified = null;
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    /**
     * Read all GSettings keys into instance properties for quick access.
     * Called once in {@link enable} and again whenever a setting changes.
     */
    _loadSettings() {
        this._domain = this._settings.get_string('domain');
        this._token = this._settings.get_string('token');
        this._hideWidget = this._settings.get_boolean('hide-widget');
        this._hideCount = this._settings.get_boolean('hide-notification-count');
        this._refreshInterval = this._settings.get_int('refresh-interval');
        this._showAlert = this._settings.get_boolean('show-alert');
        this._participatingOnly =
            this._settings.get_boolean('show-participating-only');
    }

    // ── UI / Panel Indicator ──────────────────────────────────────────────────

    /**
     * Build the panel indicator (icon + count label) and its popup menu.
     *
     * Menu layout:
     *   ┌──────────────────────────────────────┐
     *   │  (dynamic notification list section)  │
     *   ├──────────────────────────────────────┤
     *   │  Mark All Read                       │
     *   │  Refresh Now                         │
     *   │  Preferences                         │
     *   └──────────────────────────────────────┘
     */
    _initIndicator() {
        this._indicator =
            new PanelMenu.Button(0.0, this.metadata.name, false);

        /* Horizontal box: [icon] [count] */
        const box = new St.BoxLayout({
            style_class: 'panel-status-indicators-box',
        });
        this._indicator.add_child(box);

        /* GitHub icon loaded from the bundled SVG */
        const icon = new St.Icon({style_class: 'system-status-icon'});
        icon.gicon = Gio.icon_new_for_string(
            `${this.path}/github-symbolic.svg`);
        box.add_child(icon);

        /* Notification count label (hidden when user enables "hide count") */
        this._label = new St.Label({
            text: '0',
            style_class: 'github-notifications-count',
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });
        box.add_child(this._label);

        /* ── Popup menu ─────────────────────────────────────────────────── */

        /* Dynamic notification-list section, rebuilt each time the menu opens */
        this._notifSection = new PopupMenu.PopupMenuSection();
        this._indicator.menu.addMenuItem(this._notifSection);

        this._indicator.menu.addMenuItem(
            new PopupMenu.PopupSeparatorMenuItem());

        /* Static action items at the bottom */
        this._indicator.menu.addAction('Mark All Read', () => {
            this._markAllRead();
        });

        this._indicator.menu.addAction('Refresh Now', () => {
            this._lastModified = null;   // force full re-fetch
            this._stopLoop();
            this._fetchNotifications();
        });

        this._indicator.menu.addAction('Preferences', () => {
            this.openPreferences().catch(e =>
                console.error(
                    `[GitHub Notifications] Prefs error: ${e.message}`));
        });

        /* Rebuild the notification list every time the menu opens */
        this._indicator.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._rebuildNotificationList();
        });

        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._updateVisibility();
    }

    /**
     * Tear down and rebuild the notification list inside the popup menu.
     *
     * Called when the menu opens so the list always reflects the latest
     * cached notifications.  Items beyond {@link MAX_MENU_ITEMS} are
     * collapsed into an overflow label.
     */
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

        const items = this._notifications.slice(0, MAX_MENU_ITEMS);
        for (const notif of items)
            this._notifSection.addMenuItem(this._createNotificationItem(notif));

        /* Show overflow indicator when there are more items */
        if (this._notifications.length > MAX_MENU_ITEMS) {
            const overflow = this._notifications.length - MAX_MENU_ITEMS;
            const moreItem = new PopupMenu.PopupMenuItem(
                `\u2026 and ${overflow} more`, {
                    reactive: false,
                    style_class: 'github-notif-overflow',
                });
            this._notifSection.addMenuItem(moreItem);
        }
    }

    /**
     * Create a single notification row widget for the popup menu.
     *
     * Layout:  [type-icon]  [repo / title]  [open-btn]  [mark-read-btn]
     *
     * @param {Object} notif — GitHub notification object from the API.
     * @returns {PopupMenu.PopupBaseMenuItem}
     */
    _createNotificationItem(notif) {
        const repoName = notif.repository?.full_name ?? '';
        const title = notif.subject?.title ?? 'Untitled';
        const type = notif.subject?.type ?? '';

        /* Resolve a symbolic icon name for the notification type */
        const iconName = TYPE_ICONS[type] ?? DEFAULT_ICON;

        const item = new PopupMenu.PopupBaseMenuItem({
            style_class: 'github-notif-item',
        });

        /* ── Type icon (left) ─────────────────────────────────────────── */
        item.add_child(new St.Icon({
            icon_name: iconName,
            style_class: 'github-notif-type-icon',
            icon_size: 16,
        }));

        /* ── Text column: repo name on top, title below ───────────────── */
        const textBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'github-notif-text-box',
        });

        const repoLabel = new St.Label({
            text: repoName,
            style_class: 'github-notif-repo',
        });
        repoLabel.clutter_text.ellipsize = 3;  // Pango.EllipsizeMode.END
        textBox.add_child(repoLabel);

        const titleLabel = new St.Label({
            text: title,
            style_class: 'github-notif-title',
        });
        titleLabel.clutter_text.ellipsize = 3;  // Pango.EllipsizeMode.END
        textBox.add_child(titleLabel);

        item.add_child(textBox);

        /* ── "Open in browser" button ─────────────────────────────────── */
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

        /* ── "Mark as read" (dismiss) button ──────────────────────────── */
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

        /* Clicking the row body also opens the notification */
        item.connect('activate', () => {
            this._openSingleNotification(notif);
        });

        return item;
    }

    /**
     * Update the indicator's visibility and the count label based on the
     * current settings and notification count.
     *
     * - If "hide widget" is on, the indicator is hidden when count == 0.
     * - If "hide count" is on, the numeric label is hidden.
     */
    _updateVisibility() {
        if (this._indicator)
            this._indicator.visible =
                !this._hideWidget || this._notifications.length > 0;

        if (this._label)
            this._label.visible = !this._hideCount;
    }

    // ── HTTP Session ──────────────────────────────────────────────────────────

    /**
     * (Re)create the Soup HTTP session.
     *
     * Called once during {@link enable} and again if the user changes the
     * domain or token settings so stale connections are dropped.
     */
    _initHttp() {
        if (this._httpSession)
            this._httpSession.abort();

        this._httpSession = new Soup.Session({
            user_agent: 'gnome-github-notifications-redux',
        });
    }

    /**
     * Build the full API URL for the GitHub Notifications endpoint.
     *
     * Standard GitHub:   https://api.github.com/notifications
     * GitHub Enterprise:  https://DOMAIN/api/v3/notifications
     *
     * @returns {string} The API URL.
     */
    _buildApiUrl(path = 'notifications') {
        const base = this._domain === 'github.com'
            ? `https://api.github.com`
            : `https://${this._domain}/api/v3`;

        let url = `${base}/${path}`;
        if (path === 'notifications' && this._participatingOnly)
            url += '?participating=1';

        return url;
    }

    /**
     * Determine the effective polling interval in seconds.
     *
     * The interval is the larger of the user-configured refresh interval and
     * the server-provided {@link _githubInterval} (from X-Poll-Interval).
     * During exponential back-off (after errors), the back-off value may
     * dominate.
     *
     * @returns {number} Seconds until next fetch.
     */
    _getEffectiveInterval() {
        let interval = this._refreshInterval;

        if (this._retryAttempts > 0) {
            const idx = Math.min(
                this._retryAttempts - 1,
                RETRY_INTERVALS.length - 1);
            interval = RETRY_INTERVALS[idx];
        }

        return Math.max(interval, this._githubInterval);
    }

    // ── Polling Loop ──────────────────────────────────────────────────────────

    /**
     * Cancel any pending poll timeout.
     *
     * Uses `GLib.Source.remove()` as recommended by GNOME Shell guidelines.
     */
    _stopLoop() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    /**
     * Schedule the next notification fetch after a delay.
     *
     * @param {number} delaySecs — seconds to wait before fetching.
     * @param {boolean} isRetry  — if true, increment the back-off counter.
     */
    _scheduleFetch(delaySecs, isRetry) {
        if (isRetry)
            this._retryAttempts++;
        else
            this._retryAttempts = 0;

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

    // ── GitHub API ────────────────────────────────────────────────────────────

    /**
     * Fetch unread notifications from the GitHub API.
     *
     * Uses conditional requests (If-Modified-Since) to avoid wasting API
     * quota when the notification list hasn't changed.  On success, updates
     * the cached list and schedules the next poll.  On failure, enters
     * exponential back-off.
     */
    async _fetchNotifications() {
        if (!this._token || !this._httpSession) {
            this._scheduleFetch(this._getEffectiveInterval(), false);
            return;
        }

        const url = this._buildApiUrl();
        const message = Soup.Message.new('GET', url);

        /* Bearer token auth (modern GitHub approach) */
        message.get_request_headers().append(
            'Authorization', `Bearer ${this._token}`);
        message.get_request_headers().append(
            'Accept', 'application/vnd.github+json');

        /* Conditional request to avoid burning API quota */
        if (this._lastModified)
            message.get_request_headers().append(
                'If-Modified-Since', this._lastModified);

        try {
            const bytes = await this._httpSession.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, null);

            const status = message.get_status();

            if (status === Soup.Status.OK ||
                status === Soup.Status.NOT_MODIFIED) {
                const responseHeaders = message.get_response_headers();

                /* Cache the Last-Modified header for conditional requests */
                const lastMod = responseHeaders.get_one('Last-Modified');
                if (lastMod)
                    this._lastModified = lastMod;

                /* Respect GitHub's requested poll interval */
                const pollInterval =
                    responseHeaders.get_one('X-Poll-Interval');
                if (pollInterval)
                    this._githubInterval = parseInt(pollInterval, 10) || 60;

                /* Parse the notification payload on 200 OK */
                if (status === Soup.Status.OK && bytes) {
                    const data = bytes.get_data();
                    if (data) {
                        const text = new TextDecoder('utf-8').decode(data);
                        const parsed = JSON.parse(text);
                        this._updateNotifications(parsed);
                    }
                }

                this._scheduleFetch(
                    this._getEffectiveInterval(), false);
                return;
            }

            /* 401 — likely a revoked or invalid token */
            if (status === Soup.Status.UNAUTHORIZED) {
                console.error(
                    '[GitHub Notifications] 401 Unauthorized – check token');
                this._label?.set_text('!');
                this._scheduleFetch(
                    this._getEffectiveInterval(), true);
                return;
            }

            /* Any other HTTP error — log for debugging */
            console.error(
                `[GitHub Notifications] HTTP ${status}`);
            this._scheduleFetch(this._getEffectiveInterval(), true);
        } catch (e) {
            console.error(
                `[GitHub Notifications] Fetch error: ${e.message}`);
            this._scheduleFetch(this._getEffectiveInterval(), true);
        }
    }

    /**
     * Mark every notification as read via the GitHub API (PUT).
     *
     * GitHub responds with 205 Reset Content on success.  On success, clears
     * the local cache and updates the UI immediately.
     */
    async _markAllRead() {
        if (!this._token || !this._httpSession)
            return;

        const url = this._buildApiUrl();
        const message = Soup.Message.new('PUT', url);

        message.get_request_headers().append(
            'Authorization', `Bearer ${this._token}`);
        message.get_request_headers().append(
            'Accept', 'application/vnd.github+json');

        const body = JSON.stringify({
            last_read_at: new Date().toISOString(),
        });
        message.set_request_body_from_bytes(
            'application/json',
            new GLib.Bytes(new TextEncoder().encode(body)),
        );

        try {
            await this._httpSession.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, null);

            const status = message.get_status();

            /* 205, 200, or 204 all indicate success */
            if (status === Soup.Status.RESET_CONTENT ||
                status === Soup.Status.OK ||
                status === Soup.Status.NO_CONTENT) {
                this._notifications = [];
                this._label?.set_text('0');
                this._updateVisibility();
                this._rebuildNotificationList();
            } else {
                console.error(
                    `[GitHub Notifications] Mark-all-read failed: HTTP ${status}`);
            }
        } catch (e) {
            console.error(
                `[GitHub Notifications] Mark-all-read error: ${e.message}`);
        }
    }

    // ── Notification Handling ─────────────────────────────────────────────────

    /**
     * Replace the cached notification list with fresh data from the API.
     *
     * Sends a desktop notification if the new count is higher than the old
     * count and the user has enabled alerts.
     *
     * @param {Object[]} data — array of notification objects from GitHub.
     */
    _updateNotifications(data) {
        const previousCount = this._notifications.length;
        this._notifications = data;

        this._label?.set_text(`${data.length}`);
        this._updateVisibility();

        /* Alert the user when new notifications arrive */
        if (data.length > previousCount && this._showAlert)
            this._sendDesktopNotification(data.length);
    }

    /**
     * Show a transient desktop notification via GNOME's MessageTray.
     *
     * Clicking the notification opens the GitHub notifications page in the
     * user's default browser.
     *
     * @param {number} count — current unread notification count.
     */
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
                body: count === 1
                    ? 'You have 1 unread notification'
                    : `You have ${count} unread notifications`,
            });
            notification.setTransient(true);
            notification.connect('activated', () =>
                this._openNotifications());

            source.addNotification(notification);
        } catch (e) {
            console.error(
                `[GitHub Notifications] Desktop notification error: ${e.message}`);
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    /**
     * Open the GitHub notifications page in the default browser.
     *
     * Respects the "participating only" setting to open the correct
     * sub-page.
     */
    _openNotifications() {
        try {
            let url = `https://${this._domain}/notifications`;
            if (this._participatingOnly)
                url += '/participating';

            Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (e) {
            console.error(
                `[GitHub Notifications] Cannot open URI: ${e.message}`);
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
     * Converted to:
     *   https://github.com/owner/repo/pull/42
     *   https://github.com/owner/repo/issues/7
     *   https://github.com/owner/repo/commit/abc123
     *
     * @param {Object} notif — GitHub notification object.
     * @returns {string} Browser-friendly URL.
     */
    _resolveNotificationUrl(notif) {
        const subjectUrl = notif.subject?.url;
        const repoFullName = notif.repository?.full_name;
        const domain = this._domain;

        if (subjectUrl) {
            try {
                /*
                 * Standard GitHub: strip "api." prefix and /repos/ segment.
                 * GHE: strip /api/v3/ prefix.
                 * Then normalise plural endpoints to their singular HTML form.
                 */
                let htmlUrl = subjectUrl;

                if (domain === 'github.com') {
                    htmlUrl = htmlUrl.replace(
                        `https://api.github.com/repos/`,
                        `https://github.com/`);
                } else {
                    htmlUrl = htmlUrl.replace(
                        `https://${domain}/api/v3/repos/`,
                        `https://${domain}/`);
                }

                htmlUrl = htmlUrl
                    .replace(/\/pulls\//, '/pull/')
                    .replace(/\/commits\//, '/commit/');

                return htmlUrl;
            } catch (_) {
                /* fall through to repo/global fallback */
            }
        }

        /* Fallback: open the repo page */
        if (repoFullName)
            return `https://${domain}/${repoFullName}`;

        /* Last resort: global notifications page */
        return `https://${domain}/notifications`;
    }

    /**
     * Open a single notification's subject URL in the default browser.
     *
     * @param {Object} notif — GitHub notification object.
     */
    _openSingleNotification(notif) {
        try {
            const url = this._resolveNotificationUrl(notif);
            Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (e) {
            console.error(
                `[GitHub Notifications] Cannot open URI: ${e.message}`);
        }
    }

    /**
     * Mark a single notification thread as read via the GitHub API (PATCH).
     *
     * On success, removes the notification from the local cache and refreshes
     * the popup menu so the dismissed item disappears immediately.
     *
     * @param {Object} notif — GitHub notification object (must have `.id`).
     */
    async _markThreadRead(notif) {
        if (!this._token || !this._httpSession)
            return;

        const threadId = notif.id;
        if (!threadId)
            return;

        const url = this._buildApiUrl(`notifications/threads/${threadId}`);
        const message = Soup.Message.new('PATCH', url);

        message.get_request_headers().append(
            'Authorization', `Bearer ${this._token}`);
        message.get_request_headers().append(
            'Accept', 'application/vnd.github+json');

        try {
            await this._httpSession.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, null);

            const status = message.get_status();

            /* 205 Reset Content is the documented success code */
            if (status === Soup.Status.RESET_CONTENT ||
                status === Soup.Status.OK ||
                status === Soup.Status.NO_CONTENT) {
                this._notifications =
                    this._notifications.filter(n => n.id !== threadId);
                this._label?.set_text(`${this._notifications.length}`);
                this._updateVisibility();
                this._rebuildNotificationList();
            } else {
                console.error(
                    `[GitHub Notifications] Mark-thread-read failed: HTTP ${status}`);
            }
        } catch (e) {
            console.error(
                `[GitHub Notifications] Mark-thread-read error: ${e.message}`);
        }
    }
}

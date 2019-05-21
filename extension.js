/* TouchpadIndicator - Touchpad management GNOME Shell Extension.
 * Orignal work Copyright (C) 2011-2013 Armin Köhler <orangeshirt at web.de>
 * Modifcations Copyright (C) 2019 Ashesh Singh <user501254 at gmail.com>
 *
 * This file is part of TouchpadIndicator, a fork of Armin Köhler's
 * 'gnome-shell-extension-touchpad-indicator' project which is licensed GPLv2.
 * Orignal source code is available at https://git.io/fjVec.
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation; either version 2 of the License, or (at your option)
 * any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program; if not, write to:
 * The Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor
 * Boston, MA 02110-1301, USA.
 */


const { Gio, GLib, GObject, Meta, Shell, St } = imports.gi;
const Mainloop = imports.mainloop;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const MessageTray = imports.ui.messageTray;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const Lib = Me.imports.lib;

const SCHEMA_EXTENSION = 'org.gnome.shell.extensions.touchpad-indicator';
const SCHEMA_TOUCHPAD = 'org.gnome.desktop.peripherals.touchpad';

const KEY_ALWAYS_SHOW = 'show-panelicon';
const TPD_SEND_EVENTS = 'send-events';

var TouchpadIndicator = GObject.registerClass(
class TouchpadIndicatorButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Touchpad Indicator');
        let hbox = new St.BoxLayout({
            style_class: 'panel-status-menu-box'
        });
        let icon = new St.Icon({
            icon_name: 'input-touchpad-symbolic',
            style_class: 'system-status-icon'
        });
        hbox.add_child(icon);
        hbox.add_child(PopupMenu.arrowIcon(St.Side.BOTTOM));
        this.add_child(hbox);

        this._extSettings = ExtensionUtils.getSettings(SCHEMA_EXTENSION);
        this._keyAlwaysShowSignal = this._extSettings.connect(
            `changed::${KEY_ALWAYS_SHOW}`,
            this._queueSyncMenuVisibility.bind(this));

        this._tpdSettings = new Gio.Settings({ schema_id: SCHEMA_TOUCHPAD });
        this._tpdSendEventsSignal = this._tpdSettings.connect(
            `changed::${TPD_SEND_EVENTS}`,
            this._queueSyncTouchpadEnable.bind(this));

        this._queueSyncTouchpadEnable('touchpad-enabled');

        let touchpad = this._buildItem('Touchpad', this._extSettings,
            'touchpad-enabled');
        this.menu.addMenuItem(touchpad);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addSettingsAction('Mouse & Touchpad Preferences',
            'gnome-mouse-panel.desktop');
        this.menu.addAction('Indicator Preferences', () => {
            Lib.executeCmdAsync(`gnome-shell-extension-prefs ${Me.uuid}`);
        });

        this.actor.show();
        //this._notify('input-touchpad-symbolic', 'Touchpad Indicator',
        //    'Touchpad Indicator _init() done.');
        this._addKeybinding();
    }

    _buildItemExtended(string, initialValue, writable, onSet) {
        let widget = new PopupMenu.PopupSwitchMenuItem(string,
            initialValue);
        if (!writable)
            widget.actor.reactive = false;
        else
            widget.connect('toggled', item => {
                onSet(item.state);
            });
        return widget;
    }

    _buildItem(string, settings, key) {
        settings.connect(`changed::${key}`, () => {
            widget.setToggleState(settings.get_boolean(key));
            this._queueSyncTouchpadEnable(key);
            this._queueSyncMenuVisibility();
        });

        let widget = this._buildItemExtended(string,
            settings.get_boolean(key),
            settings.is_writable(key),
            (enabled) => {
                settings.set_boolean(key, enabled);
            });
        return widget;
    }

    _queueSyncMenuVisibility() {
        if (this._syncMenuVisibilityIdle)
            return;

        this._syncMenuVisibilityIdle = Mainloop.idle_add(
            this._syncMenuVisibility.bind(this));
        GLib.Source.set_name_by_id(this._syncMenuVisibilityIdle,
            '[gnome-shell] this._syncMenuVisibility');
    }

    _syncMenuVisibility() {
        this._syncMenuVisibilityIdle = 0;

        let alwaysShow = this._extSettings.get_boolean(KEY_ALWAYS_SHOW);
        let items = this.menu._getMenuItems();

        this.actor.visible = alwaysShow || items.some(f => !!f.state);

        return GLib.SOURCE_REMOVE;
    }

    _isEnabled(keyValue) {
        switch (keyValue.constructor) {
        case Boolean:
            return (keyValue ?
                new GLib.Variant('s', 'enabled') :
                new GLib.Variant('s', 'disabled'));
        case String:
            return (keyValue !== 'enabled' ? false : true);
        case GLib.Variant:
            if (keyValue.is_of_type(new GLib.VariantType('s'))) {
                return (keyValue.get_string()[0] !== 'enabled' ? false : true);
            }
            if (keyValue.is_of_type(new GLib.VariantType('b'))) {
                return (keyValue.get_boolean());
            }
            return true;
        default:
            global.log(`Sorry, we are out of ${keyValue.constructor}.`);
        }
    }

    _notify(iconName, title, text) {
        if (this._notification)
            this._notification.destroy();

        this._ensureSource();

        let gicon = new Gio.ThemedIcon({ name: iconName });
        this._notification = new MessageTray.Notification(this._source, title,
            text, { gicon: gicon });
        this._notification.setUrgency(MessageTray.Urgency.LOW);
        this._notification.setTransient(true);
        this._notification.connect('destroy', () => {
            this._notification = null;
        });
        this._source.notify(this._notification);
    }

    _ensureSource() {
        if (!this._source) {
            this._source = new MessageTray.Source('Touchpad Indicator',
                'touchpad-indicator');

            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }
    }

    _queueSyncTouchpadEnable(key) {
        switch (key) {
        // Touchpad enabled/disabled through SCHEMA_EXTENSION
        case 'touchpad-enabled':
            if (this._extSettings.get_boolean('touchpad-enabled')) {
                this._tpdSettings.set_string(TPD_SEND_EVENTS, 'enabled');
            } else {
                this._tpdSettings.set_string(TPD_SEND_EVENTS, 'disabled');
            }
            break;
        // Touchpad enabled/disabled through SCHEMA_TOUCHPAD
        default:
            if (this._tpdSettings.get_string(TPD_SEND_EVENTS) !== 'enabled') {
                this._extSettings.set_boolean('touchpad-enabled', false);
            } else {
                this._extSettings.set_boolean('touchpad-enabled', true);
            }
        }

    }

    _toggleTouchpad() {
        this._extSettings.set_boolean(
            'touchpad-enabled',
            !this._extSettings.get_boolean('touchpad-enabled'));
    }

    _addKeybinding() {
        this._removeKeybinding();
        Main.wm.addKeybinding('shortcut', this._extSettings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            this._toggleTouchpad.bind(this));
    }

    _removeKeybinding() {
        Main.wm.removeKeybinding('shortcut');
    }
    _disconnectSignals() {
        this._extSettings.disconnect(this._keyAlwaysShowSignal);
        this._tpdSettings.disconnect(this._tpdSendEventsSignal);
    }
});

// eslint-disable-next-line no-unused-vars
function init() {
}

let _indicator;

// eslint-disable-next-line no-unused-vars
function enable() {
    _indicator = new TouchpadIndicator;
    Main.panel.addToStatusArea('touchpad-indicator', _indicator);
}

// eslint-disable-next-line no-unused-vars
function disable() {
    _indicator._disconnectSignals();
    _indicator._removeKeybinding();
    _indicator.destroy();
}

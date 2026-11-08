// Every `storage.local` key the background owns. The compiled keymap key lives in `shared/prefix_tree.ts`, the theme and user CSS keys in `shared/theme/apply.ts`.

// The config `config.reload` last built from the files. An import will land here too. `FILES_CONFIG_STORAGE_KEY`, defined in `shared/storage_watch.ts` because a reload ends with a write of it.
export { FILES_CONFIG_STORAGE_KEY } from "../shared/storage_watch.ts";

// Strings for the help page: config, keymap and shortcut slot problems from the last load.
export const WARNINGS_STORAGE_KEY = "desertfox_warnings";

// Where the config came from and the settings in force: `CONFIG_STATUS_STORAGE_KEY`, defined in `shared/storage_watch.ts` for the pages that follow it.
export { CONFIG_STATUS_STORAGE_KEY } from "../shared/storage_watch.ts";

// Setting name to the value a saved browser edit gave it (`:set`). Global, private windows included.
export const SAVED_SETTINGS_STORAGE_KEY = "desertfox_saved_settings";

// Setting name to the value `:set --temp` gave it, in `storage.session`: a browser restart clears it. Global, private windows included.
export const TEMP_SETTINGS_STORAGE_KEY = "desertfox_temp_settings";

// Slot name to the invocations its chord runs. `commands.onCommand` reads it, because the background can restart.
export const SLOT_TABLE_STORAGE_KEY = "desertfox_slot_table";

// Set by `config.reload` just before the reload, cleared by the next startup.
export const RELOAD_PENDING_STORAGE_KEY = "desertfox_reload_pending";

// What the startup found in open tabs after a reload. The key test reads it.
export const REINJECT_REPORT_STORAGE_KEY = "desertfox_reinject_report";

// Prefix of one key per tab: the mode its content script last reported. Removed when the tab closes.
export const TAB_MODE_STORAGE_PREFIX = "desertfox_tab_mode_";

// The last bundle injections with their times. The key test reads it.
export const BUNDLE_LOADS_STORAGE_KEY = "desertfox_bundle_loads";

// The command line history, oldest first. Capped, and never filled from a private window.
export const CMDLINE_HISTORY_STORAGE_KEY = "desertfox_cmdline_history";

// Prefix of one `storage.session` key per command line ticket, holding the tab it was issued for. Removed when used.
export const CMDLINE_TICKET_STORAGE_PREFIX = "desertfox_cmdline_ticket_";

// Prefix of one `storage.session` key per tab, holding the last ticket issued for it. Only that ticket may mark the tab's opener. Removed when the tab closes.
export const CMDLINE_LATEST_TICKET_STORAGE_PREFIX = "desertfox_cmdline_latest_ticket_";

// Prefix of one `storage.session` key per tab whose command line redeemed a ticket. The value is the frame id of the line that redeemed it, and only that frame is an opener. Removed when the tab closes or navigates.
export const CMDLINE_OPENER_STORAGE_PREFIX = "desertfox_cmdline_opener_";

// Prefix of one `storage.session` key per window, holding the id of the tab the user was on before the current one. The `#` of a tab row. Removed when that tab or the window closes.
export const PREVIOUS_TAB_STORAGE_PREFIX = "desertfox_previous_tab_";

// The ids of the windows in the order they were last focused, newest first, in `storage.session`. `tab.attach` with no window reads it.
export const WINDOW_FOCUS_STORAGE_KEY = "desertfox_window_focus";

// The last repeatable request in `storage.session`, for `.`. A private window has a slot of its own, so a private command never repeats in a normal window.
export const REPEAT_STORAGE_KEY = "desertfox_last_repeat";
export const REPEAT_PRIVATE_STORAGE_KEY = "desertfox_last_repeat_private";

// Prefix of one `storage.local` key per register, holding its text. Register `/` holds the last page search. Not written from a private window.
export const REGISTER_STORAGE_PREFIX = "desertfox_register_";

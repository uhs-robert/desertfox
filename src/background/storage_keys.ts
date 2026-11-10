// Every `storage.local` key the background owns. The compiled keymap key lives in `shared/prefix_tree.ts`, the theme and user CSS keys in `shared/theme/apply.ts`.

// The raw files and the config the last `config.reload` or import built from them. `FILES_CONFIG_STORAGE_KEY`, defined in `shared/storage_watch.ts` because a reload ends with a write of it.
export { FILES_CONFIG_STORAGE_KEY } from "../shared/storage_watch.ts";

// The raw file text that config was built from, with its folder label, so an import can rebuild it with its own files on top.
// A key of its own, written in the same `set` as the config: the pages read the config at every redraw and need none of the text.
export const FILES_SOURCE_STORAGE_KEY = "desertfox_files_source";

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

// Prefix of one `storage.local` key per register, holding its value (text or a list of invocations). Only `register_store.ts` reads and writes it. A private window never reaches it.
export const REGISTER_STORAGE_PREFIX = "desertfox_register_";

// Prefix of one `storage.session` key per register of the private windows. Cleared when the last private window closes.
export const REGISTER_PRIVATE_STORAGE_PREFIX = "desertfox_private_register_";

// The saved tab sessions: `{ version: 1, sessions: { [name]: { saved_at, tabs } } }`. Only `session_store.ts` reads and writes it. Never read from a private window.
export const SESSIONS_STORAGE_KEY = "desertfox_sessions";

// Set while the user has turned DesertFox off from the toolbar or its shortcut. Absent means on, so a profile from before the switch stays on. Only the background writes it.
export const DISABLED_STORAGE_KEY = "desertfox_disabled";

// Tab id to the time (ms) of the pick that waits for its devtools page, in `storage.session`. One pick per tab: a newer one replaces it. Dropped after 60 s, on navigation and when the tab closes.
export const INSPECT_PENDING_STORAGE_KEY = "desertfox_inspect_pending";

// The local marks: `{ v: 1, pages: { [url without hash]: { at, marks: { [key]: [x, y] } } } }`. Only `mark_store.ts` reads and writes it. A private window never reaches it.
export const MARK_STORAGE_KEY = "desertfox_marks";

// The same shape for the private windows, in `storage.session`. Cleared when the last private window closes.
export const MARK_PRIVATE_STORAGE_KEY = "desertfox_private_marks";

// Every `storage.local` key the background owns. The compiled keymap key lives in `shared/prefix_tree.ts`.

// Phase 3 writes the merged config file here when the user imports it.
export const IMPORTED_CONFIG_STORAGE_KEY = "oasisfox_imported_config";

// Strings for the help page: config, keymap and shortcut slot problems from the last load.
export const WARNINGS_STORAGE_KEY = "oasisfox_warnings";

// Where the config came from and the settings in force, for the options page. Written at every startup.
export const CONFIG_STATUS_STORAGE_KEY = "oasisfox_config_status";

// Slot name to the invocations its chord runs. `commands.onCommand` reads it, because the background can restart.
export const SLOT_TABLE_STORAGE_KEY = "oasisfox_slot_table";

// Set by `config.reload` just before the reload, cleared by the next startup.
export const RELOAD_PENDING_STORAGE_KEY = "oasisfox_reload_pending";

// What the startup found in open tabs after a reload. The key test reads it.
export const REINJECT_REPORT_STORAGE_KEY = "oasisfox_reinject_report";

// Prefix of one key per tab: the mode its content script last reported. Removed when the tab closes.
export const TAB_MODE_STORAGE_PREFIX = "oasisfox_tab_mode_";

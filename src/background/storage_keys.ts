// Every `storage.local` key the background owns. The compiled keymap key lives in `shared/prefix_tree.ts`, the theme and user CSS keys in `shared/theme/apply.ts`.

// The raw files and the config the last `config.reload` or import built from them. `FILES_CONFIG_STORAGE_KEY`, defined in `shared/storage_watch.ts` because a reload ends with a write of it.
export { FILES_CONFIG_STORAGE_KEY } from "../shared/storage_watch.ts";

// The raw file text that config was built from, with its folder label, so an import can rebuild it with its own files on top.
// A key of its own, written in the same `set` as the config: the pages read the config at every redraw and need none of the text.
export const FILES_SOURCE_STORAGE_KEY = "desertfox_files_source";

// The host start waiting on the user's choice (`HostStartPending`), and the folder digest the user chose to keep the browser copy over. See `host_start.ts`.
export const HOST_START_PENDING_STORAGE_KEY = "desertfox_host_start_pending";
export const HOST_START_KEPT_STORAGE_KEY = "desertfox_host_start_kept";
// The digest of the folder files the browser copy last took from the host (a start, Use the folder or `config.reload`). A browser copy that still matches it holds no browser change.
export const HOST_START_APPLIED_STORAGE_KEY = "desertfox_host_start_applied";

// Strings for the help page: config, keymap and shortcut slot problems from the last load.
export const WARNINGS_STORAGE_KEY = "desertfox_warnings";

// Where the config came from and the settings in force: `CONFIG_STATUS_STORAGE_KEY`, defined in `shared/storage_watch.ts` for the pages that follow it.
export { CONFIG_STATUS_STORAGE_KEY } from "../shared/storage_watch.ts";

// The palette name the desktop last pushed over the bridge. `palette = "desktop"` follows it. Local storage, so it stays on this machine and survives a restart.
export const DESKTOP_PALETTE_STORAGE_KEY = "desertfox_desktop_palette";

// What the host updater remembers (`host_update.ts`): the last attempt, the version whose failure showed its toast, a blocked version and the notice shown.
export const HOST_UPDATE_STORAGE_KEY = "desertfox_host_update";

// True once a Firefox page key without the native host showed the notice that the host opens the page in one key.
export const FIREFOX_PAGE_NOTICE_STORAGE_KEY = "desertfox_firefox_page_notice";

// Setting name to the value a saved browser edit gave it (`:set`). Global, private windows included.
export const SAVED_SETTINGS_STORAGE_KEY = "desertfox_saved_settings";

// Mode to key sequence to command text, the key edits the settings page saved (`edit_layers.ts`). Global, private windows included.
export const KEYMAP_EDITS_STORAGE_KEY = "desertfox_keymap_edits";

// Engines the settings page added, and their key letters (`edit_layers.ts`). Global, private windows included.
export const ENGINE_EDITS_STORAGE_KEY = "desertfox_engine_edits";

// Command aliases the settings page added (`edit_layers.ts`): alias name to command id. Global, private windows included.
export const ALIAS_EDITS_STORAGE_KEY = "desertfox_alias_edits";

// The config the files build gives with the engines and aliases layers built in, written with each publish. `null` when both are empty, then the files config in force is the one stored under `FILES_CONFIG_STORAGE_KEY`. Pages read the config themselves, so they follow this one.
export const LAYERED_CONFIG_STORAGE_KEY = "desertfox_layered_config";

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

// The last command round trips and hint builds with their times, in `storage.session`. `debug.perf` summarizes them.
export const TIMINGS_STORAGE_KEY = "desertfox_timings";

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

// The zoom level `site_zoom.ts` set on each host this browser session, `{ [host]: level }`, in `storage.session`. The private windows have a key of their own, cleared when the last private window closes.
export const SITE_ZOOM_STORAGE_KEY = "desertfox_site_zoom";
export const SITE_ZOOM_PRIVATE_STORAGE_KEY = "desertfox_private_site_zoom";

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

// The jump lists of the normal windows, in `storage.session`: `{ v: 1, windows: { [window id]: { entries, cursor } } }`. Only `jump_store.ts` reads and writes it. A browser restart clears it, as it renumbers the windows.
export const JUMP_STORAGE_KEY = "desertfox_jumps";

// The same shape for the private windows. Cleared when the last private window closes.
export const JUMP_PRIVATE_STORAGE_KEY = "desertfox_private_jumps";

// The macro being recorded, `{ register, steps }`, in `storage.session`. Absent means no recording. A private window has a key of its own, so a private recording never shows in or reaches a normal window. Only `macro_recorder.ts` reads and writes them.
export const MACRO_RECORDING_STORAGE_KEY = "desertfox_macro_recording";
export const MACRO_RECORDING_PRIVATE_STORAGE_KEY = "desertfox_private_macro_recording";

// The register `@@` plays, a one-letter string in `storage.session`, with a key of its own for the private windows. Only `macro_last_played.ts` reads and writes them.
export const MACRO_LAST_PLAYED_STORAGE_KEY = "desertfox_macro_last_played";
export const MACRO_LAST_PLAYED_PRIVATE_STORAGE_KEY = "desertfox_private_macro_last_played";
// The quickmarks added with `M`: `{ [key]: url }`, laid over the config table. Only `quickmark_store.ts` reads and writes it. A private window reads it but never writes it.
export const QUICKMARK_STORAGE_KEY = "desertfox_quickmarks";

// The same shape for the private windows, in `storage.session`. Cleared when the last private window closes.
export const QUICKMARK_PRIVATE_STORAGE_KEY = "desertfox_private_quickmarks";

// The frames of a tab that are in media mode, and the video that `;M` pinned, in `storage.session`. See `tab_media.ts`.
export const TAB_MEDIA_STORAGE_PREFIX = "desertfox_tab_media_";
// The last mode the top frame of a tab reported and a counter of its changes, in `storage.session`. See `create_media_discovery`.
export const TAB_MEDIA_TOP_STORAGE_PREFIX = "desertfox_tab_media_top_";

// The cross-frame hint session of a tab, in `storage.session`. See `hint_frames.ts`.
export const HINT_FRAMES_STORAGE_PREFIX = "desertfox_hint_frames_";
// The open external-editor jobs, `{ [job]: { job, tab_id, token, frame_id, is_private, orphaned? } }`, in `storage.session`, so a restarted background resumes collecting. See `external_editor.ts`.
export const EDITOR_JOBS_STORAGE_KEY = "desertfox_editor_jobs";

// Prefix of one `storage.session` key per tab whose command line draws in the top frame for a subframe. The value is that subframe's id, and a command run from the line acts there. Replaced by the next line, removed when the tab closes, the frame navigates or the frame hides.
export const CMDLINE_TARGET_STORAGE_PREFIX = "desertfox_cmdline_target_";

// Messages between content script and background, sent with `runtime.sendMessage`
// and `tabs.sendMessage`. The `type` field selects the shape.

import type { BundleName } from "./bundles.ts";
import type { CommandMeta, Mode } from "./command.ts";
import type { WhichKeyBorder } from "./config.ts";
import type { SettingTag } from "./setting_list.ts";
import type { SettingRow, Settings } from "./settings_table.ts";
import type { BoundInvocation, Invocation } from "./invocation.ts";

// Why a command did not run. The content script shows `message` as a toast,
// the background falls back to a notification where no content script exists.
export type Refusal = {
  id: string;
  message: string;
};

// Content to background

export type RunRequest = {
  type: "run";
  // Runs in order. Tab and frame come from the message sender.
  invocations: BoundInvocation[];
  mode: Mode;
  // Set by the hints bundle on its link opens, so `.` keeps showing hints. The background honors it for a lone `open.url` only.
  from_hints?: true;
};

export type ModeChanged = {
  type: "mode_changed";
  mode: Mode;
};

// Escape in a frame that holds insert mode from `i`: the background returns the tab's switched frames to normal.
export type LeaveTabInsert = {
  type: "leave_tab_insert";
};

// Asks the background to inject a bundle into the sender's frame. The answer is a RunResponse: ok once the script has run.
export type LoadBundle = {
  type: "load_bundle";
  name: BundleName;
};

// Asks for the keys that can follow `prefix` in `mode`. The answer is a WhichKeyPanel.
export type ListKeys = {
  type: "list_keys";
  mode: Mode;
  prefix: string[];
};

// What the panel shows: the chain of group names that leads here (empty when there is no panel) and the keys that can follow.
export type WhichKeyPanel = { title: string[]; rows: WhichKeyRow[]; border: WhichKeyBorder };

// One key that can follow a prefix. A key that starts a longer sequence has `more` and no description.
export type WhichKeyRow = {
  keys: string;
  command: string;
  description: string;
  more: boolean;
};

// From the `cmdline` host script when it mounts the line. The answer is a one-time ticket, or undefined outside a tab.
export type IssueCmdlineTicket = {
  type: "issue_cmdline_ticket";
};

// From the command line page when it opens: asks for the history, the commands, and the lists the grammar needs to read bare words.
// The answer is undefined unless `ticket` is one the host got for this tab and nobody used yet.
// `cmdline.html` is web-accessible, so any site can embed its own copy, and that copy must get nothing.
export type OpenCmdline = {
  type: "open_cmdline";
  ticket: string;
};

// A container by name and cookie store id. The page lists the names and sends the id, because names can repeat.
export type ContainerStore = { name: string; cookie_store_id: string };

export type CmdlineOpened = {
  // Oldest first.
  history: string[];
  sources: { search_engines: string[]; containers: string[] };
  // The containers the tab list can reopen tabs in, `default` first. Empty on a private line and with containers off.
  container_stores: ContainerStore[];
  // The runtime registry, snippets included, which `commands.json` lacks.
  commands: CommandMeta[];
  command_aliases: Record<string, string>;
  // The commands with a card on the help page, which are the built-in ones. A snippet has none.
  help_ids: string[];
  // The `cmdline_prompt` setting. Absent keeps the page's own default.
  prompt?: string;
  // The window of the line's tab and the `completion_all_windows` setting, which the page needs to filter the tab model's rows.
  window_id: number;
  all_windows: boolean;
  // The `statusbar_widgets` setting, in display order.
  statusbar_widgets: Settings["statusbar_widgets"];
  // What the widgets show, taken when the line opens. `tab_index` is zero-based and `tab_count` covers the line's window.
  status: { url: string; tab_index: number; tab_count: number };
};

// From the command line page when typed text parsed. The background keeps it in the history unless the tab is private.
export type RecordCmdline = {
  type: "record_cmdline";
  text: string;
};

// From the command line page when the subject of `bookmark`, `open`, `tab.attach`, or the engine word of `search`, needs its list. The tab list reads the tab model port instead. The answer is undefined unless the
// sender is a tab whose line redeemed a ticket, and it holds only tabs and windows of the sender's own privacy (private or not).
export type CompleteItems = {
  type: "complete_items";
  kind: "bookmarks" | "engines" | "history" | "open" | "windows" | "sessions" | "registers" | "folders" | "marks" | "quickmarks" | "saved_quickmarks";
};

// From the command line page when a row key acts on tabs of the list. `tab_ids` were captured at the key press, so a later change of the list does not change them. The answer is undefined unless the sender is a tab whose line
// redeemed a ticket and every id that still names a tab is of the sender's own privacy. An id with no tab is skipped. `refusal` says why some tabs did not change.
// `reopen` also carries `cookie_store_id`, the container to reopen the tabs in. The background also leaves out the line's own tab and tabs already in that container, and refuses a private line and a store id it does not know.
// Its answer counts the tabs that moved when some did not.
export type TabRowsAction = "close" | "unload" | "load" | "mute" | "unmute" | "pin" | "unpin" | "reopen";

export type TabRowsActionRequest = {
  type: "tab_rows_action";
  action: TabRowsAction;
  tab_ids: number[];
  cookie_store_id?: string;
};

export type TabRowsActionAnswer = { refusal?: string };

// A tab's container, drawn as a mark in the container's color. Absent for the default container and for private tabs.
export type TabContainer = { color: string; icon: string };

// `id` is the browser's tab id, which the row keys send back in `tab_rows_action`. `number` is the tab's place in its window's tab bar, counted from 1. `favicon` is an http, https or short data: URL and is absent otherwise.
// The flags are present only when true, which keeps the answer small.
export type TabItem = {
  id: number;
  number: number;
  // The window's place in `windows.getAll`. The model client sets it.
  window_number?: number;

  title: string;
  url: string;
  favicon?: string;
  container?: TabContainer;
  active?: true;
  alternate?: true;
  pinned?: true;
  audible?: true;
  muted?: true;
  discarded?: true;
};

// Newest first.
export type BookmarkItem = { title: string; url: string };

// A bookmark row of the `bookmark` list. `folders` indexes `BookmarkRows.folders`, the newest copy's folder first.
export type BookmarkRow = BookmarkItem & { folders: number[] };

// The `bookmark` list: one row per address, and the folder paths sent once for the rows to point at.
export type BookmarkRows = { rows: BookmarkRow[]; folders: string[] };

// `label` is the config's resolved chain. `available` is whether the line's page can fill the engine's slots. The page URL itself never leaves the background.
export type EngineItem = { name: string; label: string; available: boolean; keyword?: string };

// A history entry as the background reads it. It never goes to the page on its own: `open` answers with `OpenRow`.
export type HistoryItem = { title: string; url: string };

// Where an `open` row came from: `bm` is a bookmark, `hist` is history.
export type OpenTag = "bm" | "hist";

export type OpenRow = { title: string; url: string; tag: OpenTag };

// Every row, in the group order of the `open_completion` setting and without a duplicate address. The page caps an empty word: 20 bookmarks and `history_max` history rows.
export type OpenItems = { rows: OpenRow[]; history_max: number };

// The `history` command's rows, newest first and with no dedup against bookmarks. `max` is the `history_list_max` cap that the page applies to an empty word, so a typed word still ranks every row.
export type HistoryItems = { rows: HistoryItem[]; max: number };

// `number` is the window's place in `windows.getAll`, counted from 1, so it stays when other windows drop out of the list. `title` is its active tab's.
export type WindowItem = { number: number; title: string };

// A heading of the page, from the host script. `level` is 1 to 6, `text` is the rendered text, trimmed.
export type HeadingItem = { level: number; text: string };

// A saved tab session: its name and the text of the description column (tab count and age), which the background writes.
export type SessionItem = { name: string; description: string };

// A register that holds something: its name and a short preview of the value.
export type RegisterItem = { name: string; description: string };

// A bookmark folder: its path from the root ("Bookmarks Toolbar / Work") and a short count of the bookmarks directly inside.
export type FolderItem = SessionItem;

export type CompleteItemsAnswer = { items: BookmarkRows | BookmarkItem[] | EngineItem[] | HistoryItems | OpenItems | WindowItem[] | HeadingItem[] | SessionItem[] | RegisterItem[] | FolderItem[] };

// A mark that a which-key row lists: its key and the scroll offset it keeps, in px. A global mark also carries its address.
export type MarkItem = { key: string; x: number; y: number; url?: string };

// From the `page` bundle. `x` and `y` are the scroll offset now. A set stores them under `key`. A jump answers the offset stored under `key` and stores the offset now as the previous position (`'`), unless the mark is missing. The page's privacy is the sender tab's.
export type MarkSet = { type: "mark_set"; key: string; url: string; x: number; y: number };
export type MarkJump = { type: "mark_jump"; key: string; url: string; x: number; y: number };
export type MarkRequest = MarkSet | MarkJump;
// Without `x` the background does the scroll itself, after it switched to or opened the tab of a global mark.
export type MarkAnswer = { ok: true; x: number; y: number } | { ok: true; x?: undefined; y?: undefined } | { ok: false; message: string };

// From the `caret` bundle: one register read or write. The background answers by the sender tab's privacy. A read answers the value, or nothing for an empty register and a refused name. A write answers an `Outcome`. A content script writes text only.
export type RegisterRead = { type: "register_read"; name: string };
export type RegisterWrite = { type: "register_write"; name: string; text: string };
// A yank: the text goes to the named register, if any (`""` names none), and to the unnamed one. A black hole name drops it.
export type RegisterYank = { type: "register_yank"; name: string; text: string };
export type RegisterRequest = RegisterRead | RegisterWrite | RegisterYank;

// From the content script when a leaf of content commands ends: the steps and how they ended. The background checks it like any page message,
// because the sender is a page script, then hands it to `record_step`. A held key sends the first press only.
export type RecordStep = {
  type: "record_step";
  invocations: Invocation[];
  outcome: Outcome;
  // Sent by the hints bundle when a pick begins, ahead of the leaf's own message.
  pick?: true;
};

// From the command line page when the user asks for help on a command, by link or by key. The background opens the help page
// at that command's card, and only for a tab whose line redeemed a ticket.
export type OpenHelp = {
  type: "open_help";
  command_id: string;
};

// A page asks for its keymap at start and again on `tree_updated`. The answer is a PageKeymap as a JSON string, or undefined when no usable keymap is stored.
export type ReadKeymap = {
  type: "read_keymap";
};

// From the `caret` bundle: one regex page search, run in the background where it can be stopped. `source` and `flags` are of a regex the page already compiled.
export type FindScan = {
  type: "find_scan";
  text: string;
  source: string;
  flags: string;
};

// Timeout means the scan ran past the limit and was stopped. Superseded means a newer scan from the same frame replaced it.
export type FindScanAnswer = { ok: true; from: Int32Array; to: Int32Array } | { ok: false; reason: "timeout" | "superseded" } | { ok: false; reason: "failed"; message: string };

// From the `hints` bundle on `copy_image` and `download`: the background fetches `address` and answers an `Outcome`.
export type ImageAction = {
  type: "image_action";
  action: "copy_image" | "download";
  address: string;
};

// From the `hints` bundle once it has set `window.__desertfox_pick` to the picked element. The background hands the pick to the devtools page of the sender's tab, which selects it in the Inspector. The answer is an `InspectAnswer`: ok once a devtools page took it, ok with `waiting` when the pick waits for DevTools to open.
export type InspectPick = {
  type: "inspect_pick";
};

// From the devtools page, as the first message on its port: which tab its toolbox inspects.
export type DevtoolsHello = {
  type: "devtools_hello";
  tab_id: number;
};

// From the background to a devtools page, on its port: select the pick now on the page.
export type DevtoolsPick = {
  type: "devtools_pick";
};

// From an extension page (the settings page): sets or resets one setting. `value` is the typed value, checked by the setting's own check. `layer` defaults to `saved`. A reset drops the saved and the temp edit.
// The answer is a ChangeSettingAnswer. The background refuses any sender that is not an extension page.
export type ChangeSetting = {
  type: "change_setting";
  name: string;
  action: "set" | "reset";
  value?: unknown;
  layer?: "saved" | "temp";
};

// From an extension page: asks for every setting. The answer is a ListSettingsAnswer.
export type ListSettings = {
  type: "list_settings";
};

// `kind` is the row kind in `settings_table.ts`. `allowed` is the typed choice list of an enum or enum list, or the values the command line suggests. `value` is absent for a setting with no default that nothing sets.
export type SettingListRow = {
  name: string;
  value?: unknown;
  top_layer: SettingTag | "default";
  kind: SettingRow["kind"];
  settable: boolean;
  expectation: string;
  allowed?: unknown[];
};

// `message` is the line `:set` would toast, including a warning that a default engine or palette names nothing.
export type ChangeSettingAnswer = { ok: true; setting: SettingListRow; message: string } | { ok: false; message: string };

export type ListSettingsAnswer = { ok: true; settings: SettingListRow[] } | { ok: false; message: string };

// What the toolbar popup asks. Only a top-level extension page may send them.
export type ToolbarRequest =
  | { type: "toolbar_set_disabled"; disabled: boolean }
  // `url` is the tab's address. The background derives the match pattern from it.
  | { type: "toolbar_site"; url: string; action: "disable" | "enable" }
  | { type: "toolbar_reload_config" };

export type ToolbarAnswer = { ok: true; message: string } | { ok: false; message: string };

// The user's pick for an import: a zip's bytes, or the files of a `webkitdirectory` folder as read by the page, with paths relative to the picked folder's parent.
export type ImportSource = { kind: "zip"; bytes: Uint8Array | ArrayBuffer } | { kind: "folder"; entries: { path: string; text: string }[] };

// From an extension page: reads an import and says what it would change. Nothing is stored and no snippet runs. The answer is a ConfigImportPreview.
export type PreviewConfigImport = { type: "preview_config_import"; source: ImportSource };

// From an extension page: applies an import. `accepted` maps each snippet path the user accepted to the code the preview showed. Any other snippet is left out. The answer is a ConfigImportAnswer.
export type CommitConfigImport = { type: "commit_config_import"; source: ImportSource; accepted: Record<string, string> };

// One snippet of an import as the consent screen shows it. The header fields are absent when the header does not parse.
export type SnippetPreview = {
  path: string;
  code: string;
  // A snippet with this path is installed, and accepting replaces it.
  replaces: boolean;
  problems: string[];
  id?: string;
  label?: string;
  intent?: string;
  matches?: string[];
  requires?: string[];
};

// `replaces_config` says the import holds config files, which replace every config file in force. `problems` come from a build with every snippet accepted: the commit refuses while any remain.
export type ConfigImportPreview =
  | { ok: true; replaces_config: boolean; config_files: string[]; snippets: SnippetPreview[]; problems: string[]; warnings: string[] }
  | { ok: false; message: string };

export type ConfigImportAnswer = { ok: true; message: string } | { ok: false; message: string };

// From an extension page: the files an export writes, raw. The page builds the two zips. `config_files` holds the config files and the saved browser edits as TOML, `snippet_files` the installed snippets, both keyed by their path in the zip.
export type ExportConfig = { type: "export_config" };
export type ExportConfigAnswer = { ok: true; config_files: Record<string, string>; snippet_files: Record<string, string> } | { ok: false; message: string };

// From an extension page: the installed snippets for the list on the settings page. The header fields are absent when the header does not parse.
export type ListSnippets = { type: "list_snippets" };
export type InstalledSnippet = { path: string; problems: string[]; id?: string; label?: string; intent?: string; matches?: string[]; requires?: string[] };
export type ListSnippetsAnswer = { ok: true; snippets: InstalledSnippet[] } | { ok: false; message: string };

// From an extension page: removes one installed snippet and rebuilds the config without it. The answer is a ConfigImportAnswer.
export type RemoveSnippet = { type: "remove_snippet"; path: string };

// From an extension page: the saved tab sessions as the text of `desertfox-sessions.json`. `count` is 0 when none is saved.
export type ExportSessions = { type: "export_sessions" };
export type ExportSessionsAnswer = { ok: true; json: string; count: number } | { ok: false; message: string };

// From an extension page: adds the sessions of an export file. A name that is taken keeps both, and the import gets a suffix. The answer is a ConfigImportAnswer.
export type ImportSessions = { type: "import_sessions"; text: string };

export type PageToBackground = ChangeSetting | ListSettings | ToolbarRequest | PreviewConfigImport | CommitConfigImport | ExportConfig | ListSnippets | RemoveSnippet | ExportSessions | ImportSessions;

export type ContentToBackground = RunRequest | ModeChanged | LeaveTabInsert | LoadBundle | ListKeys | IssueCmdlineTicket | OpenCmdline | RecordCmdline | CompleteItems | TabRowsActionRequest | OpenHelp | RecordStep | ReadKeymap | FindScan | ImageAction | InspectPick | RegisterRequest | MarkRequest;

// How a command ended. Done is `{ ok: true }`. A handler that returns nothing is done, and one that throws is failed.
// Cancelled means the user left a waiting step (Escape, an unrelated key, a page change), so the rest of a sequence does not run and nothing is shown.
export type Outcome = { ok: true; cancelled?: true } | { ok: false; message: string };

export type RunResponse = { ok: true; cancelled?: true } | { ok: false; refusal: Refusal };

// Background to content

export type RunInContent = {
  type: "run_in_content";
  invocations: Invocation[];
};

// One toast on the page. A refusal leaves `kind` out and shows as an error.
export type ToastKind = "error" | "warning" | "info" | "success";

export type ShowRefusal = {
  type: "refusal";
  refusal: Refusal;
  kind?: ToastKind;
};

export type SetMode = {
  type: "set_mode";
  mode: Mode;
};

// The compiled keymap in `storage.local` changed: read it again.
export type TreeUpdated = {
  type: "tree_updated";
};

// Asks for the page selection. The content script answers with a string.
export type GetSelection = {
  type: "get_selection";
};

// Moves keyboard focus from the browser chrome into the page and leaves no field focused.
export type FocusPage = {
  type: "focus_page";
};

// Presence check before the background injects the content script. Any truthy answer counts.
export type Ping = {
  type: "ping";
};

export type BackgroundToContent = RunInContent | ShowRefusal | SetMode | TreeUpdated | GetSelection | FocusPage | Ping;

// Background to tab-model clients, over the port `desertfox_tab_model`

export type TabRow = {
  id: number;
  window_id: number;
  index: number;
  title: string;
  url: string;
  favicon_url: string;
  site: string;
  pinned: boolean;
  muted: boolean;
  audible: boolean;
  discarded: boolean;
  active: boolean;
  // The tab the window was on before its current one, the tab list's `#`. Never the active tab.
  previous: boolean;
  // The window's place in `windows.getAll`, from 1, as `tab.attach` and the `windows` list count. 0 for a popup.
  window_number: number;
  // The cookie store id, which a reopen needs. The name, color and icon are "" for the default container, for a private tab, for a deleted container and with containers off.
  container: string;
  container_name: string;
  container_color: string;
  container_icon: string;
};

export type TabModelMessage = { type: "snapshot"; rev: number; tabs: TabRow[] } | { type: "patch"; rev: number; upserts: TabRow[]; removed: number[] };
export type TabModelRequest = { type: "resync" };

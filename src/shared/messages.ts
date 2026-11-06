// Messages between content script and background, sent with `runtime.sendMessage`
// and `tabs.sendMessage`. The `type` field selects the shape.

import type { BundleName } from "./bundles.ts";
import type { CommandMeta, Mode } from "./command.ts";
import type { WhichKeyBorder } from "./config.ts";
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

export type CmdlineOpened = {
  // Oldest first.
  history: string[];
  sources: { search_engines: string[]; containers: string[] };
  // The runtime registry, snippets included, which `commands.json` lacks.
  commands: CommandMeta[];
  command_aliases: Record<string, string>;
  // The commands with a card on the help page, which are the built-in ones. A snippet has none.
  help_ids: string[];
  // The `cmdline_prompt` setting. Absent keeps the page's own default.
  prompt?: string;
};

// From the command line page when typed text parsed. The background keeps it in the history unless the tab is private.
export type RecordCmdline = {
  type: "record_cmdline";
  text: string;
};

// From the command line page when the subject of `tab`, `bookmark` or `tab.attach`, or the engine word of `search`, needs its list. The answer is undefined unless the
// sender is a tab whose line redeemed a ticket, and it holds only tabs and windows of the sender's own privacy (private or not).
export type CompleteItems = {
  type: "complete_items";
  kind: "tabs" | "bookmarks" | "engines" | "open" | "windows";
};

// From the command line page when the row key unloads or loads one tab of the list. The answer is undefined unless the sender is a tab whose line redeemed a ticket
// and `tab_id` is a tab of the sender's own privacy. `item` is the tab as it is now, `refusal` says why it did not change.
export type SetTabUnloaded = {
  type: "set_tab_unloaded";
  tab_id: number;
  unloaded: boolean;
};

export type SetTabUnloadedAnswer = { item: TabItem; refusal?: string };

// A tab's container, drawn as a mark in the container's color. Absent for the default container and for private tabs.
export type TabContainer = { color: string; icon: string };

// `id` is the browser's tab id, which the row key sends back in `set_tab_unloaded`. `number` is the tab's place in its window's tab bar, counted from 1. `favicon` is an http, https or short data: URL and is absent otherwise.
// The flags are present only when true, which keeps the answer small.
export type TabItem = {
  id: number;
  number: number;
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

// `label` is the config's resolved chain. `available` is whether the line's page can fill the engine's slots. The page URL itself never leaves the background.
export type EngineItem = { name: string; label: string; available: boolean };

// A history entry as the background reads it. It never goes to the page on its own: `open` answers with `OpenRow`.
export type HistoryItem = { title: string; url: string };

// Where an `open` row came from: `bm` is a bookmark, `hist` is history.
export type OpenTag = "bm" | "hist";

export type OpenRow = { title: string; url: string; tag: OpenTag };

// Every row, in the group order of the `open_completion` setting and without a duplicate address. The page caps an empty word: 20 bookmarks and `history_max` history rows.
export type OpenItems = { rows: OpenRow[]; history_max: number };

// `number` is the window's place in `windows.getAll`, counted from 1, so it stays when other windows drop out of the list. `title` is its active tab's.
export type WindowItem = { number: number; title: string };

// A heading of the page, from the host script. `level` is 1 to 6, `text` is the rendered text, trimmed.
export type HeadingItem = { level: number; text: string };

export type CompleteItemsAnswer = { items: TabItem[] | BookmarkItem[] | EngineItem[] | OpenItems | WindowItem[] | HeadingItem[] };

// From the `hints` bundle at the start of a pick: what `.` shows again. The background checks it like any page message, because the sender is a page script.
export type RecordRepeat = {
  type: "record_repeat";
  invocation: BoundInvocation;
};

// From the command line page when the user asks for help on a command, by link or by key. The background opens the help page
// at that command's card, and only for a tab whose line redeemed a ticket.
export type OpenHelp = {
  type: "open_help";
  command_id: string;
};

export type ContentToBackground = RunRequest | ModeChanged | LoadBundle | ListKeys | IssueCmdlineTicket | OpenCmdline | RecordCmdline | CompleteItems | SetTabUnloaded | OpenHelp | RecordRepeat;

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

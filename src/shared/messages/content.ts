// Messages that content scripts, bundles and the command line page send to the background with `runtime.sendMessage`. The `type` field selects the shape.

import type { BundleName } from "../bundles.ts";
import type { CommandMeta, Mode } from "../command.ts";
import type { WhichKeyBorder } from "../config.ts";
import type { Settings } from "../settings_table.ts";
import type { BoundInvocation, Invocation } from "../invocation.ts";
import type { TreeLeaf } from "../prefix_tree.ts";
import type { HintFramesCollect, HintFramesLabels } from "./tab.ts";

// Why a command did not run. The content script shows `message` as a toast,
// the background falls back to a notification where no content script exists.
export type Refusal = {
  id: string;
  message: string;
};

export type RunRequest = {
  type: "run";
  // Runs in order. Tab and frame come from the message sender.
  invocations: BoundInvocation[];
  mode: Mode;
  // Set by the hints bundle on its link opens, so `.` keeps showing hints. The background honors it for a lone `open.url` only.
  from_hints?: true;
  // Set by the command line host. A line that draws in the top frame for a subframe's keys runs the command in that subframe.
  from_line?: true;
};

// `focus` says whether the frame's own document holds the keyboard focus. The tab shows the mode of the frame that does.
// `step` says that a media step or a join reply put the frame in the media mode, so the report must not start a hold (`tab_media.ts`).
// `activated` says the frame's window has had a click or key, and `in_field` that its focused element takes typing. A frame of another site with neither, at its first focus, is parked (`tab_modes.ts`).
export type ModeChanged = {
  type: "mode_changed";
  mode: Mode;
  focus: boolean;
  step: boolean;
  activated: boolean;
  in_field: boolean;
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
  // The page's address now (`location.href`). `sender.url` stays the address the document loaded at, so rows match against this.
  url: string;
};

// Asks what `.` would repeat, for the which-key panel footer. The answer is the step as text, or undefined when there is none, the setting is off or the tab is private.
export type ReadRepeatPreview = {
  type: "read_repeat_preview";
};

// What the panel shows: the chain of group names that leads here (empty when there is no panel) and the keys that can follow.
// `repeat` is the step `.` would run. The background leaves it out of this answer: the panel bundle adds it from a `read_repeat_preview` answer.
export type WhichKeyPanel = { title: string[]; rows: WhichKeyRow[]; border: WhichKeyBorder; repeat?: string };

// One key that can follow a prefix. A key that starts a longer sequence has `more` and no description.
export type WhichKeyRow = {
  keys: string;
  command: string;
  description: string;
  more: boolean;
  // The guarded leaf of a key with `when_focus` or `when_present`. The background has no page, so the which-key bundle runs `leaf_for_page` on it to hide the row or relabel it.
  chain?: TreeLeaf;
};

// From the `cmdline` host script when it mounts the line. The answer is a one-time ticket, or undefined outside a tab.
// `target_frame` is the frame whose keys opened a line that draws in the top frame: a command run from that line acts there.
export type IssueCmdlineTicket = {
  type: "issue_cmdline_ticket";
  target_frame?: number | undefined;
};

// A frame asks the background to run one handler of a bundle in the top frame (`to: "top"`) or in another frame of its tab. Only the handlers `relay_plan` knows pass, each in its own direction. The background adds `from_frame` to the args.
export type Relay = {
  type: "relay";
  to: "top" | number;
  id: string;
  args: Record<string, unknown>;
};

// The extension is about to focus a frame (`;ff`, a hint pick): that frame is not parked at its first focus, and `;ff` also shows the one-time toast in the top frame.
export type FrameCue = {
  type: "frame_cue";
  // Whether the top frame shows the toast. A `here` pick or a pick inside the frame marks the entry and shows none.
  toast: boolean;
};

// From the command line page when it opens: asks for the history, the commands, and the lists the grammar needs to read bare words.
// The answer is undefined unless `ticket` is one the host got for this tab and nobody used yet.
// `cmdline.html` is web-accessible, so any site can embed its own copy, and that copy must get nothing.
export type OpenCmdline = {
  type: "open_cmdline";
  ticket: string;
  // The mode the line opened from, which picks the keys column.
  mode?: string;
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
  // The names of the theme files and imported themes that are not built-in, which `set theme` offers after the generated built-in list.
  theme_names: string[];
  // The font names `set font_family` and `set font_family_mono` offer, ready from the background's cache.
  font_names: string[];
  // The commands with a card on the help page, which are the built-in ones. A snippet has none.
  help_ids: string[];
  // The `cmdline_prompt` setting. Absent keeps the page's own default.
  prompt?: string;
  // The window of the line's tab and the `completion_all_windows` setting, which the page needs to filter the tab model's rows.
  window_id: number;
  all_windows: boolean;
  // The `statusbar_widgets` setting, in display order.
  statusbar_widgets: Settings["statusbar_widgets"];
  // The keys column: command id to the keys that run it bare in the mode the line opened from (`key_labels`).
  keys: Record<string, string>;
  // What the widgets show, taken when the line opens. `tab_index` is zero-based and `tab_count` covers the line's window.
  status: { url: string; tab_index: number; tab_count: number };
};

// From the command line page when typed text parsed. The background keeps it in the history unless the tab is private.
export type RecordCmdline = {
  type: "record_cmdline";
  text: string;
};

// From the command line page when the subject of `bookmark`, `tab.attach`, or the engine word of `search`, needs its list. The tab list reads the tab model port instead. The answer is undefined unless the
// sender is a tab whose line redeemed a ticket, and it holds only tabs and windows of the sender's own privacy (private or not).
export type CompleteItems = {
  type: "complete_items";
  kind: "bookmarks" | "engines" | "windows" | "sessions" | "registers" | "folders" | "marks" | "quickmarks" | "saved_quickmarks" | "quality_levels";
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

// `id` is the browser's tab id, which the row keys send back in `tab_rows_action`. `number` is the tab's place in its window's tab bar, counted from 1. `favicon` is a data: URL of at most 32768 characters and is absent otherwise.
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
  split?: true;
};

// How much use raises a row's match score, see `Candidate.boost` in `shared/score.ts`. The background sends it, absent when 0.
export type Boosted = { boost?: number };

// Newest first.
export type BookmarkItem = { title: string; url: string } & Boosted;

// A bookmark row of the `bookmark` list. `folders` indexes `BookmarkRows.folders`, the newest copy's folder first.
export type BookmarkRow = BookmarkItem & { folders: number[] };

// The `bookmark` list: one row per address, and the folder paths sent once for the rows to point at.
export type BookmarkRows = { rows: BookmarkRow[]; folders: string[] };

// `label` is the config's resolved chain. `available` is whether the line's page can fill the engine's slots. The page URL itself never leaves the background.
export type EngineItem = { name: string; label: string; available: boolean; keyword?: string };

// A history entry as the background reads it. It never goes to the page on its own: `open` answers with `OpenRow`.
export type HistoryItem = { title: string; url: string } & Boosted;

// Where an `open` row came from: `bm` is a bookmark, `hist` is history.
export type OpenTag = "bm" | "hist";

export type OpenRow = { title: string; url: string; tag: OpenTag } & Boosted;

// The home page of a visited host, offered as its own row when the typed word starts a label of the host. The boost sums the use of every page of the host.
export type SiteItem = { url: string; boost: number };

// Every row, in the group order of the `open_completion` setting and without a duplicate address. The page caps an empty word: 20 bookmarks and `history_max` history rows.
export type OpenItems = { rows: OpenRow[]; history_max: number; sites: SiteItem[] };

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

// What the finder lists besides the open tabs, which come from the tab model. `quickmarks` hold the full address, in key order. Bookmarks, history and closed tabs are newest first.
// A private line gets quickmarks and bookmarks only: the history and the closed tabs of a normal window stay out of it.
export type ClosedTabRow = { session_id: string; title: string; url: string } & Boosted;
// `tab_used` maps a tab id to its `lastAccessed` (ms), read once when the line opens, for the empty-query order. The tab model's rows hold no such time. `tab_boost` maps a tab id to its boost.
export type AnythingItems = { tab_used: Record<number, number>; tab_boost: Record<number, number>; sites: SiteItem[]; quickmarks: ({ key: string; url: string } & Boosted)[]; bookmarks: BookmarkItem[]; history: HistoryItem[]; closed: ClosedTabRow[]; history_max: number };

export type CompleteItemsAnswer = { items: BookmarkRows | BookmarkItem[] | EngineItem[] | WindowItem[] | HeadingItem[] | SessionItem[] | RegisterItem[] | FolderItem[] };

// A mark that a which-key row lists: its key and the scroll offset it keeps, in px. A global mark also carries its address.
export type MarkItem = { key: string; x: number; y: number; url?: string };

// From the `page` bundle. `x` and `y` are the scroll offset now. A set stores them under `key`. A jump answers the offset stored under `key` and stores the offset now as the previous position (`'`), unless the mark is missing. The page's privacy is the sender tab's.
export type MarkSet = { type: "mark_set"; key: string; url: string; x: number; y: number };
// `arrival` names the global mark jump the background pushed into the tab it went to, as in `JumpStep`.
export type MarkJump = { type: "mark_jump"; key: string; url: string; x: number; y: number; arrival?: number };
export type MarkRequest = MarkSet | MarkJump;
// From the `page` bundle. Answers the offset of the nearest mark of this page below (`next`) or above (`prev`) the scroll offset `y`, or the one `steps` marks on (the last one when there are fewer), and stores nothing.
export type MarkStep = { type: "mark_step"; direction: "next" | "prev"; steps: number; url: string; x: number; y: number };
// Without `x` the background does the scroll itself, after it switched to or opened the tab of a global mark.
export type MarkAnswer = { ok: true; x: number; y: number } | { ok: true; x?: undefined; y?: undefined } | { ok: false; message: string };

// From the `page` bundle, for the jump list of the sender's window. `x` and `y` are the scroll offset now.
// A push (from the leave watch of the `page` or `hints` bundle) records the place a single-page app left as it changed its address in place. `url` is the address left, because the tab may already show the new one. A step moves the cursor of the list by `step` (older when negative) and answers the entry there, from the sender tab's address: with `x` the page scrolls to it, without `x` the background switched to another tab or opened the address and scrolls from there.
export type JumpPush = { type: "jump_push"; url: string; x: number; y: number };
// `arrival` names the step the background pushed into the tab it went to. Only that step's request takes the entry the step already chose.
export type JumpStep = { type: "jump_step"; step: number; x: number; y: number; arrival?: number };
export type JumpRequest = JumpPush | JumpStep;
// From the `page` or `hints` bundle as the page goes away: the offset it left. The background pushes it when the tab went to another address.
// `url` is the address the page shows, which a single-page app may have changed since the document loaded.
export type JumpLeave = { type: "jump_leave"; url: string; x: number; y: number };
export type JumpAnswer = MarkAnswer;

// From the `caret` bundle: one register read or write. The background answers by the sender tab's privacy. A read answers the value, or nothing for an empty register and a refused name. A write answers an `Outcome`. A content script writes text only.
export type RegisterRead = { type: "register_read"; name: string };
export type RegisterWrite = { type: "register_write"; name: string; text: string };
// A yank: the text goes to the named register, if any (`""` names none), and to the unnamed one. A black hole name drops it.
export type RegisterYank = { type: "register_yank"; name: string; text: string };
export type RegisterRequest = RegisterRead | RegisterWrite | RegisterYank;

// From the `editor` bundle: the focused field's text to edit outside the browser. `token` names this page's pending edit, `ext` is the command's own extension (else the background resolves the site's `editor_ext`). The answer is `EditorAnswer`.
// `url` is the page address now, as in `ListKeys`.
export type EditorOpen = { type: "editor_open"; token: string; text: string; ext?: string; insert: boolean; url?: string };
export type EditorAnswer = { ok: true } | { ok: false; message: string };

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
  // Set on a frame's first ask only, when it starts in normal mode with no editable focus: only such a frame may join a hold. A re-ask, or a frame in another mode, must not be written into one.
  join: boolean;
  // The page address now, as in `ListKeys`. A re-ask after an in-place address change (pushState, history traversal, a hash change) matches the rows of the new address.
  url: string;
};

// Sent by a page held for a macro replay. Answered when the outermost replay ends: ok when it finished, not ok when a step failed, a pick was cancelled or Escape stopped it. Answered at once when no replay runs.
export type ReplayEnd = {
  type: "replay_end";
};

// Escape while a macro replays: the replay stops before its next step and drops the keys typed during it.
export type ReplayStop = {
  type: "replay_stop";
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

// From the `hints` bundle when `hint.run` starts. The answer holds the frame's `hint_add` and `hint_remove`, each only when it is not empty, resolved against the frame's own address.
export type ReadHintSelectors = {
  type: "read_hint_selectors";
  // The page address now, as in `ListKeys`.
  url: string;
};

// From the page and hints bundles before a copy of a web address. The answer is the `strip_tracking_params` names to drop, empty when the site's `strip_tracking` is off, resolved against `address`, the address of the frame holding what is copied.
export type ReadStripPatterns = {
  type: "read_strip_patterns";
  address: string;
};


// From `;M`: the frame that sent it holds the pinned video. See `src/background/tab_media.ts`.
export type MediaPin = { type: "media_pin" };

// The cross-frame hints of `hint --frames=all_frames`, one session per tab. See `src/background/hint_frames.ts`.
// The keyboard frame starts it. The answer is a `HintFramesStartAnswer`, once every frame reported or the wait ran out.
export type HintFramesStart = {
  type: "hint_frames_start";
  // The `hint_letters` setting as the keyboard frame read it.
  letters: string;
  // The checked `hint.run` args, which every frame finds its candidates with.
  args: Record<string, unknown>;
  // How many candidates the keyboard frame found, best first. It reports here and ignores the collect, so its own labels never race the wait.
  count: number;
  // The text of each of those candidates, same order and length as `count`, "" for none. Text mode ranks them, and they go no further than the background's wait.
  texts: string[];
};

// `labels` is every label of the session in label order, for the keyboard frame to narrow, and `texts` the candidate texts of every frame, aligned with `labels`. `own_labels` are the keyboard frame's own, for its first candidates. Every other frame gets its share in a `HintFramesLabels`. An ended answer means a newer run, a navigation or a closed tab ended the session first.
export type HintFramesStartAnswer = { ok: true; session_id: string; labels: string[]; own_labels: string[]; texts: string[] } | { ok: false; reason: "ended" };

// From each frame in answer to a `HintFramesCollect`: how many candidates the frame found, best first. A report after the wait gets no labels.
export type HintFramesReport = {
  type: "hint_frames_report";
  session_id: string;
  count: number;
  // The text of each candidate, aligned with the count, "" for none.
  texts: string[];
};

// The keyboard frame's typed prefix, which the background passes on to every other labeled frame.
export type HintFramesTyped = {
  type: "hint_frames_typed";
  session_id: string;
  typed: string;
  // Text mode only: `typed` is "/", `matches` the labels that match the text, best first, and `active` the one Enter picks. A frame hides its labels outside `matches`.
  matches?: string[];
  active?: string | undefined;
};

// The keyboard frame's complete label, which the background passes on to the frame that owns it. The answer is a `HintFramesPickAnswer`.
export type HintFramesPick = {
  type: "hint_frames_pick";
  session_id: string;
  label: string;
  // The keys typed before the labels showed, which the owner types into the field the pick focuses. Left out for a rapid pick, which keeps them for its next build.
  keys?: string[];
};

// The owner frame's answer to a pick. A copy or a `prompt` does not run there: the owner answers with the text (the copy text, or the whole line for `prompt`, tracking parameters already stripped), and `what` names it for the toast when it is not the text itself. The keyboard frame then copies it into its rapid list or opens the line, so one list holds the picks of every frame and the toast draws where the keyboard is. Any other action answers its `Outcome`.
// `left` is the part of the pick's `keys` the owner did not type, in order. An answer without it leaves all of them to the keyboard frame.
export type HintFramesPickAnswer = (Outcome | { ok: true; text: string; what?: string }) & { left?: string[] };

// The keyboard frame left hint mode. The background passes it on to every frame of the tab.
export type HintFramesEnd = {
  type: "hint_frames_end";
  session_id: string;
};

// The keyboard frame's Escape after a hover pick of another frame. The background passes it on to every frame of the tab. `session_id` is the session of that pick, which ended with it, and the frame whose hover that pick made releases it. A frame hovered by a later pick keeps its hover.
export type HintFramesUnhover = {
  type: "hint_frames_unhover";
  session_id: string;
};

// From the `hints` bundle once the labels are shown: how long finding and labeling took. Kept for `debug.perf`.
export type RecordTiming = { type: "record_timing"; name: string; ms: number };


// How a command ended. Done is `{ ok: true }`. A handler that returns nothing is done, and one that throws is failed.
// Cancelled means the user left a waiting step (Escape, an unrelated key, a page change), so the rest of a sequence does not run and nothing is shown.
export type Outcome = { ok: true; cancelled?: true } | { ok: false; message: string };

export type RunResponse = { ok: true; cancelled?: true } | { ok: false; refusal: Refusal };

// Sent by `desertfox.run` inside a snippet. `depth` is the level of the calling snippet.
export type SnippetCall = { type: "snippet_run"; command_text: string; depth: number };

export type SnippetAnswer = { ok: true } | { ok: false; message: string };

// Every message a frame of a hint session receives or sends on its own.
export type HintFramesMessage = HintFramesCollect | HintFramesLabels | HintFramesTyped | HintFramesPick | HintFramesEnd | HintFramesUnhover;

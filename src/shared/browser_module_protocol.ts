// The channel between the extension and the browser module, an optional script that Firefox loads with browser privileges (see docs/design/host.md, "Browser module").
// The extension writes the state and reads the hello, both in its own `storage.session`. The module is a thin executor: it receives only typed rows (a fixed command id with checked args) and never code, selectors or URLs.
// The module file holds a copy of the names and the version, and a test keeps the copy equal to this file.

import { MODES } from "./command.ts";
import type { Mode } from "./command.ts";
import type { ContentRequests } from "./messages/map.ts";
import type { ToastKind } from "./messages/tab.ts";
import { BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, BROWSER_MODULE_SNAPSHOT_KEYMAP_STORAGE_KEY, BROWSER_MODULE_SNAPSHOT_THEME_STORAGE_KEY, BROWSER_MODULE_SNAPSHOT_WHICH_KEY_STORAGE_KEY } from "./config/storage_keys.ts";
import { BROWSER_BAR_BORDERS, BROWSER_BAR_WIDGETS } from "./browser_bar_lists.ts";
import { MODULE_FIREFOX_PAGES } from "./firefox_pages.ts";
import type { WhichKeyBorder } from "./config.ts";

// The major version. It moves only for a breaking change, and a different value means the module claims nothing. Anything added later is an optional field that validators ignore when they do not know it.
export const BROWSER_MODULE_PROTOCOL_VERSION = 1;

// The three keys sit in `config/storage_keys.ts` with the others: the state (the extension writes it while the setting is on, the module reads it), the hello (the module writes it, the extension reads it) and the status (what became of the last hello, for the settings page). The module also writes the from-module message list, below. These two are all that the module sends.
export { BROWSER_MODULE_HELLO_STORAGE_KEY, BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY, BROWSER_MODULE_STATE_STORAGE_KEY, BROWSER_MODULE_STATUS_STORAGE_KEY } from "./config/storage_keys.ts";

export const MAX_KEY_ROWS = 32;
export const MAX_STATE_TABS = 1024;
export const MAX_KEY_CHARS = 24;
export const MAX_HELLO_BYTES = 256;
export const MAX_MESSAGES = 16;
export const MAX_MESSAGE_LIST_BYTES = 4096;
export const MAX_MESSAGE_ID_CHARS = 32;
export const MAX_ERROR_CHARS = 120;
export const MAX_MODULE_VERSION_CHARS = 32;
// The status bar's per-tab fields. They are sized to stay small beside the key rows: a tab with every field set adds under 300 bytes.
export const MAX_PENDING_KEYS = 8;
export const MAX_PENDING_TOKEN_CHARS = 16;
export const MAX_SITE_LABEL_CHARS = 24;
export const MAX_COUNT = 999999;
// The extension reads the hello at most this often.
export const HELLO_MIN_INTERVAL_MS = 1000;
// The extension reads the module's message list at most this often. It is short because a call the module starts, such as a key on a locked page, must not wait a second. The list is capped, so a read is cheap.
export const MESSAGE_MIN_GAP_MS = 50;

// `text` is any string. The kind's `max_bytes` bounds it.
// `optional_int` is a whole number or absent, so a kind row can grow an arg an older sender leaves out.
// `firefox_page` is a name from MODULE_FIREFOX_PAGES. `optional_open_where` is absent, "tab" or "here".
type ArgKind = "int" | "optional_int" | "number" | "axis" | "text" | "step" | "region" | "direction" | "page_hint_action" | "devtools_keys" | "devtools_visual_keys" | "firefox_page" | "optional_open_where";

export const PANE_REGIONS = ["sidebar", "page", "split", "devtools"] as const;
export const MAX_RESIZE_STEPS = 20;
export const PANE_DIRECTIONS = ["left", "right"] as const;
// What a pick does in a hint session on one of Firefox's own pages: click or focus the target, or, for a link to a web address only, open it in a tab or a background tab, or copy it. The module reads the address itself, so none crosses the channel.
export const PAGE_HINT_ACTIONS = ["follow", "tab", "background", "yank"] as const;
export type PageHintAction = (typeof PAGE_HINT_ACTIONS)[number];
// Where the module opens a Firefox page: a tab after the one that asked, or that tab itself.
export const FIREFOX_PAGE_WHERE = ["tab", "here"] as const;

// The keys the module takes in DevTools, as data: a one-character key and an action from a fixed list. The module turns each tree action into an arrow key on the focused DevTools element, so the table can do no more than the arrow keys do. A one-character key never carries a modifier, so no DevTools shortcut and no Escape can be claimed.
// `hints.start` asks the extension for hints over DevTools (`devtools_hints.ask`). `visual.start` starts visual mode in the focused DevTools text area.
export const DEVTOOLS_ACTIONS = ["tree.down", "tree.up", "tree.collapse", "tree.expand", "hints.start", "visual.start"] as const;
export type DevtoolsAction = (typeof DEVTOOLS_ACTIONS)[number];
export type DevtoolsKeyRow = { key: string; action: DevtoolsAction };
export const MAX_DEVTOOLS_KEY_ROWS = 8;
export const DEVTOOLS_TREE_KEYS: DevtoolsKeyRow[] = [
  { key: "j", action: "tree.down" },
  { key: "k", action: "tree.up" },
  { key: "h", action: "tree.collapse" },
  { key: "l", action: "tree.expand" },
];
// Pushed only to a module whose hello says `devtools_hints`: a module before it refuses a table with an action it does not know, and would lose the tree keys too.
export const DEVTOOLS_HINT_KEY: DevtoolsKeyRow = { key: "f", action: "hints.start" };
// Pushed only to a module whose hello says `devtools_visual`, for the same reason.
export const DEVTOOLS_VISUAL_KEY: DevtoolsKeyRow = { key: "v", action: "visual.start" };
// The keys of visual mode in DevTools, a push of their own (`devtools.visual_keys`), so a module before visual mode keeps its tree table. Each op moves the end of the selection or copies it.
// The module copies on its own, so no text ever comes back. Escape ends the mode in the module, as it ends the hints, since a one-character key cannot name it.
export const DEVTOOLS_VISUAL_OPS = ["char.back", "char.forward", "line.down", "line.up", "word.forward", "word.back", "line.start", "line.end", "copy"] as const;
export type DevtoolsVisualOp = (typeof DEVTOOLS_VISUAL_OPS)[number];
export type DevtoolsVisualRow = { key: string; op: DevtoolsVisualOp };
export const MAX_DEVTOOLS_VISUAL_ROWS = 16;
export const DEVTOOLS_VISUAL_KEYS: DevtoolsVisualRow[] = [
  { key: "h", op: "char.back" },
  { key: "l", op: "char.forward" },
  { key: "j", op: "line.down" },
  { key: "k", op: "line.up" },
  { key: "w", op: "word.forward" },
  { key: "b", op: "word.back" },
  { key: "0", op: "line.start" },
  { key: "$", op: "line.end" },
  { key: "y", op: "copy" },
];
const is_devtools_key = (key: unknown): key is string => typeof key === "string" && [...key].length === 1 && !/[\s\p{Cc}\p{Cf}]/u.test(key);

// A table that is not a list, is empty or too long, repeats a key or holds a row of the wrong shape fails whole. A row's unknown fields are ignored.
function devtools_keys_problem(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DEVTOOLS_KEY_ROWS) return `must be a list of 1 to ${MAX_DEVTOOLS_KEY_ROWS} rows`;
  const seen = new Set<string>();
  for (const row of value) {
    if (!is_record(row) || !is_devtools_key(row.key) || !(DEVTOOLS_ACTIONS as readonly unknown[]).includes(row.action) || seen.has(row.key)) return "rows need one-character keys, each once, and an action from the list";
    seen.add(row.key);
  }
  return undefined;
}
const devtools_rows_of = (value: unknown): DevtoolsKeyRow[] => (value as Record<string, unknown>[]).map((row) => ({ key: row.key as string, action: row.action as DevtoolsAction }));

// The same rule for the visual table, with its own ops and cap.
function devtools_visual_keys_problem(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DEVTOOLS_VISUAL_ROWS) return `must be a list of 1 to ${MAX_DEVTOOLS_VISUAL_ROWS} rows`;
  const seen = new Set<string>();
  for (const row of value) {
    if (!is_record(row) || !is_devtools_key(row.key) || !(DEVTOOLS_VISUAL_OPS as readonly unknown[]).includes(row.op) || seen.has(row.key)) return "rows need one-character keys, each once, and an op from the list";
    seen.add(row.key);
  }
  return undefined;
}
const devtools_visual_rows_of = (value: unknown): DevtoolsVisualRow[] => (value as Record<string, unknown>[]).map((row) => ({ key: row.key as string, op: row.op as DevtoolsVisualOp }));

// The commands the module may run and the shape of each arg. The command schema owns limits and defaults: the extension fills and checks them through the one validator (`check_args`) before it writes a row, so a row always holds every arg. The module checks the shape only.
export const MODULE_COMMAND_ARGS = {
  "tab.next": {},
  "tab.prev": {},
  "scroll.lines": { count: "int" },
  "scroll.pixels": { dx: "int", dy: "int" },
  "scroll.pages": { fraction: "number", count: "int" },
  "scroll.to": { percent: "number", axis: "axis" },
  "page.stop": {},
} as const satisfies Record<string, Record<string, ArgKind>>;

// The commands of Firefox's own sidebar. The module runs them only with the focus in the vertical tab strip or in the history, bookmarks or open tabs panel. None takes args.
export const SIDEBAR_COMMAND_IDS = ["sidebar.down", "sidebar.up", "sidebar.first", "sidebar.last", "sidebar.open", "sidebar.expand", "sidebar.collapse", "sidebar.close_item", "sidebar.filter", "sidebar.leave"] as const;
export type SidebarCommandId = (typeof SIDEBAR_COMMAND_IDS)[number];
export const is_sidebar_command_id = (id: unknown): id is SidebarCommandId => (SIDEBAR_COMMAND_IDS as readonly unknown[]).includes(id);
// `gg` needs two keys. The module holds one pending key, so no row is longer.
export const MAX_SIDEBAR_KEY_TOKENS = 2;
export type SidebarKeyRow = { keys: string[]; id: SidebarCommandId };
// The command whose bindings the module takes with the focus in Firefox's own dialogs, windows and panels, where no content script hears a key. It starts the hints over that place.
export const CHROME_HINT_COMMAND_ID = "hint.browser";
export const MAX_CHROME_HINT_BINDINGS = 4;
export const MAX_CHROME_HINT_KEY_TOKENS = 4;

export type ModuleCommandId = keyof typeof MODULE_COMMAND_ARGS;
export const MODULE_COMMAND_IDS = Object.keys(MODULE_COMMAND_ARGS) as ModuleCommandId[];

export type ModuleArgs = Record<string, number | string | DevtoolsKeyRow[] | DevtoolsVisualRow[]>;
export type KeyRow = { key: string; id: ModuleCommandId; args: ModuleArgs };
// What the status bar shows of a tab beyond its mode, all optional. `pending` holds the keys of a half-typed sequence (a held group included), `count` a typed count, `pass` that pass-next is armed, `site` the label of a site mode and `recording` the register a macro records into. A private tab never has `site`.
export type BarFields = { pending?: string[]; count?: number; pass?: true; site?: string; recording?: string };
// A message in the bar's slot for the tab: `until` is epoch milliseconds, and the module stops drawing it then. `id` counts up, so a repeat of the same text draws again. The extension writes it, and a page never reports one.
export type BarToast = { id: number; text: string; kind: ToastKind; until: number };
export type TabState = { mode: Mode; live: boolean; toast?: BarToast } & BarFields;
export const MAX_TOAST_CHARS = 200;
const TOAST_KINDS: readonly string[] = ["error", "warning", "info", "success"] satisfies ToastKind[];
// The roles the bar's mode badge takes from the theme, for the dark and the light scheme.
// The which-key panel takes `bg_core`, `fg_core`, `primary` and `secondary`. An older module reads only the roles it knows.
export const BAR_ROLES = ["bg_core", "mode_normal", "mode_insert", "mode_ignore", "mode_caret", "mode_visual", "mode_item", "mode_media", "fg_core", "primary", "secondary"] as const;
// Each optional role is dropped unless it is a color, so a state from an older extension still validates. Without `mode_command` the module uses the normal color, and without a toast role it uses the color of the page's toast.
export const BAR_OPTIONAL_ROLES = ["mode_command", "error", "warn", "info", "ok"] as const;
export type BarRole = (typeof BAR_ROLES)[number];
export type BarColors = Record<BarRole, string> & Partial<Record<(typeof BAR_OPTIONAL_ROLES)[number], string>>;
export type BarTheme = { dark: BarColors; light: BarColors };
// What the settings say about the bar. The state carries it only while `browser_bar` is on, so its absence tells the module not to draw.
export type BarWidget = (typeof BROWSER_BAR_WIDGETS)[number];
export type BarConfig = { left: BarWidget[]; right: BarWidget[]; border: (typeof BROWSER_BAR_BORDERS)[number] };
// `blur_on_load` is the setting of that name, so the module takes the focus out of a field a locked page focused as it loaded. Absent means off.
// `page_hints` says the extension answers `page_hints.want`, so the module may start hints on Firefox's own pages. Without it the hint keys there keep the notice.
// `which_key` holds the which-key panels of the tree, drawn by the module where no DesertFox page code runs.
export type ModuleState = { v: number; enabled: boolean; keys: KeyRow[]; tabs: Record<string, TabState>; bar_theme?: BarTheme; bar?: BarConfig; blur_on_load?: boolean; tree?: ScopeTree; sidebar_keys?: SidebarKeyRow[]; chrome_hint_keys?: string[][]; page_hints?: true; which_key?: WhichKeyTable };
// The normal-mode keys DesertFox runs on a locked page, as a prefix tree the module matches with `src/shared/keys/matcher.ts` (see `src/shared/browser_module_scope.ts`). `keys` stays beside it for a module that predates the tree.
// A leaf is `forward`, which the module sends back as a `run` request with the keys it matched, or a command the module runs itself with its args. A forward leaf holds no command, so a module never learns more than which keys to take.
export type NativeLeaf = { native: ModuleCommandId; args: ModuleArgs; count_rule?: "repeat" | { param: string } };
export type ScopeNode = "forward" | NativeLeaf | ScopeTree;
// `line_keys`, on the root only: the key paths (tokens joined by one space) of the forward leaves that open the command line. After one of them the module holds the keys that follow until the line has the focus, so they never run on the page. An older module ignores the field.
// `hint_keys`, on the root only: the key paths of the hint leaves, which need page code and so are not in the tree. Where hints cannot run now, the module claims them and sends the first one as a `run`, so the extension says why. An older module ignores the field.
export type ScopeTree = { children: Record<string, ScopeNode>; line_keys?: string[]; hint_keys?: string[] };
// The longest key sequence the tree holds and a run request names. A count is no key of it.
export const MAX_SEQUENCE_KEYS = 8;
// The default keymap's tree is about 4 KB as JSON and one with 400 more three-key sequences about 18 KB (test/browser_module_scope.test.ts measures both). The cap leaves room above that.
export const MAX_TREE_BYTES = 32 * 1024;
// The which-key panel of each branch of the tree, keyed by its path (tokens joined by one space), the root left out. Built from the same rows the page's panel shows (`panel_after_prefix`), so the module draws text and never learns a command. A row has no description: the page shows it on hover, and the module's panel takes no pointer.
// `delay_ms` and `skip` are the settings `which_key_delay_ms` and `which_key_skip`, `border` is `which_key_border`. A delay of 0 turns which-key off, and the field is left out.
export type WhichKeyTableRow = { keys: string; command: string; more?: true };
export type WhichKeyTablePanel = { title: string[]; rows: WhichKeyTableRow[] };
export type WhichKeyTable = { delay_ms: number; skip?: string[]; border: WhichKeyBorder; panels: Record<string, WhichKeyTablePanel> };
// The default table is about 8 KB (test/background/browser_module_which_key.test.ts measures it). A table over a limit is left out, and the module draws no panel.
export const MAX_WHICH_KEY_BYTES = 49_152;
export const MAX_WHICH_KEY_PANELS = 64;
export const MAX_WHICH_KEY_ROWS = 80;
export const MAX_WHICH_KEY_TITLE_PARTS = MAX_SEQUENCE_KEYS;
export const MAX_WHICH_KEY_LABEL_CHARS = 60;
export const MAX_WHICH_KEY_SKIP = 64;
export const MAX_WHICH_KEY_DELAY_MS = 60_000;
export const WHICH_KEY_BORDERS = ["square", "round", "chamfer"] as const satisfies readonly WhichKeyBorder[];
// `bar` says the module built its status bar. `devtools_hints` says it runs hints in DevTools, so it may get the `hints.start` row. `devtools_visual` says it runs visual mode there, so it may get the `visual.start` row and the visual table. `bar_message` says the bar draws the `toast` of a tab, so a module without it keeps the desktop notice. `page_hints` says it runs hints on Firefox's own pages. `firefox_pages` says it answers `firefox_page.open`.
export type ModuleHello = { v: number; module_version: string; bar?: true; bar_message?: true; devtools_hints?: true; devtools_visual?: true; page_hints?: true; firefox_pages?: true };

// What the module takes for a tab id the state does not list.
export const ABSENT_TAB: TabState = { mode: "normal", live: false };
export const tab_state_in = (state: ModuleState, tab_id: number | string): TabState => state.tabs[String(tab_id)] ?? ABSENT_TAB;

export type Checked<T> = { ok: true; value: T } | { ok: false; problem: string };
const bad = (problem: string): { ok: false; problem: string } => ({ ok: false, problem });

const is_record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const is_module_command_id = (id: unknown): id is ModuleCommandId => typeof id === "string" && Object.hasOwn(MODULE_COMMAND_ARGS, id);
const is_message_id = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= MAX_MESSAGE_ID_CHARS && /^[A-Za-z0-9_-]+$/.test(id);
// One normalized key token: a character, or a name in angle brackets. No spaces or control characters.
const is_key_token = (key: unknown): key is string => typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_CHARS && !/[\s\p{Cc}\p{Cf}]/u.test(key);

function arg_problem(kind: ArgKind, value: unknown): string | undefined {
  if (kind === "devtools_keys") return devtools_keys_problem(value);
  if (kind === "devtools_visual_keys") return devtools_visual_keys_problem(value);
  if (kind === "text") return typeof value === "string" ? undefined : "must be text";
  if (kind === "axis") return value === "x" || value === "y" ? undefined : "must be x or y";
  if (kind === "region") return PANE_REGIONS.some((region) => region === value) ? undefined : `must be one of ${PANE_REGIONS.join(", ")}`;
  if (kind === "direction") return PANE_DIRECTIONS.some((direction) => direction === value) ? undefined : `must be one of ${PANE_DIRECTIONS.join(", ")}`;
  if (kind === "page_hint_action") return PAGE_HINT_ACTIONS.some((action) => action === value) ? undefined : `must be one of ${PAGE_HINT_ACTIONS.join(", ")}`;
  if (kind === "firefox_page") return MODULE_FIREFOX_PAGES.some((page) => page === value) ? undefined : "must be a page from the list";
  if (kind === "optional_open_where") return value === undefined || FIREFOX_PAGE_WHERE.some((where) => where === value) ? undefined : `must be one of ${FIREFOX_PAGE_WHERE.join(", ")}`;
  if (kind === "optional_int" && value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
  if (kind === "step") return Number.isInteger(value) && value !== 0 && Math.abs(value) <= MAX_RESIZE_STEPS ? undefined : `must be a whole number of 1 to ${MAX_RESIZE_STEPS} steps, either way`;
  return (kind === "int" || kind === "optional_int") && !Number.isInteger(value) ? "must be a whole number" : undefined;
}

// Returns the args the command takes, each of the right shape, or the first problem. A name the command does not take is ignored, so a newer extension can add an optional arg.
export function check_module_args(id: ModuleCommandId, args: unknown): Checked<ModuleArgs> {
  const kinds: Record<string, ArgKind> = MODULE_COMMAND_ARGS[id];
  if (!is_record(args)) return bad("args must be a table");
  const picked: ModuleArgs = {};
  for (const [name, kind] of Object.entries(kinds)) {
    const problem = arg_problem(kind, args[name]);
    if (problem !== undefined) return bad(`${id} ${name} ${problem}`);
    picked[name] = args[name] as number | string;
  }
  return { ok: true, value: picked };
}

// A row needs `key`, `id` and the args its command requires. Unknown fields are ignored: the protocol stays backward compatible, and `v` moves only for a breaking change.
function check_key_row(row: unknown): Checked<KeyRow> {
  if (!is_record(row)) return bad("a key row must be a table");
  if (!is_key_token(row.key)) return bad("a key row needs a key token");
  if (!is_module_command_id(row.id)) return bad("a key row names a command the module does not run");
  const args = check_module_args(row.id, row.args);
  if (!args.ok) return args;
  return { ok: true, value: { key: row.key, id: row.id, args: args.value } };
}

// The capture child of a branch (`ANY_KEY` in prefix_tree.ts) has the empty token.
function tree_problem(node: unknown, depth: number): string | undefined {
  if (!is_record(node) || !is_record(node.children)) return "a tree branch needs its children";
  if (depth >= MAX_SEQUENCE_KEYS) return "the tree is too deep";
  for (const [token, child] of Object.entries(node.children)) {
    if (token !== "" && !is_key_token(token)) return "a tree key is not a key token";
    if (child === "forward") continue;
    if (is_record(child) && "native" in child) {
      if (!is_module_command_id(child.native) || !check_module_args(child.native, child.args).ok) return "a native leaf names a command the module does not run";
      const rule = child.count_rule;
      if (rule !== undefined && rule !== "repeat" && !(is_record(rule) && typeof rule.param === "string" && Object.hasOwn(MODULE_COMMAND_ARGS[child.native], rule.param))) return "a native leaf has a bad count rule";
      continue;
    }
    const problem = tree_problem(child, depth + 1);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

function key_paths_problem(paths: unknown, name: string): string | undefined {
  if (paths === undefined) return undefined;
  const fits = (path: unknown) => typeof path === "string" && path.split(" ").length <= MAX_SEQUENCE_KEYS && path.split(" ").every(is_key_token);
  return Array.isArray(paths) && paths.every(fits) ? undefined : `the ${name} keys are not key paths`;
}

export function validate_scope_tree(value: unknown): Checked<ScopeTree> {
  const size = json_bytes(value);
  if (size === undefined) return bad("the tree is not plain data");
  if (size > MAX_TREE_BYTES) return bad("the tree is too large");
  const root = value as { line_keys?: unknown; hint_keys?: unknown };
  const problem = tree_problem(value, 0) ?? key_paths_problem(root.line_keys, "line") ?? key_paths_problem(root.hint_keys, "hint");
  return problem === undefined ? { ok: true, value: value as ScopeTree } : bad(problem);
}

const is_color = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value);

// The bar fields a value carries. A field of the wrong shape is left out and never fails the tab, so a bad bar report cannot take the keys down.
export function bar_fields_of(value: Record<string, unknown>): BarFields {
  const fields: BarFields = {};
  const { pending, count, pass, site, recording } = value;
  // A longer sequence shows its last keys.
  if (Array.isArray(pending) && pending.length > 0 && pending.length <= MAX_KEY_ROWS && pending.every((key) => is_key_token(key) && key.length <= MAX_PENDING_TOKEN_CHARS)) fields.pending = (pending as string[]).slice(-MAX_PENDING_KEYS);
  if (typeof count === "number" && Number.isInteger(count) && count > 0 && count <= MAX_COUNT) fields.count = count;
  if (pass === true) fields.pass = true;
  if (typeof site === "string" && site.length > 0 && site.length <= MAX_SITE_LABEL_CHARS && !/[\p{Cc}\p{Cf}]/u.test(site)) fields.site = site;
  if (typeof recording === "string" && /^[\p{L}\p{N}"]$/u.test(recording)) fields.recording = recording;
  return fields;
}

// The toast a tab carries, or undefined for anything of the wrong shape. A kind this version does not know is drawn as info.
export function bar_toast_of(value: unknown): BarToast | undefined {
  if (!is_record(value)) return undefined;
  const { id, text, kind, until } = value;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id > Number.MAX_SAFE_INTEGER) return undefined;
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_TOAST_CHARS || /[\p{Cc}\p{Cf}]/u.test(text)) return undefined;
  if (typeof until !== "number" || !Number.isInteger(until) || until <= 0) return undefined;
  return { id, text, kind: (TOAST_KINDS.includes(kind as string) ? kind : "info") as ToastKind, until };
}

function bar_colors_of(value: unknown): BarColors | undefined {
  if (!is_record(value) || !BAR_ROLES.every((role) => is_color(value[role]))) return undefined;
  return Object.fromEntries([...BAR_ROLES, ...BAR_OPTIONAL_ROLES.filter((role) => is_color(value[role]))].map((role) => [role, value[role]])) as BarColors;
}

export function bar_theme_of(value: unknown): BarTheme | undefined {
  if (!is_record(value)) return undefined;
  const [dark, light] = [bar_colors_of(value.dark), bar_colors_of(value.light)];
  return dark && light ? { dark, light } : undefined;
}

const widgets_of = (value: unknown): BarWidget[] | undefined =>
  Array.isArray(value) && value.length <= BROWSER_BAR_WIDGETS.length && new Set(value).size === value.length && value.every((item) => (BROWSER_BAR_WIDGETS as readonly unknown[]).includes(item)) ? (value as BarWidget[]) : undefined;

// A bar config needs both lists and the border, else it is left out and the module draws nothing.
export function bar_config_of(value: unknown): BarConfig | undefined {
  if (!is_record(value)) return undefined;
  const [left, right] = [widgets_of(value.left), widgets_of(value.right)];
  return left && right && (BROWSER_BAR_BORDERS as readonly unknown[]).includes(value.border) ? { left, right, border: value.border as BarConfig["border"] } : undefined;
}

// The sidebar table, or undefined when any part of it is bad: then the sidebar has no keys, and the tab and scroll keys stay. A row may not begin another row, because the module would never see the longer one.
export function sidebar_keys_of(value: unknown): SidebarKeyRow[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_KEY_ROWS) return undefined;
  const rows: SidebarKeyRow[] = [];
  for (const row of value) {
    if (!is_record(row) || !is_sidebar_command_id(row.id) || !Array.isArray(row.keys) || row.keys.length === 0 || row.keys.length > MAX_SIDEBAR_KEY_TOKENS || !row.keys.every(is_key_token)) return undefined;
    rows.push({ keys: [...(row.keys as string[])], id: row.id });
  }
  const joined = rows.map((row) => row.keys.join(" "));
  if (joined.some((keys, index) => joined.some((other, other_index) => other_index !== index && (other === keys || other.startsWith(`${keys} `))))) return undefined;
  return rows;
}

// The key token lists of the `hint.browser` bindings, or undefined when any is bad: then no chrome focus starts hints, and the rest of the state stays. No list may begin another, as in the sidebar table.
export function chrome_hint_keys_of(value: unknown): string[][] | undefined {
  if (!Array.isArray(value) || value.length > MAX_CHROME_HINT_BINDINGS) return undefined;
  if (!value.every((keys) => Array.isArray(keys) && keys.length > 0 && keys.length <= MAX_CHROME_HINT_KEY_TOKENS && keys.every(is_key_token))) return undefined;
  const joined = (value as string[][]).map((keys) => keys.join(" "));
  if (joined.some((keys, index) => joined.some((other, other_index) => other_index !== index && (other === keys || other.startsWith(`${keys} `))))) return undefined;
  return (value as string[][]).map((keys) => [...keys]);
}

// One line of text the panel shows: no control or format characters (bidi among them), within its limit.
const is_shown_text = (text: unknown, max_chars: number): text is string => typeof text === "string" && text.length <= max_chars && !/[\p{Cc}\p{Cf}]/u.test(text);

function which_key_panel_of(value: unknown): WhichKeyTablePanel | undefined {
  if (!is_record(value) || !Array.isArray(value.title) || !Array.isArray(value.rows)) return undefined;
  if (value.title.length > MAX_WHICH_KEY_TITLE_PARTS || !value.title.every((part) => is_shown_text(part, MAX_WHICH_KEY_LABEL_CHARS))) return undefined;
  if (value.rows.length === 0 || value.rows.length > MAX_WHICH_KEY_ROWS) return undefined;
  const rows: WhichKeyTableRow[] = [];
  for (const row of value.rows) {
    if (!is_record(row) || !is_shown_text(row.keys, MAX_KEY_CHARS) || row.keys === "" || !is_shown_text(row.command, MAX_WHICH_KEY_LABEL_CHARS)) return undefined;
    if (row.more !== undefined && row.more !== true) return undefined;
    rows.push({ keys: row.keys, command: row.command, ...(row.more && { more: true as const }) });
  }
  return { title: [...(value.title as string[])], rows };
}

// The table, or undefined when any part is bad: the panel then stays away on locked pages, and the keys stay. A path is a key path with no capture key, which the module could never match. Unknown fields are dropped.
export function which_key_table_of(value: unknown): WhichKeyTable | undefined {
  if (!is_record(value) || !is_record(value.panels)) return undefined;
  if ((json_bytes(value) ?? Number.POSITIVE_INFINITY) > MAX_WHICH_KEY_BYTES) return undefined;
  const { delay_ms, skip, border } = value;
  if (typeof delay_ms !== "number" || !Number.isInteger(delay_ms) || delay_ms <= 0 || delay_ms > MAX_WHICH_KEY_DELAY_MS) return undefined;
  if (!(WHICH_KEY_BORDERS as readonly unknown[]).includes(border)) return undefined;
  if (skip !== undefined && !(Array.isArray(skip) && skip.length <= MAX_WHICH_KEY_SKIP && skip.every((typed) => is_shown_text(typed, MAX_KEY_CHARS * MAX_SEQUENCE_KEYS)))) return undefined;
  const paths = Object.keys(value.panels);
  if (paths.length > MAX_WHICH_KEY_PANELS) return undefined;
  const panels: Record<string, WhichKeyTablePanel> = {};
  for (const path of paths) {
    const tokens = path.split(" ");
    if (tokens.length > MAX_SEQUENCE_KEYS || !tokens.every(is_key_token)) return undefined;
    const panel = which_key_panel_of(value.panels[path]);
    if (!panel) return undefined;
    // Defined, not assigned, so a `__proto__` path stays a key and sets no prototype.
    Object.defineProperty(panels, path, { value: panel, enumerable: true, writable: true, configurable: true });
  }
  return { delay_ms, ...(skip !== undefined && skip.length > 0 && { skip: [...(skip as string[])] }), border: border as WhichKeyBorder, panels };
}

export function validate_module_state(value: unknown): Checked<ModuleState> {
  if (!is_record(value)) return bad("state must be a table");
  if (value.v !== BROWSER_MODULE_PROTOCOL_VERSION) return bad("state has another protocol version");
  if (typeof value.enabled !== "boolean") return bad("enabled must be true or false");
  if (value.blur_on_load !== undefined && typeof value.blur_on_load !== "boolean") return bad("blur_on_load must be true or false");
  if (!Array.isArray(value.keys) || value.keys.length > MAX_KEY_ROWS) return bad(`keys must be a list of at most ${MAX_KEY_ROWS} rows`);
  const keys: KeyRow[] = [];
  const seen = new Set<string>();
  for (const row of value.keys) {
    const checked = check_key_row(row);
    if (!checked.ok) return checked;
    if (seen.has(checked.value.key)) return bad("a key appears twice");
    seen.add(checked.value.key);
    keys.push(checked.value);
  }
  // `tabs` is optional. A tab that is not listed is in normal mode and not live (`tab_state_in`): a locked page has no tab record, so absence is the usual case there. The same holds for a tab past MAX_STATE_TABS.
  if (value.tabs !== undefined && !is_record(value.tabs)) return bad("tabs must be a table");
  const given_tabs = value.tabs ?? {};
  const tab_ids = Object.keys(given_tabs);
  if (tab_ids.length > MAX_STATE_TABS) return bad("too many tabs");
  const tabs: Record<string, TabState> = {};
  for (const id of tab_ids) {
    const tab = given_tabs[id];
    if (!/^\d{1,10}$/.test(id)) return bad("a tab id must be a number");
    if (!is_record(tab) || typeof tab.live !== "boolean" || !(MODES as readonly unknown[]).includes(tab.mode)) return bad("a tab needs a mode and a live mark");
    const toast = bar_toast_of(tab.toast);
    tabs[id] = { mode: tab.mode as Mode, live: tab.live, ...bar_fields_of(tab), ...(toast && { toast }) };
  }
  // The theme is optional and a bad one is left out, as the bar fields are.
  const bar_theme = bar_theme_of(value.bar_theme);
  const bar = bar_config_of(value.bar);
  // A bad tree fails the state, as a bad key row does: the module must not take keys from half a tree.
  const tree = value.tree === undefined ? undefined : validate_scope_tree(value.tree);
  if (tree && !tree.ok) return tree;
  const sidebar_keys = sidebar_keys_of(value.sidebar_keys);
  const chrome_hint_keys = chrome_hint_keys_of(value.chrome_hint_keys);
  const which_key = which_key_table_of(value.which_key);
  return { ok: true, value: { v: value.v, enabled: value.enabled, keys, tabs, ...(bar_theme && { bar_theme }), ...(bar && { bar }), ...(value.blur_on_load === undefined ? {} : { blur_on_load: value.blur_on_load }), ...(tree && { tree: tree.value }), ...(sidebar_keys && { sidebar_keys }), ...(chrome_hint_keys && { chrome_hint_keys }), ...(value.page_hints === true && { page_hints: true as const }), ...(which_key && { which_key }) } };
}

// What the module writes. The value comes from chrome code, so the extension treats it as foreign input: a size cap first, then the fields it reads. An older or newer module may send more fields, which are ignored.
export function validate_module_hello(value: unknown): Checked<ModuleHello> {
  if (!is_record(value)) return bad("hello must be a table");
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return bad("hello is not plain data");
  }
  if (size > MAX_HELLO_BYTES) return bad("hello is too large");
  if (typeof value.v !== "number" || !Number.isInteger(value.v)) return bad("v must be a whole number");
  const version = value.module_version;
  if (typeof version !== "string" || version.length === 0 || version.length > MAX_MODULE_VERSION_CHARS || /[\p{Cc}\p{Cf}]/u.test(version)) return bad("module_version must be text of 1 to 32 characters");
  return { ok: true, value: { v: value.v, module_version: version, ...(value.bar === true && { bar: true as const }), ...(value.bar_message === true && { bar_message: true as const }), ...(value.devtools_hints === true && { devtools_hints: true as const }), ...(value.devtools_visual === true && { devtools_visual: true as const }), ...(value.page_hints === true && { page_hints: true as const }), ...(value.firefox_pages === true && { firefox_pages: true as const }) } };
}

// What the settings page shows. `waiting`: no valid hello yet.
export type ModuleStatus = { result: "waiting" } | { result: "matched" | "mismatch"; module_version: string; module_v: number } | { result: "invalid"; problem: string };

export function status_of_hello(hello: unknown): ModuleStatus {
  if (hello === undefined) return { result: "waiting" };
  const checked = validate_module_hello(hello);
  if (!checked.ok) return { result: "invalid", problem: checked.problem };
  return { result: checked.value.v === BROWSER_MODULE_PROTOCOL_VERSION ? "matched" : "mismatch", module_version: checked.value.module_version, module_v: checked.value.v };
}

// The two-way messages for later pieces. Either side may start a call. Each side owns one key and is its only writer: chrome writes the from-module list, the extension writes the from-extension list. A list holds at most MAX_MESSAGES messages and `message_list_bytes` of its kinds, newest last, and its writer rewrites it whole. A reader ignores a message it has already seen (by id) and any field it does not know, so a rewrite is safe and an older reader still parses a newer message.
// A message is a request `{ v, id, kind, args }` or a reply `{ v, reply_to, ok, error? }`. A `kind` comes from a fixed allow list per direction, with the shape of its args. A request carries typed commands only, never code, selectors or URLs for the module to run. The page kinds carry message text that the module hands on between the background and DesertFox's own code in a locked page, and never reads. Later pieces add kinds and nothing else.
// A kind row gives the shape of its args and whether the sender expects a reply. A push has `reply: false`: the receiver runs it and says nothing.
// `max_bytes` is the size limit of one message of the kind, as JSON. A kind without it keeps the size of a whole default list. No kind goes past MAX_KIND_BYTES: bulk data goes in a snapshot (below), and a chunked message is refused.
// `max_age_ms` bounds how old a request of the kind may be when it is read (DEFAULT_MAX_AGE_MS when absent), so a key the user pressed long ago never runs late.
export type KindRow = { args: Record<string, ArgKind>; reply: boolean; max_bytes?: number; max_age_ms?: number };
export type KindTable = Record<string, KindRow>;
export const MAX_KIND_BYTES = 64 * 1024;
// Room for the envelopes of the other messages beside the largest one.
export const MESSAGE_ENVELOPE_BYTES = 512;
// The calls of the in-page DesertFox on a locked page (`locked_shim.ts`, `background/browser_module_rpc.ts`). `message` and the reply's `value` are JSON text that chrome relays as it is. `tab_id` is a fact chrome reads, never a field of the page's message.
export const PAGE_TEXT_BYTES = MAX_KIND_BYTES;
const PAGE_MAX_AGE_MS = 10000;
const PAGE_GONE_BYTES = 256;
const PAGE_GONE_MAX_AGE_MS = 60000;
const PANE_CALL_BYTES = 256;
const RUN_BYTES = 512;
// The command text a prompt key prints, with a selection or clipboard text it may take.
const ADDRESS_BAR_BYTES = 4096;
const PANEL_CALL_BYTES = 256;
// The hints over Firefox's own UI. The module sends target ids and boxes in parts and the extension sends label rows in parts, each part JSON text within this. The module reads only ids it collected in the session and labels of hint letters.
export const CHROME_HINT_PART_BYTES = 4096;
// The most parts a session's targets or one draw may come in. The module keeps the same number.
export const CHROME_HINT_MAX_PARTS = 32;
// A push (`reply: false`) may run twice, because a push leaves no trace once the extension restarts and the module rewrites its list. A push handler gives the same result when run twice. A kind that cannot meet that uses `reply: true`, which the extension answers once.
// A page call and a push each get their answer as the reply's `value` (a `PageAnswer`).
export const MODULE_TO_EXTENSION_KINDS: KindTable = {
  // A message of the page for the background. `document_id` names one attach of the page code (the module counts them), so a call from a document that a load left is refused, and a page that Back restores from the cache attaches again under a new id. A page waits on its first calls while it starts, so they may be older than the default.
  page_call: { args: { tab_id: "int", document_id: "int", message: "text" }, reply: true, max_bytes: PAGE_TEXT_BYTES, max_age_ms: PAGE_MAX_AGE_MS },
  // Chrome's word that the page code of `document_id` ended: its document hid or went away. A late one only ends a lock that already ended, so it keeps a long age.
  page_gone: { args: { tab_id: "int", document_id: "int" }, reply: false, max_bytes: PAGE_GONE_BYTES, max_age_ms: PAGE_GONE_MAX_AGE_MS },
  // A forward leaf of the tree matched: `keys` holds the tokens of its path, joined by one space, and `count` the typed count or 0 for none. The background matches the keys again against its own tree and runs the binding in the active tab. Chrome names no tab.
  run: { args: { keys: "text", count: "int" }, reply: true, max_bytes: RUN_BYTES },
  // One part of a session's targets: `targets` is a list of [id, left, top, width, height] in CSS pixels.
  "chrome_hints.targets": { args: { session: "int", part: "int", parts: "int", targets: "text" }, reply: false, max_bytes: CHROME_HINT_PART_BYTES },
  // A key typed while the labels show. `seq` counts up per session, so a key read twice runs once.
  "chrome_hints.key": { args: { session: "int", seq: "int", key: "text" }, reply: false, max_bytes: PANE_CALL_BYTES },
  // The session ended in chrome: Escape, a click, the window left the front or closed, or no labels came.
  "chrome_hints.end": { args: { session: "int" }, reply: false, max_bytes: PANE_CALL_BYTES },
  // The user typed a `hint.browser` binding with the focus in a dialog, the Library, Page Info or an open panel. `start` is a token the module made for that key in that window. A reply, so a start read twice runs once.
  "chrome_hints.want": { args: { start: "int" }, reply: true, max_bytes: PANE_CALL_BYTES },
  // The user typed the `hints.start` key in DevTools. `ask` is a token the module made for that key, and the module drops the keys typed until the labels show. A reply, as for `chrome_hints.want`, so an ask read twice runs once and never clears the session it started. The session's targets, keys and end come on the chrome_hints rows.
  "devtools_hints.ask": { args: { ask: "int" }, reply: true, max_bytes: PANE_CALL_BYTES },
  // The user typed a hint key on one of Firefox's own pages that the module labels. `start` is a token the module made for that key, as for `chrome_hints.want`. `keys` holds the tokens of the hint leaf's path, joined by one space, and `count` the typed count or 0, which a page session ignores. The extension matches the keys against its own tree and names the action, or refuses. The session's targets, keys and end come on the chrome_hints rows.
  "page_hints.want": { args: { start: "int", keys: "text", count: "int" }, reply: true, max_bytes: RUN_BYTES },
};
export const EXTENSION_TO_MODULE_KINDS: KindTable = {
  // A message of the background for the page, in place of `tabs.sendMessage`. `document_id` is the attach the tab's lock names, and the module refuses the push when another document holds the tab, so a push sent before a reload never reaches the next document. It is optional, so an older extension that sends none still reaches the tab's page.
  page_push: { args: { tab_id: "int", document_id: "optional_int", message: "text" }, reply: true, max_bytes: PAGE_TEXT_BYTES, max_age_ms: PAGE_MAX_AGE_MS },
  // The pane calls change the window, so each expects a reply: the module answers with its refusal text when it cannot do the call. A resize step is 5 percent of the panel area. Each message is tiny, so one limit covers all.
  "pane.split_new_tab": { args: {}, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.split_next_tab": { args: {}, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.unsplit": { args: {}, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.close_both": { args: {}, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.resize": { args: { steps: "step" }, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.focus_region": { args: { region: "region" }, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.focus_direction": { args: { direction: "direction" }, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.equalize": { args: {}, reply: true, max_bytes: PANE_CALL_BYTES },
  // A key asks for a value and the tab has no command line: the module opens the address bar of the active window with `df ` and `text` typed in. The text is the printed command, which the user reads and edits there. The module only puts it in the field.
  // `tab_id` names the tab that asked. The module refuses when that tab is no longer the selected tab of the focused window, so the text never lands in a window the user switched to. An older extension leaves it out.
  "address_bar.open": { args: { text: "text", tab_id: "optional_int" }, reply: true, max_bytes: ADDRESS_BAR_BYTES },
  // The command line on a locked page: the module opens DesertFox's own `cmdline.html` in a panel over the tab, at a fixed address with the extension's principal. It refuses when `tab_id` is no longer the selected tab of its window, so a late request never opens over another page.
  "cmdline_panel.open": { args: { tab_id: "int" }, reply: true, max_bytes: PANEL_CALL_BYTES },
  // Starts a session in the window, which must be in front. `colors` is JSON text of the theme's dark and light hex colors, or "". The reply refuses when there is nothing to hint.
  "chrome_hints.collect": { args: { session: "int", window_id: "int", colors: "text" }, reply: true, max_bytes: 1024 },
  // Starts a session where the user typed the binding, for a `chrome_hints.want`. The module takes its own `start` token once, while fresh, and only in the window that made it, so this names no window.
  "chrome_hints.collect_here": { args: { session: "int", start: "int", colors: "text" }, reply: true, max_bytes: 1024 },
  // One part of the labels to show: `labels` is a list of [id, label]. Only a draw whose parts all came shows, and it replaces the one before.
  "chrome_hints.draw": { args: { session: "int", gen: "int", part: "int", parts: "int", typed: "text", labels: "text" }, reply: false, max_bytes: CHROME_HINT_PART_BYTES },
  // Runs the target's fixed action. The reply refuses an id of another session and a target that is gone or moved.
  "chrome_hints.pick": { args: { session: "int", id: "int" }, reply: true, max_bytes: PANE_CALL_BYTES },
  // Ends the session in chrome. The extension sends it after a failed collect, whose lost reply can hide a session that started.
  "chrome_hints.clear": { args: { session: "int" }, reply: false, max_bytes: PANE_CALL_BYTES },
  // Starts a session on the page where the user typed the hint key, for a `page_hints.want`. The module takes its own `start` token once, while fresh, and only with that page still shown in that window. `action` comes from the fixed list. Draw, pick and clear go on the chrome_hints rows.
  "page_hints.collect": { args: { session: "int", start: "int", action: "page_hint_action", colors: "text" }, reply: true, max_bytes: 1024 },
  // The DevTools key table, pushed after each matched hello, since the module keeps it in memory only. A module without DevTools code refuses the kind, and one that never got it claims no key in DevTools.
  // A day to be read, not the default 2 s: the push sets a table rather than pressing a key, so a late one does no harm, and a dropped one leaves DevTools keys off until the next hello.
  "devtools.keys": { args: { keys: "devtools_keys" }, reply: false, max_bytes: 512, max_age_ms: 86_400_000 },
  // Hints over DevTools, for a `devtools_hints.ask`: the module takes its own `ask` token once, while fresh, and only with the focus still in DevTools. Draw, pick and clear match the chrome_hints rows, apart so that the file that holds a DevTools session gets them.
  "devtools_hints.collect": { args: { session: "int", ask: "int", colors: "text" }, reply: true, max_bytes: 1024 },
  "devtools_hints.draw": { args: { session: "int", gen: "int", part: "int", parts: "int", typed: "text", labels: "text" }, reply: false, max_bytes: CHROME_HINT_PART_BYTES },
  "devtools_hints.pick": { args: { session: "int", id: "int" }, reply: true, max_bytes: PANE_CALL_BYTES },
  "devtools_hints.clear": { args: { session: "int" }, reply: false, max_bytes: PANE_CALL_BYTES },
  // The keys of visual mode in DevTools, pushed with the key table and kept the same way. Each row maps a key to an op from the closed list, so the module moves and copies only the user's own selection. No text, selector or range comes or goes.
  "devtools.visual_keys": { args: { keys: "devtools_visual_keys" }, reply: false, max_bytes: 1024, max_age_ms: 86_400_000 },
  // Opens one Firefox page from the fixed list, sent only to a module whose hello says `firefox_pages`. The module builds the address from its own table, so no address, query or fragment crosses the channel.
  // `tab_id` names the tab that asked, as for `address_bar.open`: the page opens in that tab's window, and `here` replaces that tab only while it is still the selected tab. A reply, because an open read twice must open once.
  "firefox_page.open": { args: { page: "firefox_page", where: "optional_open_where", tab_id: "optional_int" }, reply: true, max_bytes: PANE_CALL_BYTES },
};

// The module core's fixed refusal of a request whose arg has the wrong shape (`checked_message` in browser_module/desertfox-browser.js). An older module that knows the kind but not a newer value of an arg answers with it.
export const wrong_shape_refusal = (kind: string, arg: string): string => `${kind} ${arg} has the wrong shape`;

// The byte cap of a whole list of a direction: room for two of its largest messages and the envelopes beside them, so a full-size message survives the next write.
export const message_list_bytes = (kinds: KindTable): number => Math.max(MAX_MESSAGE_LIST_BYTES, ...Object.values(kinds).map((row) => 2 * kind_bytes(row))) + MESSAGE_ENVELOPE_BYTES;
const kind_bytes = (row: KindRow): number => Math.min(row.max_bytes ?? MAX_MESSAGE_LIST_BYTES, MAX_KIND_BYTES);

// A reply's `value` fits the limit of the kind it answers. Its writer checks that limit. A reader, which does not know the kind, checks the ceiling.
export const reply_fits = (reply: ModuleReply, request_kind: KindRow): boolean => (json_bytes(reply) ?? Number.POSITIVE_INFINITY) <= kind_bytes(request_kind);

// The size of a value as JSON text, or undefined when it is not plain data (a cycle, a BigInt).
export function json_bytes(value: unknown): number | undefined {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : new TextEncoder().encode(text).length;
  } catch {
    return undefined;
  }
}

export const DEFAULT_MAX_AGE_MS = 2000;

// `sent_at` is ms since the epoch. A request from an older writer has none and is never too old.
export type ModuleRequest = { v: number; id: string; kind: string; args: ModuleArgs; sent_at?: number };
// `value` is optional JSON text. An older reader ignores it.
export type ModuleReply = { v: number; reply_to: string; ok: boolean; error?: string; value?: string };
export type ModuleMessage = ModuleRequest | ModuleReply;
export const is_reply = (message: ModuleMessage): message is ModuleReply => "reply_to" in message;

// One message against a direction's kinds. A request of a kind not in the list, or with bad args, is a problem.
export function validate_message(value: unknown, kinds: KindTable): Checked<ModuleMessage> {
  if (!is_record(value)) return bad("a message must be a table");
  if (value.v !== BROWSER_MODULE_PROTOCOL_VERSION) return bad("a message has another protocol version");
  if (value.reply_to !== undefined) {
    if (!is_message_id(value.reply_to)) return bad("reply_to must be a message id");
    if (typeof value.ok !== "boolean") return bad("ok must be true or false");
    if (value.error !== undefined && (typeof value.error !== "string" || value.error.length > MAX_ERROR_CHARS)) return bad("error must be short text");
    if (value.value !== undefined && (typeof value.value !== "string" || (json_bytes(value) ?? Number.POSITIVE_INFINITY) > MAX_KIND_BYTES)) return bad("value must be text within the size limit");
    return { ok: true, value: { v: value.v, reply_to: value.reply_to, ok: value.ok, ...(value.error === undefined ? {} : { error: value.error.replace(/[\p{Cc}\p{Cf}]/gu, "") }), ...(value.value === undefined ? {} : { value: value.value }) } };
  }
  if (!is_message_id(value.id)) return bad("a request needs an id of 1 to 32 letters, digits, - or _");
  if (typeof value.kind !== "string" || !Object.hasOwn(kinds, value.kind)) return bad("the kind is not on the allow list");
  if ((json_bytes(value) ?? Number.POSITIVE_INFINITY) > kind_bytes(kinds[value.kind]!)) return bad(`a ${value.kind} message is over its size limit`);
  if (value.sent_at !== undefined && (typeof value.sent_at !== "number" || !Number.isSafeInteger(value.sent_at) || value.sent_at < 0)) return bad("sent_at must be whole ms since the epoch");
  const given = value.args ?? {};
  if (!is_record(given)) return bad("args must be a table");
  const args: ModuleArgs = {};
  for (const [name, kind] of Object.entries(kinds[value.kind]!.args)) {
    const problem = arg_problem(kind, given[name]);
    if (problem !== undefined) return bad(`${value.kind} ${name} ${problem}`);
    if (given[name] !== undefined) args[name] = kind === "devtools_keys" ? devtools_rows_of(given[name]) : kind === "devtools_visual_keys" ? devtools_visual_rows_of(given[name]) : (given[name] as number | string);
  }
  return { ok: true, value: { v: value.v, id: value.id, kind: value.kind, args, ...(value.sent_at === undefined ? {} : { sent_at: value.sent_at }) } };
}

// A request older than its kind allows at `now`. A clock that went back counts as fresh.
export const is_too_old = (request: ModuleRequest, kinds: KindTable, now: number): boolean =>
  request.sent_at !== undefined && now - request.sent_at > (kinds[request.kind]?.max_age_ms ?? DEFAULT_MAX_AGE_MS);

// `refused` names each request that failed its check, still had a usable id and either names no listed kind or expects a reply, so its reader can answer with an error. A push that fails its check is dropped. A message with no usable id, or of another version, is dropped without a word.
export type MessageList = { messages: ModuleMessage[]; refused: { id: string; error: string }[] };

// A whole list from foreign or own storage: a size cap, a count cap, then message by message. The list fails only when it is not a list or is too big. A bad message is skipped and never takes a good one down.
// With `now`, a request that is too old is dropped as well, and refused when it expects a reply. The writer's own read of its list passes no `now`.
export function validate_message_list(value: unknown, kinds: KindTable, now?: number): Checked<MessageList> {
  if (!Array.isArray(value)) return bad("a message list must be a list");
  if (value.length > MAX_MESSAGES) return bad("a message list holds too many messages");
  const size = json_bytes(value);
  if (size === undefined) return bad("a message list is not plain data");
  if (size > message_list_bytes(kinds)) return bad("a message list is too large");
  const list: MessageList = { messages: [], refused: [] };
  for (const item of value) {
    const checked = validate_message(item, kinds);
    if (checked.ok && now !== undefined && !is_reply(checked.value) && is_too_old(checked.value, kinds, now)) {
      if (kinds[checked.value.kind]!.reply) list.refused.push({ id: checked.value.id, error: "the request is too old" });
    } else if (checked.ok) list.messages.push(checked.value);
    else if (is_record(item) && item.v === BROWSER_MODULE_PROTOCOL_VERSION && item.reply_to === undefined && is_message_id(item.id) && (typeof item.kind !== "string" || !Object.hasOwn(kinds, item.kind) || kinds[item.kind]!.reply)) list.refused.push({ id: item.id, error: checked.problem.slice(0, MAX_ERROR_CHARS) });
  }
  return { ok: true, value: list };
}

// Where a message of the in-page DesertFox goes on a locked page (`src/content/locked_shim.ts`). The background takes a `page_call` only of a `background` type. `module`: the module answers it (a bundle load). `snapshot`: the shim answers from a snapshot. `refused`: it needs a real content script, the command line page, or would run user code with the page's privilege (snippets).
// A new message type does not compile until it has a row here.
export type LockedRoute = "background" | "module" | "snapshot" | "refused";
export const LOCKED_PAGE_ROUTES = {
  run: "background",
  mode_changed: "background",
  bar_state: "background",
  leave_tab_insert: "background",
  load_bundle: "module",
  // The shim answers the panel of normal mode with no prefix from its snapshot, and sends the rest.
  list_keys: "background",
  read_repeat_preview: "background",
  issue_cmdline_ticket: "background",
  relay: "background",
  frame_cue: "background",
  open_cmdline: "background",
  open_panel_cmdline: "refused",
  close_panel_cmdline: "refused",
  record_cmdline: "refused",
  complete_items: "refused",
  tab_rows_action: "refused",
  open_help: "background",
  record_step: "background",
  read_keymap: "snapshot",
  // The shim resolves the keymap snapshot itself and asks for what a snapshot cannot hold.
  read_keymap_state: "background",
  replay_end: "background",
  replay_stop: "background",
  find_scan: "background",
  image_action: "background",
  inspect_pick: "refused",
  read_hint_selectors: "background",
  read_strip_patterns: "background",
  register_read: "background",
  register_write: "background",
  register_yank: "background",
  mark_set: "background",
  mark_jump: "background",
  mark_step: "background",
  jump_push: "background",
  jump_step: "background",
  jump_leave: "background",
  editor_open: "background",
  hint_frames_start: "background",
  hint_frames_report: "background",
  hint_frames_typed: "background",
  hint_frames_pick: "background",
  hint_frames_end: "background",
  hint_frames_unhover: "background",
  media_pin: "refused",
  quality_report: "refused",
  quality_probe: "refused",
  record_timing: "background",
  snippet_run: "refused",
} as const satisfies Record<keyof ContentRequests, LockedRoute>;

export const locked_route_of = (type: unknown): LockedRoute => (typeof type === "string" && Object.hasOwn(LOCKED_PAGE_ROUTES, type) ? LOCKED_PAGE_ROUTES[type as keyof typeof LOCKED_PAGE_ROUTES] : "refused");

// The JSON text in the `value` of a reply to `page_call` or `page_push`: `{ value }`, `{}` for no answer, or `{ error }` when the handler failed.
export type PageAnswer = { value?: unknown; error?: string };

// Read-only data the in-page DesertFox needs whole, too big for a message: one key per part, written by the extension and rewritten when the part changes. The module reads each once and again on `storage.onChanged`, and never on a key press.
// A snapshot is `{ v, value? }`. Every field but `v` is optional, and a reader ignores fields it does not know.
export type SnapshotPart = "keymap" | "config" | "theme" | "which_key";
export type Snapshot = { v: number; value?: unknown };
// No part goes past this, whatever its own cap.
export const MAX_SNAPSHOT_BYTES = 512 * 1024;

type SnapshotRow = { key: string; max_bytes: number; value_ok: (value: unknown) => boolean };
export const SNAPSHOT_PARTS: Record<SnapshotPart, SnapshotRow> = {
  // The stored compiled keymap with its site rules, as an object, so storage holds it with no escaping. Only the outline is checked here: the shim runs `current_keymap` on it before use.
  keymap: { key: BROWSER_MODULE_SNAPSHOT_KEYMAP_STORAGE_KEY, max_bytes: MAX_SNAPSHOT_BYTES, value_ok: (value) => is_record(value) && typeof value.format_version === "number" && is_record(value.modes) && (value.site_rules === undefined || Array.isArray(value.site_rules)) },
  // The stored config status (CONFIG_STATUS_STORAGE_KEY).
  config: { key: BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, max_bytes: 64 * 1024, value_ok: is_record },
  // The stored theme (THEME_STORAGE_KEY).
  theme: { key: BROWSER_MODULE_SNAPSHOT_THEME_STORAGE_KEY, max_bytes: 16 * 1024, value_ok: (value) => is_record(value) && is_record(value.dark) && is_record(value.light) },
  // The which-key panel of normal mode with no prefix.
  which_key: { key: BROWSER_MODULE_SNAPSHOT_WHICH_KEY_STORAGE_KEY, max_bytes: 128 * 1024, value_ok: (value) => is_record(value) && Array.isArray(value.title) && Array.isArray(value.rows) },
};
export const SNAPSHOT_PART_NAMES = Object.keys(SNAPSHOT_PARTS) as SnapshotPart[];

export const snapshot_cap = (part: SnapshotPart): number => Math.min(SNAPSHOT_PARTS[part].max_bytes, MAX_SNAPSHOT_BYTES);

export function validate_snapshot(part: SnapshotPart, value: unknown): Checked<Snapshot> {
  const row = SNAPSHOT_PARTS[part];
  if (!is_record(value)) return bad("a snapshot must be a table");
  const size = json_bytes(value);
  if (size === undefined) return bad("a snapshot is not plain data");
  if (size > snapshot_cap(part)) return bad(`the ${part} snapshot is too large`);
  if (value.v !== BROWSER_MODULE_PROTOCOL_VERSION) return bad("a snapshot has another protocol version");
  if (value.value === undefined) return { ok: true, value: { v: value.v } };
  if (!row.value_ok(value.value)) return bad(`the ${part} snapshot holds the wrong shape`);
  return { ok: true, value: { v: value.v, value: value.value } };
}

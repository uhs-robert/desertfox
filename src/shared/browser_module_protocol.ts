// The channel between the extension and the browser module, an optional script that Firefox loads with browser privileges (see docs/design/host.md, "Browser module").
// The extension writes the state and reads the hello, both in its own `storage.session`. The module is a thin executor: it receives only typed rows (a fixed command id with checked args) and never code, selectors or URLs.
// The module file holds a copy of the names and the version, and a test keeps the copy equal to this file.

import { MODES } from "./command.ts";
import type { Mode } from "./command.ts";
import type { ContentRequests } from "./messages/map.ts";
import { BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, BROWSER_MODULE_SNAPSHOT_KEYMAP_STORAGE_KEY, BROWSER_MODULE_SNAPSHOT_THEME_STORAGE_KEY, BROWSER_MODULE_SNAPSHOT_WHICH_KEY_STORAGE_KEY } from "./config/storage_keys.ts";
import { BROWSER_BAR_BORDERS, BROWSER_BAR_WIDGETS } from "./browser_bar_lists.ts";

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
type ArgKind = "int" | "number" | "axis" | "text" | "step" | "region" | "direction";

export const PANE_REGIONS = ["sidebar", "page", "split", "devtools"] as const;
export const MAX_RESIZE_STEPS = 20;
export const PANE_DIRECTIONS = ["left", "right"] as const;

// The commands the module may run and the shape of each arg. The command schema owns limits and defaults: the extension fills and checks them through the one validator (`check_args`) before it writes a row, so a row always holds every arg. The module checks the shape only.
export const MODULE_COMMAND_ARGS = {
  "tab.next": {},
  "tab.prev": {},
  "scroll.lines": { count: "int" },
  "scroll.pixels": { dx: "int", dy: "int" },
  "scroll.pages": { fraction: "number", count: "int" },
  "scroll.to": { percent: "number", axis: "axis" },
} as const satisfies Record<string, Record<string, ArgKind>>;

export type ModuleCommandId = keyof typeof MODULE_COMMAND_ARGS;
export const MODULE_COMMAND_IDS = Object.keys(MODULE_COMMAND_ARGS) as ModuleCommandId[];

export type ModuleArgs = Record<string, number | string>;
export type KeyRow = { key: string; id: ModuleCommandId; args: ModuleArgs };
// What the status bar shows of a tab beyond its mode, all optional. `pending` holds the keys of a half-typed sequence (a held group included), `count` a typed count, `pass` that pass-next is armed, `site` the label of a site mode and `recording` the register a macro records into. A private tab never has `site`.
export type BarFields = { pending?: string[]; count?: number; pass?: true; site?: string; recording?: string };
export type TabState = { mode: Mode; live: boolean } & BarFields;
// The roles the bar's mode badge takes from the theme, for the dark and the light scheme.
export const BAR_ROLES = ["bg_core", "mode_normal", "mode_insert", "mode_ignore", "mode_caret", "mode_visual", "mode_item", "mode_media"] as const;
export type BarRole = (typeof BAR_ROLES)[number];
export type BarColors = Record<BarRole, string>;
export type BarTheme = { dark: BarColors; light: BarColors };
// What the settings say about the bar. The state carries it only while `browser_bar` is on, so its absence tells the module not to draw.
export type BarWidget = (typeof BROWSER_BAR_WIDGETS)[number];
export type BarConfig = { left: BarWidget[]; right: BarWidget[]; border: (typeof BROWSER_BAR_BORDERS)[number] };
// `blur_on_load` is the setting of that name, so the module takes the focus out of a field a locked page focused as it loaded. Absent means off.
export type ModuleState = { v: number; enabled: boolean; keys: KeyRow[]; tabs: Record<string, TabState>; bar_theme?: BarTheme; bar?: BarConfig; blur_on_load?: boolean };
// `bar` says the module built its status bar.
export type ModuleHello = { v: number; module_version: string; bar?: true };

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
  if (kind === "text") return typeof value === "string" ? undefined : "must be text";
  if (kind === "axis") return value === "x" || value === "y" ? undefined : "must be x or y";
  if (kind === "region") return PANE_REGIONS.some((region) => region === value) ? undefined : `must be one of ${PANE_REGIONS.join(", ")}`;
  if (kind === "direction") return PANE_DIRECTIONS.some((direction) => direction === value) ? undefined : `must be one of ${PANE_DIRECTIONS.join(", ")}`;
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
  if (kind === "step") return Number.isInteger(value) && value !== 0 && Math.abs(value) <= MAX_RESIZE_STEPS ? undefined : `must be a whole number of 1 to ${MAX_RESIZE_STEPS} steps, either way`;
  return kind === "int" && !Number.isInteger(value) ? "must be a whole number" : undefined;
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

function bar_colors_of(value: unknown): BarColors | undefined {
  if (!is_record(value) || !BAR_ROLES.every((role) => is_color(value[role]))) return undefined;
  return Object.fromEntries(BAR_ROLES.map((role) => [role, value[role]])) as BarColors;
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
    tabs[id] = { mode: tab.mode as Mode, live: tab.live, ...bar_fields_of(tab) };
  }
  // The theme is optional and a bad one is left out, as the bar fields are.
  const bar_theme = bar_theme_of(value.bar_theme);
  const bar = bar_config_of(value.bar);
  return { ok: true, value: { v: value.v, enabled: value.enabled, keys, tabs, ...(bar_theme && { bar_theme }), ...(bar && { bar }), ...(value.blur_on_load === undefined ? {} : { blur_on_load: value.blur_on_load }) } };
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
  return { ok: true, value: { v: value.v, module_version: version, ...(value.bar === true && { bar: true as const }) } };
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
const PAGE_TEXT_BYTES = MAX_KIND_BYTES;
const PAGE_MAX_AGE_MS = 10000;
const PANE_CALL_BYTES = 256;
// A push (`reply: false`) may run twice, because a push leaves no trace once the extension restarts and the module rewrites its list. A push handler gives the same result when run twice. A kind that cannot meet that uses `reply: true`, which the extension answers once.
// A page call and a push each get their answer as the reply's `value` (a `PageAnswer`).
export const MODULE_TO_EXTENSION_KINDS: KindTable = {
  // A message of the page for the background. `document_id` names one attach of the page code (the module counts them), so a call from a document that a load left is refused, and a page that Back restores from the cache attaches again under a new id. A page waits on its first calls while it starts, so they may be older than the default.
  page_call: { args: { tab_id: "int", document_id: "int", message: "text" }, reply: true, max_bytes: PAGE_TEXT_BYTES, max_age_ms: PAGE_MAX_AGE_MS },
};
export const EXTENSION_TO_MODULE_KINDS: KindTable = {
  // A message of the background for the page, in place of `tabs.sendMessage`.
  page_push: { args: { tab_id: "int", message: "text" }, reply: true, max_bytes: PAGE_TEXT_BYTES, max_age_ms: PAGE_MAX_AGE_MS },
  // The pane calls change the window, so each expects a reply: the module answers with its refusal text when it cannot do the call. A resize step is 5 percent of the panel area. Each message is tiny, so one limit covers all.
  "pane.split_new_tab": { args: {}, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.split_next_tab": { args: {}, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.unsplit": { args: {}, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.close_both": { args: {}, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.resize": { args: { steps: "step" }, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.focus_region": { args: { region: "region" }, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.focus_direction": { args: { direction: "direction" }, reply: true, max_bytes: PANE_CALL_BYTES },
  "pane.equalize": { args: {}, reply: true, max_bytes: PANE_CALL_BYTES },
};

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
    args[name] = given[name] as number | string;
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

export function validate_snapshot(part: SnapshotPart, value: unknown): Checked<Snapshot> {
  const row = SNAPSHOT_PARTS[part];
  if (!is_record(value)) return bad("a snapshot must be a table");
  const size = json_bytes(value);
  if (size === undefined) return bad("a snapshot is not plain data");
  if (size > Math.min(row.max_bytes, MAX_SNAPSHOT_BYTES)) return bad(`the ${part} snapshot is too large`);
  if (value.v !== BROWSER_MODULE_PROTOCOL_VERSION) return bad("a snapshot has another protocol version");
  if (value.value === undefined) return { ok: true, value: { v: value.v } };
  if (!row.value_ok(value.value)) return bad(`the ${part} snapshot holds the wrong shape`);
  return { ok: true, value: { v: value.v, value: value.value } };
}

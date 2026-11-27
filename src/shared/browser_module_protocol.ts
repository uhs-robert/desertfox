// The channel between the extension and the browser module, an optional script that Firefox loads with browser privileges (see docs/design/host.md, "Browser module").
// The extension writes the state and reads the hello, both in its own `storage.session`. The module is a thin executor: it receives only typed rows (a fixed command id with checked args) and never code, selectors or URLs.
// The module file holds a copy of the names and the version, and a test keeps the copy equal to this file.

import { MODES } from "./command.ts";
import type { Mode } from "./command.ts";

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
// The extension reads the hello at most this often.
export const HELLO_MIN_INTERVAL_MS = 1000;
// The extension reads the module's message list at most this often. It is short because a call the module starts, such as a key on a locked page, must not wait a second. The list is capped, so a read is cheap.
export const MESSAGE_MIN_GAP_MS = 50;

type ArgKind = "int" | "number" | "axis";

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
export type TabState = { mode: Mode; live: boolean };
export type ModuleState = { v: number; enabled: boolean; keys: KeyRow[]; tabs: Record<string, TabState> };
export type ModuleHello = { v: number; module_version: string };

// What the module takes for a tab id the state does not list.
export const ABSENT_TAB: TabState = { mode: "normal", live: false };
export const tab_state_in = (state: ModuleState, tab_id: number | string): TabState => state.tabs[String(tab_id)] ?? ABSENT_TAB;

export type Checked<T> = { ok: true; value: T } | { ok: false; problem: string };
const bad = (problem: string): { ok: false; problem: string } => ({ ok: false, problem });

const is_record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const is_module_command_id = (id: unknown): id is ModuleCommandId => typeof id === "string" && Object.hasOwn(MODULE_COMMAND_ARGS, id);
// One normalized key token: a character, or a name in angle brackets. No spaces or control characters.
const is_key_token = (key: unknown): key is string => typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_CHARS && !/[\s\p{Cc}]/u.test(key);

function arg_problem(kind: ArgKind, value: unknown): string | undefined {
  if (kind === "axis") return value === "x" || value === "y" ? undefined : "must be x or y";
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
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

export function validate_module_state(value: unknown): Checked<ModuleState> {
  if (!is_record(value)) return bad("state must be a table");
  if (value.v !== BROWSER_MODULE_PROTOCOL_VERSION) return bad("state has another protocol version");
  if (typeof value.enabled !== "boolean") return bad("enabled must be true or false");
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
    tabs[id] = { mode: tab.mode as Mode, live: tab.live };
  }
  return { ok: true, value: { v: value.v, enabled: value.enabled, keys, tabs } };
}

// What the module writes. The value comes from chrome code, so the extension treats it as foreign input: a size cap first, then the two fields it reads. An older or newer module may send more fields, which are ignored.
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
  return { ok: true, value: { v: value.v, module_version: version } };
}

// What the settings page shows. `waiting`: no valid hello yet.
export type ModuleStatus = { result: "waiting" } | { result: "matched" | "mismatch"; module_version: string; module_v: number } | { result: "invalid"; problem: string };

export function status_of_hello(hello: unknown): ModuleStatus {
  if (hello === undefined) return { result: "waiting" };
  const checked = validate_module_hello(hello);
  if (!checked.ok) return { result: "invalid", problem: checked.problem };
  return { result: checked.value.v === BROWSER_MODULE_PROTOCOL_VERSION ? "matched" : "mismatch", module_version: checked.value.module_version, module_v: checked.value.v };
}

// The two-way messages for later pieces. Either side may start a call. Each side owns one key and is its only writer: chrome writes the from-module list, the extension writes the from-extension list. A list holds at most MAX_MESSAGES messages and MAX_MESSAGE_LIST_BYTES bytes, newest last, and its writer rewrites it whole. A reader ignores a message it has already seen (by id) and any field it does not know, so a rewrite is safe and an older reader still parses a newer message.
// A message is a request `{ v, id, kind, args }` or a reply `{ v, reply_to, ok, error? }`. A `kind` comes from a fixed allow list per direction, with the shape of its args. A request carries typed commands only, never code, selectors or URLs. Both lists are empty now, so every request is refused. Later pieces add kinds and nothing else.
// A kind row gives the shape of its args and whether the sender expects a reply. A push has `reply: false`: the receiver runs it and says nothing.
export type KindRow = { args: Record<string, ArgKind>; reply: boolean };
export type KindTable = Record<string, KindRow>;
// A push (`reply: false`) may run twice, because a push leaves no trace once the extension restarts and the module rewrites its list. A push handler gives the same result when run twice. A kind that cannot meet that uses `reply: true`, which the extension answers once.
export const MODULE_TO_EXTENSION_KINDS: KindTable = {};
export const EXTENSION_TO_MODULE_KINDS: KindTable = {};

export type ModuleRequest = { v: number; id: string; kind: string; args: ModuleArgs };
export type ModuleReply = { v: number; reply_to: string; ok: boolean; error?: string };
export type ModuleMessage = ModuleRequest | ModuleReply;
export const is_reply = (message: ModuleMessage): message is ModuleReply => "reply_to" in message;

const is_message_id = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= MAX_MESSAGE_ID_CHARS && /^[A-Za-z0-9_-]+$/.test(id);

// One message against a direction's kinds. A request of a kind not in the list, or with bad args, is a problem.
export function validate_message(value: unknown, kinds: KindTable): Checked<ModuleMessage> {
  if (!is_record(value)) return bad("a message must be a table");
  if (value.v !== BROWSER_MODULE_PROTOCOL_VERSION) return bad("a message has another protocol version");
  if (value.reply_to !== undefined) {
    if (!is_message_id(value.reply_to)) return bad("reply_to must be a message id");
    if (typeof value.ok !== "boolean") return bad("ok must be true or false");
    if (value.error !== undefined && (typeof value.error !== "string" || value.error.length > MAX_ERROR_CHARS)) return bad("error must be short text");
    return { ok: true, value: { v: value.v, reply_to: value.reply_to, ok: value.ok, ...(value.error === undefined ? {} : { error: value.error }) } };
  }
  if (!is_message_id(value.id)) return bad("a request needs an id of 1 to 32 letters, digits, - or _");
  if (typeof value.kind !== "string" || !Object.hasOwn(kinds, value.kind)) return bad("the kind is not on the allow list");
  const given = value.args ?? {};
  if (!is_record(given)) return bad("args must be a table");
  const args: ModuleArgs = {};
  for (const [name, kind] of Object.entries(kinds[value.kind]!.args)) {
    const problem = arg_problem(kind, given[name]);
    if (problem !== undefined) return bad(`${value.kind} ${name} ${problem}`);
    args[name] = given[name] as number | string;
  }
  return { ok: true, value: { v: value.v, id: value.id, kind: value.kind, args } };
}

// `refused` names each request that failed its check, still had a usable id and either names no listed kind or expects a reply, so its reader can answer with an error. A push that fails its check is dropped. A message with no usable id, or of another version, is dropped without a word.
export type MessageList = { messages: ModuleMessage[]; refused: { id: string; error: string }[] };

// A whole list from foreign or own storage: a size cap, a count cap, then message by message. The list fails only when it is not a list or is too big. A bad message is skipped and never takes a good one down.
export function validate_message_list(value: unknown, kinds: KindTable): Checked<MessageList> {
  if (!Array.isArray(value)) return bad("a message list must be a list");
  if (value.length > MAX_MESSAGES) return bad("a message list holds too many messages");
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return bad("a message list is not plain data");
  }
  if (size > MAX_MESSAGE_LIST_BYTES) return bad("a message list is too large");
  const list: MessageList = { messages: [], refused: [] };
  for (const item of value) {
    const checked = validate_message(item, kinds);
    if (checked.ok) list.messages.push(checked.value);
    else if (is_record(item) && item.v === BROWSER_MODULE_PROTOCOL_VERSION && item.reply_to === undefined && is_message_id(item.id) && (typeof item.kind !== "string" || !Object.hasOwn(kinds, item.kind) || kinds[item.kind]!.reply)) list.refused.push({ id: item.id, error: checked.problem.slice(0, MAX_ERROR_CHARS) });
  }
  return { ok: true, value: list };
}

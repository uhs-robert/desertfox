// The channel between the extension and the browser module, an optional script that Firefox loads with browser privileges (see docs/design/host.md, "Browser module").
// The extension writes the state and reads the hello, both in its own `storage.session`. The module is a thin executor: it receives only typed rows (a fixed command id with checked args) and never code, selectors or URLs.
// The module file holds a copy of the names and the version, and a test keeps the copy equal to this file.

import { MODES, SCROLL_TO_DEFAULT_AXIS } from "./command.ts";
import type { Mode } from "./command.ts";

// The major version. It moves only for a breaking change, and a different value means the module claims nothing. Anything added later is an optional field that validators ignore when they do not know it.
export const BROWSER_MODULE_PROTOCOL_VERSION = 1;

// The three keys sit in `config/storage_keys.ts` with the others: the state (the extension writes it while the setting is on, the module reads it), the hello (the module writes it, the extension reads it, the only thing the module sends) and the status (what became of the last hello, for the settings page).
export { BROWSER_MODULE_HELLO_STORAGE_KEY, BROWSER_MODULE_STATE_STORAGE_KEY, BROWSER_MODULE_STATUS_STORAGE_KEY } from "./config/storage_keys.ts";

export const MAX_KEY_ROWS = 32;
export const MAX_STATE_TABS = 1024;
export const MAX_KEY_CHARS = 24;
export const MAX_HELLO_BYTES = 256;
export const MAX_MODULE_VERSION_CHARS = 32;
// The extension reads the hello at most this often.
export const HELLO_MIN_INTERVAL_MS = 1000;

type ArgSpec = { kind: "int" | "number"; min: number; max: number; fallback: number } | { kind: "axis"; fallback: string };

// The commands the module may run, with the exact args each takes. The writer fills every default, so the module reads complete args.
export const MODULE_COMMAND_ARGS = {
  "tab.next": {},
  "tab.prev": {},
  "scroll.lines": { count: { kind: "int", min: -10000, max: 10000, fallback: 1 } },
  "scroll.pixels": { dx: { kind: "int", min: -100000, max: 100000, fallback: 0 }, dy: { kind: "int", min: -100000, max: 100000, fallback: 0 } },
  "scroll.pages": { fraction: { kind: "number", min: -10, max: 10, fallback: 1 }, count: { kind: "int", min: -100, max: 100, fallback: 1 } },
  "scroll.to": { percent: { kind: "number", min: 0, max: 100, fallback: Number.NaN }, axis: { kind: "axis", fallback: SCROLL_TO_DEFAULT_AXIS } },
} as const satisfies Record<string, Record<string, ArgSpec>>;

export type ModuleCommandId = keyof typeof MODULE_COMMAND_ARGS;
export const MODULE_COMMAND_IDS = Object.keys(MODULE_COMMAND_ARGS) as ModuleCommandId[];

export type ModuleArgs = Record<string, number | string>;
export type KeyRow = { key: string; id: ModuleCommandId; args: ModuleArgs };
export type TabState = { mode: Mode; live: boolean };
export type ModuleState = { v: number; enabled: boolean; keys: KeyRow[]; tabs: Record<string, TabState> };
export type ModuleHello = { v: number; module_version: string };

export type Checked<T> = { ok: true; value: T } | { ok: false; problem: string };
const bad = (problem: string): { ok: false; problem: string } => ({ ok: false, problem });

const is_record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const is_module_command_id = (id: unknown): id is ModuleCommandId => typeof id === "string" && Object.hasOwn(MODULE_COMMAND_ARGS, id);
// One normalized key token: a character, or a name in angle brackets. No spaces or control characters.
const is_key_token = (key: unknown): key is string => typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_CHARS && !/[\s\p{Cc}]/u.test(key);

function arg_problem(spec: ArgSpec, value: unknown): string | undefined {
  if (spec.kind === "axis") return value === "x" || value === "y" ? undefined : "must be x or y";
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
  if (spec.kind === "int" && !Number.isInteger(value)) return "must be a whole number";
  return value < spec.min || value > spec.max ? `must be from ${spec.min} to ${spec.max}` : undefined;
}

// Returns the args with every default filled, or the first problem. A name the command does not take is ignored, so a newer extension can add an optional arg.
export function check_module_args(id: ModuleCommandId, args: unknown): Checked<ModuleArgs> {
  const specs: Record<string, ArgSpec> = MODULE_COMMAND_ARGS[id];
  if (args !== undefined && !is_record(args)) return bad("args must be a table");
  const given = args ?? {};
  const filled: ModuleArgs = {};
  for (const [name, spec] of Object.entries(specs)) {
    const value = Object.hasOwn(given, name) ? given[name] : spec.fallback;
    const problem = arg_problem(spec, value);
    if (problem !== undefined) return bad(`${id} ${name} ${problem}`);
    filled[name] = value as number | string;
  }
  return { ok: true, value: filled };
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
  // `tabs` is optional: a state without it holds no tab, so the module takes nothing it cannot place.
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
  if (typeof version !== "string" || version.length === 0 || version.length > MAX_MODULE_VERSION_CHARS || /[\p{Cc}]/u.test(version)) return bad("module_version must be text of 1 to 32 characters");
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

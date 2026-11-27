// The extension side of the browser module channel (`src/shared/browser_module_protocol.ts`). While the `browser_module` setting is on, it keeps the module's state in `storage.session`:
// the toolbar switch, the single-key bindings the module may run, and per tab the mode and whether DesertFox is live there. It also reads the module's hello and records what became of it.
// Everything here is a copy rebuilt from stored data (the keymap, the disabled flag, the tab mode records), so a background restart loses nothing. An extension reload empties `storage.session`, and the module then claims nothing until the start writes the state again.

import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, TreeNode } from "../shared/prefix_tree.ts";
import { DISABLED_STORAGE_KEY, TAB_MODE_STORAGE_PREFIX } from "../shared/config/storage_keys.ts";
import { is_module_command_id } from "../shared/browser_module_protocol.ts";
import type { KeyRow, ModuleState, TabState } from "../shared/browser_module_protocol.ts";
import {
  BROWSER_MODULE_HELLO_STORAGE_KEY,
  BROWSER_MODULE_PROTOCOL_VERSION,
  BROWSER_MODULE_STATE_STORAGE_KEY,
  BROWSER_MODULE_STATUS_STORAGE_KEY,
  check_module_args,
  HELLO_MIN_INTERVAL_MS,
  MAX_KEY_ROWS,
  MAX_STATE_TABS,
  status_of_hello,
  validate_module_state,
} from "../shared/browser_module_protocol.ts";
import { touches_settings } from "../shared/storage_watch.ts";
import { keep_chain } from "../shared/swallow.ts";
import { mode_of_record } from "./tab_modes.ts";
import type { TabModeRecord } from "./tab_modes.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

// A leaf the module may run: one step, no guard, no key to wait for, a command and args the protocol lists. Anything else stays with the content script.
function row_of(key: string, node: TreeNode): KeyRow | undefined {
  if (node.kind !== "leaf" || node.steps.length !== 1) return undefined;
  if (node.when_focus !== undefined || node.when_present !== undefined || node.otherwise !== undefined || node.otherwise_page !== undefined) return undefined;
  const { invocation, capture, register } = node.steps[0]!;
  if (capture !== undefined || register !== undefined || invocation.prompt !== undefined || !is_module_command_id(invocation.id)) return undefined;
  const args = check_module_args(invocation.id, invocation.args);
  return args.ok ? { key, id: invocation.id, args: args.value } : undefined;
}

// The single-key normal bindings the module may run, in key order. Sequences (`gg`) and counts are the content script's.
export function key_rows_of(keymap: CompiledKeymap | undefined): KeyRow[] {
  const children = keymap?.modes.normal?.children ?? {};
  const rows = Object.entries(children).flatMap(([key, node]) => row_of(key, node) ?? []);
  return rows.sort((a, b) => (a.key < b.key ? -1 : 1)).slice(0, MAX_KEY_ROWS);
}

export const tab_state_of = (record: TabModeRecord): TabState => ({ mode: mode_of_record(record), live: record.live === true });

// The tab id of a tab mode key, or undefined for the manual insert hold key that shares the prefix.
export const tab_id_of_key = (key: string): string | undefined => (key.startsWith(TAB_MODE_STORAGE_PREFIX) && /^\d{1,10}$/.test(key.slice(TAB_MODE_STORAGE_PREFIX.length)) ? key.slice(TAB_MODE_STORAGE_PREFIX.length) : undefined);

export type BrowserModuleDeps = {
  session: SessionStorage;
  is_on: () => Promise<boolean>;
  read_disabled: () => Promise<boolean>;
  read_keymap: () => Promise<CompiledKeymap | undefined>;
  read_tab_records: () => Promise<Record<string, TabModeRecord>>;
  now: () => number;
  // Runs `run` once after `ms`.
  later: (run: () => void, ms: number) => void;
};

export function create_browser_module(deps: BrowserModuleDeps) {
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(step: () => Promise<T>): Promise<T> => {
    const run = queue.then(step);
    queue = keep_chain(run);
    return run;
  };

  let last_hello_read = Number.NEGATIVE_INFINITY;
  let hello_pending = false;

  const read_state = async (): Promise<ModuleState | undefined> => {
    const checked = validate_module_state((await deps.session.get(BROWSER_MODULE_STATE_STORAGE_KEY))[BROWSER_MODULE_STATE_STORAGE_KEY]);
    return checked.ok ? checked.value : undefined;
  };

  // A state that fails its own validator is never written: the module would refuse it anyway.
  const write_state = async (state: ModuleState): Promise<void> => {
    if (validate_module_state(state).ok) await deps.session.set({ [BROWSER_MODULE_STATE_STORAGE_KEY]: state });
  };

  const read_hello_now = async (): Promise<void> => {
    last_hello_read = deps.now();
    await deps.session.set({ [BROWSER_MODULE_STATUS_STORAGE_KEY]: status_of_hello((await deps.session.get(BROWSER_MODULE_HELLO_STORAGE_KEY))[BROWSER_MODULE_HELLO_STORAGE_KEY]) });
  };

  const sync_now = async (): Promise<void> => {
    if (!(await deps.is_on())) {
      await deps.session.remove([BROWSER_MODULE_STATE_STORAGE_KEY, BROWSER_MODULE_STATUS_STORAGE_KEY]);
      return;
    }
    const disabled = await deps.read_disabled();
    const records = await deps.read_tab_records();
    const tabs: Record<string, TabState> = {};
    for (const [key, record] of Object.entries(records)) {
      const id = tab_id_of_key(key);
      if (id !== undefined && Object.keys(tabs).length < MAX_STATE_TABS) tabs[id] = tab_state_of(record);
    }
    await write_state({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: !disabled, keys: disabled ? [] : key_rows_of(await deps.read_keymap()), tabs });
    await read_hello_now();
  };

  const tab_changed_now = async (tab_id: string, record: TabModeRecord | undefined): Promise<void> => {
    if (!(await deps.is_on())) return;
    const state = await read_state();
    // No state yet: a full sync is on its way or the setting just turned off.
    if (state === undefined) return;
    const tabs = { ...state.tabs };
    if (record === undefined) delete tabs[tab_id];
    else if (tab_id in tabs || Object.keys(tabs).length < MAX_STATE_TABS) tabs[tab_id] = tab_state_of(record);
    await write_state({ ...state, tabs });
  };

  // At most one read per interval. A hello inside the interval is read when the interval ends, so the last one is not lost.
  const read_hello_limited = async (): Promise<void> => {
    if (!(await deps.is_on())) return;
    const wait = last_hello_read + HELLO_MIN_INTERVAL_MS - deps.now();
    if (wait <= 0) return enqueue(read_hello_now);
    if (hello_pending) return;
    hello_pending = true;
    deps.later(() => {
      hello_pending = false;
      void enqueue(async () => {
        if (await deps.is_on()) await read_hello_now();
      });
    }, wait);
  };

  const sync = (): Promise<void> => enqueue(sync_now);
  const tab_changed = (tab_id: string, record: TabModeRecord | undefined): Promise<void> => enqueue(() => tab_changed_now(tab_id, record));

  return {
    // Run at each background start, and after anything that changes the setting, the keymap or the switch.
    sync,
    tab_changed,
    read_hello: read_hello_limited,
    // The one `storage.onChanged` listener.
    storage_changed(changes: Record<string, { newValue?: unknown }>, area: string): void {
      if (area === "session") {
        if (BROWSER_MODULE_HELLO_STORAGE_KEY in changes) void read_hello_limited();
        return;
      }
      if (area !== "local") return;
      // A change of the setting alone leaves the compiled keymap as it is, so the settings status counts too.
      if (COMPILED_KEYMAP_STORAGE_KEY in changes || DISABLED_STORAGE_KEY in changes || touches_settings(changes, area)) void sync();
      for (const [key, change] of Object.entries(changes)) {
        const id = tab_id_of_key(key);
        if (id !== undefined) void tab_changed(id, change.newValue as TabModeRecord | undefined);
      }
    },
  };
}

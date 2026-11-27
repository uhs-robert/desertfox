import assert from "node:assert/strict";
import { test } from "node:test";
import { create_browser_module, key_rows_of, tab_id_of_key, tab_state_of } from "../../src/background/browser_module.ts";
import { apply_mode_report, create_tab_modes } from "../../src/background/tab_modes.ts";
import type { TabModeRecord } from "../../src/background/tab_modes.ts";
import { BROWSER_MODULE_HELLO_STORAGE_KEY, BROWSER_MODULE_STATE_STORAGE_KEY, BROWSER_MODULE_STATUS_STORAGE_KEY, HELLO_MIN_INTERVAL_MS, MAX_KEY_ROWS } from "../../src/shared/browser_module_protocol.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeLeaf, TreeNode } from "../../src/shared/prefix_tree.ts";
import { DISABLED_STORAGE_KEY, TAB_MODE_STORAGE_PREFIX } from "../../src/shared/config/storage_keys.ts";

const leaf = (id: string, args?: Record<string, unknown>, more: Partial<TreeLeaf> = {}): TreeLeaf => ({ kind: "leaf", steps: [{ invocation: { id, ...(args && { args }) }, runs_in: "background", count_rule: "repeat" }], ...more });
const keymap = (children: Record<string, TreeNode>): CompiledKeymap => ({ format_version: COMPILED_KEYMAP_VERSION, modes: { normal: { kind: "branch", children } }, mode_indicator: "always", which_key_delay_ms: 0, toast_ms: 1, toast_error_ms: 1 });

test("key rows take single-key leaves of the listed commands and follow a remap", () => {
  const rows = key_rows_of(keymap({ J: leaf("tab.next"), K: leaf("tab.prev"), j: leaf("scroll.lines", { count: 10 }), x: leaf("tab.close"), g: { kind: "branch", children: { g: leaf("scroll.to", { percent: 0 }) } } }));
  assert.deepEqual(rows.map((row) => [row.key, row.id]), [["J", "tab.next"], ["K", "tab.prev"], ["j", "scroll.lines"]]);
  assert.deepEqual(rows[2]!.args, { count: 10 });
  const remapped = key_rows_of(keymap({ "<A-j>": leaf("tab.next") }));
  assert.deepEqual(remapped.map((row) => row.key), ["<A-j>"]);
});

test("key rows skip guarded leaves, bad args, multi-step leaves and an absent keymap, and stop at the cap", () => {
  assert.deepEqual(key_rows_of(undefined), []);
  const two = leaf("tab.next");
  two.steps.push(two.steps[0]!);
  assert.deepEqual(key_rows_of(keymap({ a: leaf("tab.next", undefined, { when_focus: "input" }), b: leaf("scroll.lines", { count: "x" }), c: two, d: leaf("scroll.lines", { count: 1, evil: "x" }) })).map((row) => row.key), ["d"]);
  const many = Object.fromEntries(Array.from({ length: MAX_KEY_ROWS + 5 }, (_, index) => [`<F${index + 1}>`, leaf("tab.next")]));
  assert.equal(key_rows_of(keymap(many)).length, MAX_KEY_ROWS);
});

test("a tab record gives its mode and live mark, and only tab mode keys name a tab", () => {
  assert.deepEqual(tab_state_of({ top_mode: "insert", live: true }), { mode: "insert", live: true });
  assert.deepEqual(tab_state_of({ awaiting_commit: true }), { mode: "normal", live: false });
  assert.equal(tab_id_of_key(`${TAB_MODE_STORAGE_PREFIX}12`), "12");
  assert.equal(tab_id_of_key(`${TAB_MODE_STORAGE_PREFIX}insert_12`), undefined);
});

function setup(options: { on?: boolean; disabled?: boolean; records?: Record<string, TabModeRecord> } = {}) {
  const data = new Map<string, unknown>();
  const config = { on: options.on ?? true, disabled: options.disabled ?? false, records: options.records ?? {}, now: 10_000 };
  const timers: (() => void)[] = [];
  const session = {
    get: async (key: string | string[]) => Object.fromEntries([key].flat().filter((name) => data.has(name)).map((name) => [name, data.get(name)])),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value))),
    remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => data.delete(key)),
  };
  const module = create_browser_module({
    session: session as never,
    is_on: async () => config.on,
    read_disabled: async () => config.disabled,
    read_keymap: async () => keymap({ J: leaf("tab.next") }),
    read_tab_records: async () => config.records,
    now: () => config.now,
    later: (run) => void timers.push(run),
  });
  return { data, config, timers, module };
}

test("sync writes the state while the setting is on and removes it when off", async () => {
  const { data, config, module } = setup({ records: { [`${TAB_MODE_STORAGE_PREFIX}3`]: { top_mode: "normal", live: true }, [`${TAB_MODE_STORAGE_PREFIX}insert_3`]: true as never } });
  await module.sync();
  assert.deepEqual(data.get(BROWSER_MODULE_STATE_STORAGE_KEY), { v: 1, enabled: true, keys: [{ key: "J", id: "tab.next", args: {} }], tabs: { "3": { mode: "normal", live: true } } });
  assert.deepEqual(data.get(BROWSER_MODULE_STATUS_STORAGE_KEY), { result: "waiting" });
  config.on = false;
  await module.sync();
  assert.equal(data.has(BROWSER_MODULE_STATE_STORAGE_KEY) || data.has(BROWSER_MODULE_STATUS_STORAGE_KEY), false);
});

test("the toolbar switch off writes enabled false and no keys", async () => {
  const { data, module } = setup({ disabled: true });
  await module.sync();
  assert.deepEqual(data.get(BROWSER_MODULE_STATE_STORAGE_KEY), { v: 1, enabled: false, keys: [], tabs: {} });
});

test("a tab change patches one tab, and a removed record drops it", async () => {
  const { data, module } = setup();
  await module.sync();
  await module.tab_changed("5", { top_mode: "insert", live: true });
  assert.deepEqual((data.get(BROWSER_MODULE_STATE_STORAGE_KEY) as { tabs: unknown }).tabs, { "5": { mode: "insert", live: true } });
  await module.tab_changed("5", undefined);
  assert.deepEqual((data.get(BROWSER_MODULE_STATE_STORAGE_KEY) as { tabs: unknown }).tabs, {});
});

test("storage changes route to the writer and the hello reader", async () => {
  const { data, module } = setup();
  module.storage_changed({ [COMPILED_KEYMAP_STORAGE_KEY]: {} }, "local");
  module.storage_changed({ [`${TAB_MODE_STORAGE_PREFIX}9`]: { newValue: { top_mode: "normal", live: true } } }, "local");
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "0.2" });
  module.storage_changed({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: {} }, "session");
  module.storage_changed({ [DISABLED_STORAGE_KEY]: {} }, "sync");
  await module.sync();
  assert.deepEqual(data.get(BROWSER_MODULE_STATUS_STORAGE_KEY), { result: "matched", module_version: "0.2", module_v: 1 });
});

test("the hello is read at most once a second, and a hello inside the interval is read when it ends", async () => {
  const { data, config, timers, module } = setup();
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1" });
  await module.read_hello();
  assert.equal((data.get(BROWSER_MODULE_STATUS_STORAGE_KEY) as { result: string }).result, "matched");
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 2, module_version: "2" });
  config.now += 100;
  await module.read_hello();
  await module.read_hello();
  assert.equal((data.get(BROWSER_MODULE_STATUS_STORAGE_KEY) as { result: string }).result, "matched");
  assert.equal(timers.length, 1);
  config.now += HELLO_MIN_INTERVAL_MS;
  timers[0]!();
  await module.sync();
  assert.equal((data.get(BROWSER_MODULE_STATUS_STORAGE_KEY) as { result: string }).result, "mismatch");
});

test("a junk hello gives an invalid status and leaves the state alone", async () => {
  const { data, config, module } = setup();
  await module.sync();
  config.now += HELLO_MIN_INTERVAL_MS;
  const before = JSON.stringify(data.get(BROWSER_MODULE_STATE_STORAGE_KEY));
  config_hello(data, { v: 1, module_version: "x".repeat(500) });
  await module.read_hello();
  assert.equal((data.get(BROWSER_MODULE_STATUS_STORAGE_KEY) as { result: string }).result, "invalid");
  assert.equal(JSON.stringify(data.get(BROWSER_MODULE_STATE_STORAGE_KEY)), before);
});
const config_hello = (data: Map<string, unknown>, value: unknown) => void data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, value);

test("the top frame's report sets live and a load start clears it with the record", async () => {
  assert.equal(apply_mode_report({}, { frame_id: 0, mode: "normal", focus: true }).live, true);
  assert.equal(apply_mode_report({}, { frame_id: 4, mode: "normal", focus: false }).live, undefined);
  const data = new Map<string, unknown>();
  const storage = {
    get: async (key: string | null) => (key === null ? Object.fromEntries(data) : data.has(key) ? { [key]: data.get(key) } : {}),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value))),
    remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => data.delete(key)),
  };
  const modes = create_tab_modes(storage as never);
  await modes.report(1, { frame_id: 0, mode: "normal", focus: true });
  assert.equal((data.get(`${TAB_MODE_STORAGE_PREFIX}1`) as TabModeRecord).live, true);
  await modes.forget_on_navigation(1, { status: "loading" });
  assert.equal((data.get(`${TAB_MODE_STORAGE_PREFIX}1`) as TabModeRecord).live, undefined);
});

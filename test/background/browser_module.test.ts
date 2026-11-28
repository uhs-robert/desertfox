import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { create_browser_module, key_rows_of, module_setting_on, read_bar_config, stored_setting_on, tab_id_of_key, tab_state_of } from "../../src/background/browser_module.ts";
import type { CheckCommandArgs } from "../../src/background/browser_module.ts";
import { create_module_call } from "../../src/background/browser_module_call.ts";
import { apply_mode_report, create_tab_modes } from "../../src/background/tab_modes.ts";
import type { TabModeRecord } from "../../src/background/tab_modes.ts";
import { DEVTOOLS_HINT_KEY, DEVTOOLS_TREE_KEYS, DEVTOOLS_VISUAL_KEY, DEVTOOLS_VISUAL_KEYS, EXTENSION_TO_MODULE_KINDS, MESSAGE_MIN_GAP_MS, MODULE_TO_EXTENSION_KINDS, validate_message } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY, BROWSER_MODULE_HELLO_STORAGE_KEY, BROWSER_MODULE_STATE_STORAGE_KEY, BROWSER_MODULE_STATUS_STORAGE_KEY, DEFAULT_MAX_AGE_MS, HELLO_MIN_INTERVAL_MS, MAX_KEY_ROWS } from "../../src/shared/browser_module_protocol.ts";
import type { KindTable } from "../../src/shared/browser_module_protocol.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeLeaf, TreeNode } from "../../src/shared/prefix_tree.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { CONFIG_STATUS_STORAGE_KEY, DISABLED_STORAGE_KEY, TAB_MODE_STORAGE_PREFIX } from "../../src/shared/config/storage_keys.ts";

const real_check: CheckCommandArgs = (id, args) => {
  const command = registry.get(id);
  const checked = command && check_args(command, args);
  return checked?.ok ? checked.args : undefined;
};

const leaf = (id: string, args?: Record<string, unknown>, more: Partial<TreeLeaf> = {}): TreeLeaf => ({ kind: "leaf", steps: [{ invocation: { id, ...(args && { args }) }, runs_in: "background", count_rule: "repeat" }], ...more });
const keymap = (children: Record<string, TreeNode>): CompiledKeymap => ({ format_version: COMPILED_KEYMAP_VERSION, modes: { normal: { kind: "branch", children } }, mode_indicator: "always", which_key_delay_ms: 0, toast_ms: 1, toast_error_ms: 1 });

test("key rows take single-key leaves of the listed commands and follow a remap", () => {
  const rows = key_rows_of(keymap({ J: leaf("tab.next"), K: leaf("tab.prev"), j: leaf("scroll.lines", { count: 10 }), x: leaf("tab.close"), g: { kind: "branch", children: { g: leaf("scroll.to", { percent: 0 }) } } }), real_check);
  assert.deepEqual(rows.map((row) => [row.key, row.id]), [["J", "tab.next"], ["K", "tab.prev"], ["j", "scroll.lines"]]);
  assert.deepEqual(rows[2]!.args, { count: 10 });
  assert.deepEqual(key_rows_of(keymap({ "<A-j>": leaf("tab.next") }), real_check).map((row) => row.key), ["<A-j>"]);
});

test("the registry owns arg limits and defaults: a count the registry accepts is kept, a default is filled from it", () => {
  const [big, plain] = key_rows_of(keymap({ a: leaf("scroll.lines", { count: 10001 }), b: leaf("scroll.pages", { fraction: 0.5 }) }), real_check);
  assert.deepEqual(big!.args, { count: 10001 });
  assert.deepEqual(plain!.args, { fraction: 0.5, count: 1 });
});

test("key rows skip guarded leaves, args the registry refuses, multi-step leaves and an absent keymap, and stop at the cap", () => {
  assert.deepEqual(key_rows_of(undefined, real_check), []);
  const two = leaf("tab.next");
  two.steps.push(two.steps[0]!);
  assert.deepEqual(key_rows_of(keymap({ a: leaf("tab.next", undefined, { when_focus: "input" }), b: leaf("scroll.lines", { count: "x" }), c: two, d: leaf("scroll.lines", { count: 1 }), e: leaf("scroll.lines", { count: 1, evil: "x" }) }), real_check).map((row) => row.key), ["d"]);
  const many = Object.fromEntries(Array.from({ length: MAX_KEY_ROWS + 5 }, (_, index) => [`<F${index + 1}>`, leaf("tab.next")]));
  assert.equal(key_rows_of(keymap(many), real_check).length, MAX_KEY_ROWS);
});

test("a tab record gives its mode and live mark, and only tab mode keys name a tab", () => {
  assert.deepEqual(tab_state_of({ top_mode: "insert", live: true }), { mode: "insert", live: true });
  assert.deepEqual(tab_state_of({ awaiting_commit: true }), { mode: "normal", live: false });
  assert.equal(tab_id_of_key(`${TAB_MODE_STORAGE_PREFIX}12`), "12");
  assert.equal(tab_id_of_key(`${TAB_MODE_STORAGE_PREFIX}insert_12`), undefined);
});

const TEST_KINDS: { from_module: KindTable; from_extension: KindTable } = {
  from_module: { push: { args: { n: "int" }, reply: false }, ask: { args: { axis: "axis" }, reply: true } },
  from_extension: { note: { args: {}, reply: true }, nudge: { args: { n: "int" }, reply: false } },
};

const BAR_CONFIG = { left: ["mode", "pending"] as ("mode" | "pending")[], right: ["tabs"] as "tabs"[], border: "auto" as const };

function setup(options: { on?: boolean; disabled?: boolean; records?: Record<string, TabModeRecord>; bar_setting?: boolean; theme?: unknown; blur_on_load?: boolean; kinds?: typeof TEST_KINDS } = {}) {
  const data = new Map<string, unknown>();
  const bar_changes = { count: 0 };
  const config = { bar_setting: options.bar_setting ?? true, theme: options.theme as unknown, on: options.on ?? true, disabled: options.disabled ?? false, records: options.records ?? {}, now: 10_000, gets: [] as string[] };
  const timers: (() => void)[] = [];
  const calls: unknown[] = [];
  const replies: unknown[] = [];
  const statuses: unknown[] = [];
  const session = {
    get: async (key: string | string[]) => {
      config.gets.push(...[key].flat());
      return Object.fromEntries([key].flat().filter((name) => data.has(name)).map((name) => [name, data.get(name)]));
    },
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value))),
    remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => data.delete(key)),
  };
  const module = create_browser_module({
    session: session as never,
    is_on: async () => config.on,
    read_disabled: async () => config.disabled,
    ...(options.blur_on_load === undefined ? {} : { read_blur_on_load: async () => options.blur_on_load! }),
    read_keymap: async () => keymap({ J: leaf("tab.next") }),
    read_tab_records: async () => config.records,
    check_args: real_check,
    read_bar_config: async () => (config.bar_setting ? BAR_CONFIG : undefined),
    read_theme: async () => config.theme,
    on_bar_change: () => void bar_changes.count++,
    kinds: options.kinds ?? TEST_KINDS,
    handlers: {
      push: async (args) => void calls.push(["push", args]),
      ask: async (args) => {
        if (args.axis === "y") throw new Error("boom");
        calls.push(["ask", args]);
      },
    },
    on_reply: (reply) => void replies.push(reply),
    on_status: (status) => void statuses.push(status),
    now: () => config.now,
    later: (run) => void timers.push(run),
  });
  // The queue is first in, first out, and a sync asks for an input read behind itself, so three turns settle it.
  const flush = async () => {
    for (let turn = 0; turn < 3; turn++) await module.tab_changed("0", undefined);
  };
  const hello_reads = () => config.gets.filter((key) => key === BROWSER_MODULE_HELLO_STORAGE_KEY).length;
  // The module says it built the bar, and the extension has read it.
  const raise_bar = async () => {
    data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1", bar: true });
    config.now += HELLO_MIN_INTERVAL_MS + 1;
    module.read_hello();
    timers.splice(0).forEach((run) => run());
    await flush();
  };
  return { data, config, timers, module, flush, calls, replies, statuses, hello_reads, bar_changes, raise_bar };
}
const status_of = (data: Map<string, unknown>) => (data.get(BROWSER_MODULE_STATUS_STORAGE_KEY) as { result: string } | undefined)?.result;

test("sync writes the state while the setting is on and removes it when off", async () => {
  const { data, config, module, flush } = setup({ records: { [`${TAB_MODE_STORAGE_PREFIX}3`]: { top_mode: "normal", live: true }, [`${TAB_MODE_STORAGE_PREFIX}insert_3`]: true as never } });
  await module.sync();
  await flush();
  assert.deepEqual(data.get(BROWSER_MODULE_STATE_STORAGE_KEY), { v: 1, enabled: true, keys: [{ key: "J", id: "tab.next", args: {} }], tabs: { "3": { mode: "normal", live: true } }, bar: BAR_CONFIG, page_hints: true });
  assert.deepEqual(data.get(BROWSER_MODULE_STATUS_STORAGE_KEY), { result: "waiting" });
  config.on = false;
  await module.sync();
  assert.equal([BROWSER_MODULE_STATE_STORAGE_KEY, BROWSER_MODULE_STATUS_STORAGE_KEY, BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY].some((key) => data.has(key)), false);
});

test("the setting turning on writes the state and turning off clears it, read from the stored config status", async () => {
  const local = new Map<string, unknown>([[CONFIG_STATUS_STORAGE_KEY, { settings: { browser_module: false } }]]);
  const storage = { get: async (key: string) => (local.has(key) ? { [key]: local.get(key) } : {}) };
  assert.equal(await module_setting_on(storage), false);
  const { data, module, flush, config } = setup();
  const watched = (value: boolean) => {
    local.set(CONFIG_STATUS_STORAGE_KEY, { settings: { browser_module: value } });
    return value;
  };
  // The module under test reads the same stored value, as main.ts does.
  const sync_with = async (value: boolean) => {
    config.on = await module_setting_on({ get: async (key: string) => ({ [key]: { settings: { browser_module: watched(value) } } }) });
    module.storage_changed({ [CONFIG_STATUS_STORAGE_KEY]: {} }, "local");
    await flush();
  };
  await sync_with(true);
  assert.ok(data.has(BROWSER_MODULE_STATE_STORAGE_KEY), "turned on, the state is written");
  await sync_with(false);
  assert.equal(data.has(BROWSER_MODULE_STATE_STORAGE_KEY), false, "turned off, the state is gone");
  await sync_with(true);
  assert.ok(data.has(BROWSER_MODULE_STATE_STORAGE_KEY));
  assert.equal(await module_setting_on({ get: async () => ({}) }), false, "no status yet means off");
  assert.equal(await module_setting_on({ get: async (key: string) => ({ [key]: { settings: { browser_module: "yes" } } }) }), false);
});

test("the state carries blur_on_load only while the setting is on, read from the stored config status", async () => {
  for (const [blur_on_load, expected] of [[true, true], [false, undefined], [undefined, undefined]] as const) {
    const { data, module } = setup(blur_on_load === undefined ? {} : { blur_on_load });
    await module.sync();
    assert.equal((data.get(BROWSER_MODULE_STATE_STORAGE_KEY) as { blur_on_load?: boolean }).blur_on_load, expected, String(blur_on_load));
  }
  const status = (settings: Record<string, unknown>) => ({ get: async (key: string) => ({ [key]: { settings } }) });
  assert.equal(await stored_setting_on(status({ blur_on_load: true }), "blur_on_load"), true);
  assert.equal(await stored_setting_on(status({ blur_on_load: "yes", browser_module: true }), "blur_on_load"), false);
});


test("the toolbar switch off writes enabled false and no keys", async () => {
  const { data, module } = setup({ disabled: true });
  await module.sync();
  assert.deepEqual(data.get(BROWSER_MODULE_STATE_STORAGE_KEY), { v: 1, enabled: false, keys: [], tabs: {}, bar: BAR_CONFIG, page_hints: true });
});

test("a tab change patches one tab, and a removed record drops it", async () => {
  const { data, module } = setup();
  await module.sync();
  await module.tab_changed("5", { top_mode: "insert", live: true });
  assert.deepEqual((data.get(BROWSER_MODULE_STATE_STORAGE_KEY) as { tabs: unknown }).tabs, { "5": { mode: "insert", live: true } });
  await module.tab_changed("5", undefined);
  assert.deepEqual((data.get(BROWSER_MODULE_STATE_STORAGE_KEY) as { tabs: unknown }).tabs, {});
});

test("a hello event on the session area reads the hello and nothing else does", async () => {
  const { data, module, flush, hello_reads } = setup();
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "0.2" });
  module.storage_changed({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: {} }, "sync");
  module.storage_changed({ other: {} }, "session");
  module.storage_changed({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: {} }, "local");
  await flush();
  assert.equal(hello_reads(), 0, "another area or key reads nothing");
  assert.equal(status_of(data), undefined);
  module.storage_changed({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: {} }, "session");
  await flush();
  assert.deepEqual(data.get(BROWSER_MODULE_STATUS_STORAGE_KEY), { result: "matched", module_version: "0.2", module_v: 1 });
  assert.equal(hello_reads(), 1);
});

test("a flood of hellos, with the queue busy and syncs between, reads at most once a second and the last hello wins", async () => {
  const { data, config, timers, module, flush, hello_reads } = setup();
  for (let index = 0; index < 50; index++) {
    data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: `v${index}` });
    module.storage_changed({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: {} }, "session");
    if (index % 5 === 0) void module.sync();
    void module.tab_changed(String(index), { top_mode: "normal", live: true });
    config.now += 15;
  }
  await flush();
  assert.equal(hello_reads(), 1, "within one second, one read");
  assert.equal(timers.length, 1, "the rest wait for one timer");
  config.now += HELLO_MIN_INTERVAL_MS;
  timers.shift()!();
  await flush();
  assert.equal(hello_reads(), 2);
  assert.equal((data.get(BROWSER_MODULE_STATUS_STORAGE_KEY) as { module_version: string }).module_version, "v49");
});

test("a hello inside the interval is read when the timer fires, and only then", async () => {
  const { data, config, timers, module, flush } = setup();
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1" });
  module.read_hello();
  await flush();
  assert.equal(status_of(data), "matched");
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 2, module_version: "2" });
  config.now += 100;
  module.read_hello();
  await flush();
  assert.equal(timers.length, 1);
  assert.equal(status_of(data), "matched", "a timer that does nothing leaves the old status: the barrier cannot satisfy this");
  config.now += HELLO_MIN_INTERVAL_MS;
  timers[0]!();
  await flush();
  assert.equal(status_of(data), "mismatch");
});

test("a timer that fires before the interval ended waits again", async () => {
  const { data, config, timers, module, flush, hello_reads } = setup();
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1" });
  module.read_hello();
  await flush();
  module.read_hello();
  await flush();
  const before = hello_reads();
  timers.shift()!();
  await flush();
  assert.equal(hello_reads(), before, "the interval had not ended");
  assert.equal(timers.length, 1);
  config.now += HELLO_MIN_INTERVAL_MS;
  timers.shift()!();
  await flush();
  assert.equal(hello_reads(), before + 1);
});

test("a junk hello gives an invalid status and leaves the state alone", async () => {
  const { data, config, module, flush } = setup();
  await module.sync();
  await flush();
  config.now += HELLO_MIN_INTERVAL_MS;
  const before = JSON.stringify(data.get(BROWSER_MODULE_STATE_STORAGE_KEY));
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "x".repeat(500) });
  module.read_hello();
  await flush();
  assert.equal(status_of(data), "invalid");
  assert.equal(JSON.stringify(data.get(BROWSER_MODULE_STATE_STORAGE_KEY)), before);
});

const outbox_of = (data: Map<string, unknown>) => (data.get(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY) ?? []) as Record<string, unknown>[];
const from_module = (data: Map<string, unknown>, list: unknown[]) => data.set(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY, list);

test("a request of the module runs its handler, is answered once, and a push is answered never", async () => {
  const { data, config, module, flush, calls } = setup();
  from_module(data, [{ v: 1, id: "a1", kind: "ask", args: { axis: "x" } }, { v: 1, id: "p1", kind: "push", args: { n: 4 } }]);
  module.storage_changed({ [BROWSER_MODULE_FROM_MODULE_STORAGE_KEY]: {} }, "session");
  await flush();
  assert.deepEqual(calls, [["ask", { axis: "x" }], ["push", { n: 4 }]]);
  assert.deepEqual(outbox_of(data), [{ v: 1, reply_to: "a1", ok: true }]);
  // The module rewrites its list with the same messages and one more: only the new one runs.
  config.now += HELLO_MIN_INTERVAL_MS;
  from_module(data, [{ v: 1, id: "a1", kind: "ask", args: { axis: "x" } }, { v: 1, id: "p1", kind: "push", args: { n: 4 } }, { v: 1, id: "a2", kind: "ask", args: { axis: "y" } }]);
  module.storage_changed({ [BROWSER_MODULE_FROM_MODULE_STORAGE_KEY]: {} }, "session");
  await flush();
  assert.equal(calls.length, 2);
  assert.deepEqual(outbox_of(data), [{ v: 1, reply_to: "a1", ok: true }, { v: 1, reply_to: "a2", ok: false, error: "the request failed" }]);
});

test("an unlisted kind, bad args and a wrong version get an error reply or silence, never a handler", async () => {
  const { data, module, flush, calls } = setup();
  from_module(data, [{ v: 1, id: "u1", kind: "eval", args: { code: "1" } }, { v: 1, id: "b1", kind: "ask", args: { axis: "q" } }, { v: 1, id: "b2", kind: "push", args: { n: "x" } }, { v: 2, id: "w1", kind: "ask", args: { axis: "x" } }, "junk"]);
  module.storage_changed({ [BROWSER_MODULE_FROM_MODULE_STORAGE_KEY]: {} }, "session");
  await flush();
  assert.deepEqual(calls, []);
  assert.deepEqual(outbox_of(data).map((reply) => reply.reply_to), ["u1", "b1"]);
});

test("a kind with no handler answers an error when it expects a reply", async () => {
  const { data } = setup();
  from_module(data, [{ v: 1, id: "n1", kind: "ask", args: { axis: "x" } }]);
  const lone = create_browser_module({ session: { get: async (key: string | string[]) => Object.fromEntries([key].flat().filter((name) => data.has(name)).map((name) => [name, data.get(name)])), set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => data.set(key, value)), remove: async () => undefined } as never, is_on: async () => true, read_disabled: async () => false, read_keymap: async () => undefined, read_tab_records: async () => ({}), check_args: real_check, kinds: TEST_KINDS, handlers: {}, now: () => 0, later: () => undefined });
  lone.read_messages();
  await lone.tab_changed("0", undefined);
  await lone.tab_changed("0", undefined);
  assert.deepEqual(outbox_of(data), [{ v: 1, reply_to: "n1", ok: false, error: "no handler for this kind" }]);
});

test("the extension starts a call: a listed kind is written, an unlisted one is refused, and the module's reply is heard once", async () => {
  const { data, config, module, flush, replies } = setup();
  const sent = await module.send("note");
  assert.ok(sent.ok);
  assert.deepEqual(outbox_of(data).map((message) => [message.kind, message.id]), [["note", sent.ok ? sent.id : ""]]);
  assert.equal((await module.send("eval", { code: "1" })).ok, false);
  assert.equal((await module.send("nudge", { n: "x" })).ok, false);
  assert.ok((await module.send("nudge", { n: 2 })).ok);
  const id = sent.ok ? sent.id : "";
  from_module(data, [{ v: 1, reply_to: id, ok: true }]);
  module.storage_changed({ [BROWSER_MODULE_FROM_MODULE_STORAGE_KEY]: {} }, "session");
  await flush();
  config.now += HELLO_MIN_INTERVAL_MS;
  module.storage_changed({ [BROWSER_MODULE_FROM_MODULE_STORAGE_KEY]: {} }, "session");
  await flush();
  assert.deepEqual(replies, [{ v: 1, reply_to: id, ok: true }]);
  config.on = false;
  assert.equal((await module.send("note")).ok, false, "nothing is sent while the setting is off");
});

test("the extension's list keeps at most 16 messages, newest last", async () => {
  const { data, module } = setup();
  for (let index = 0; index < 20; index++) await module.send("nudge", { n: index });
  const list = outbox_of(data);
  assert.equal(list.length, 16);
  assert.deepEqual((list.at(-1)!.args as { n: number }).n, 19);
});

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

test("the module's list has its own short limit: a call a short gap after another is not held for a second", async () => {
  const { data, config, timers, module, flush, calls, hello_reads } = setup();
  const ask = (id: string) => from_module(data, [{ v: 1, id, kind: "ask", args: { axis: "x" } }]);
  const wake = () => module.storage_changed({ [BROWSER_MODULE_FROM_MODULE_STORAGE_KEY]: {} }, "session");
  ask("k1");
  wake();
  await flush();
  assert.equal(calls.length, 1);
  config.now += MESSAGE_MIN_GAP_MS;
  ask("k2");
  wake();
  await flush();
  assert.equal(calls.length, 2, "a gap of the short limit is enough");
  assert.equal(timers.length, 0);
  // Inside the gap the read waits for the gap, not for a second, and the later call still runs.
  config.now += 10;
  ask("k3");
  wake();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(timers.length, 1);
  config.now += MESSAGE_MIN_GAP_MS;
  timers.shift()!();
  await flush();
  assert.equal(calls.length, 3);
  assert.equal(hello_reads(), 0, "the hello was never read, so its own limit did not enter");
});

test("the message reads do not use up the hello's second", async () => {
  const { data, config, module, flush } = setup();
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1" });
  from_module(data, []);
  module.storage_changed({ [BROWSER_MODULE_FROM_MODULE_STORAGE_KEY]: {} }, "session");
  await flush();
  config.now += 10;
  module.storage_changed({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: {} }, "session");
  await flush();
  assert.equal(status_of(data), "matched", "the first hello read runs at once, whatever the message reads did");
});

// A module whose `ask` handler waits until the test settles it, with a clock that never makes the limiter wait.
function overlapping() {
  const data = new Map<string, unknown>();
  const runs: string[] = [];
  const pending = new Map<string, (value: string) => void>();
  const state = { on: true, clock: 0 };
  const module = create_browser_module({
    session: {
      get: async (key: string | string[]) => Object.fromEntries([key].flat().filter((name) => data.has(name)).map((name) => [name, structuredClone(data.get(name))])),
      set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value))),
      remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => data.delete(key)),
    } as never,
    is_on: async () => state.on,
    read_disabled: async () => false,
    read_keymap: async () => undefined,
    read_tab_records: async () => ({}),
    check_args: real_check,
    kinds: TEST_KINDS,
    handlers: {
      ask: (args) => new Promise<string>((resolve) => void (runs.push(String(args.axis)), pending.set(String(args.axis), resolve))),
      push: async (args) => void runs.push(`push ${String(args.n)}`),
    },
    now: () => (state.clock += MESSAGE_MIN_GAP_MS),
    later: () => assert.fail("the limiter waited"),
  });
  const settle = async () => {
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
  };
  const read = async (messages: unknown[]) => {
    data.set(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY, messages);
    module.read_messages();
    await settle();
  };
  const replies = () => ((data.get(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY) ?? []) as Record<string, unknown>[]).filter((message) => "reply_to" in message);
  return { data, runs, pending, state, read, settle, replies };
}
const ask_of = (id: string, axis: "x" | "y") => ({ v: 1, id, kind: "ask", args: { axis } });

test("two handlers run at once, their replies land in the order they settle, each by reply_to, and neither runs twice", async () => {
  const { runs, pending, read, settle, replies } = overlapping();
  const list = [ask_of("first", "x"), ask_of("second", "y")];
  await read(list);
  assert.deepEqual(runs, ["x", "y"], "the second started while the first still ran");
  pending.get("y")!("answer y");
  await settle();
  // The module rewrites its list while the first still runs.
  await read(list);
  pending.get("x")!("answer x");
  await settle();
  await read(list);
  assert.deepEqual(runs, ["x", "y"], "neither ran twice");
  assert.deepEqual(replies(), [
    { v: 1, reply_to: "second", ok: true, value: "answer y" },
    { v: 1, reply_to: "first", ok: true, value: "answer x" },
  ]);
});

test("a running request stays known after more than the remembered ids pass, so a rewrite does not start it again", async () => {
  const { runs, pending, read, settle, replies } = overlapping();
  const slow = ask_of("slow", "x");
  await read([slow]);
  for (let batch = 0; batch < 6; batch++) await read(Array.from({ length: 15 }, (_, index) => ({ v: 1, id: `p${batch}-${index}`, kind: "push", args: { n: index } })));
  await read([slow]);
  assert.equal(runs.filter((run) => run === "x").length, 1);
  pending.get("x")!("done");
  await settle();
  assert.deepEqual(replies().map((reply) => reply.reply_to), ["slow"]);
});

test("a reply that settles after the setting went off is not written", async () => {
  const { data, pending, read, settle, state } = overlapping();
  await read([ask_of("late", "x")]);
  state.on = false;
  pending.get("x")!("page text");
  await settle();
  assert.equal(data.has(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY), false);
});
const THEME_COLORS = { bg_core: "#101010", mode_normal: "#89b4fa", mode_insert: "#a6e3a1", mode_ignore: "#f38ba8", mode_caret: "#cba6f7", mode_visual: "#f9e2af", mode_item: "#94e2d5", mode_media: "#fab387", fg_core: "#fff", primary: "#89b4fa", secondary: "#b4befe", accent: "#f5c2e7" };
const state_of = (data: Map<string, unknown>) => data.get(BROWSER_MODULE_STATE_STORAGE_KEY) as { tabs: Record<string, Record<string, unknown>>; bar_theme?: unknown };

test("a bar report lands in the tab's entry, a child frame changes only the pending keys and a repeat writes nothing", async () => {
  const { data, module, flush, raise_bar } = setup({ records: { [`${TAB_MODE_STORAGE_PREFIX}3`]: { top_mode: "normal", live: true } } });
  await module.sync();
  await flush();
  await raise_bar();
  await module.bar_report(3, 0, false, { pending: ["g"], count: 2, pass: true, site: "GMAIL", recording: "q", junk: 1 });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true, pending: ["g"], count: 2, pass: true, site: "GMAIL", recording: "q" });
  await module.bar_report(3, 5, false, { pending: ["<Space>", "z"] });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true, pending: ["<Space>", "z"], pass: true, site: "GMAIL", recording: "q" });
  const written = structuredClone(data.get(BROWSER_MODULE_STATE_STORAGE_KEY));
  data.delete(BROWSER_MODULE_STATE_STORAGE_KEY);
  await module.bar_report(3, 5, false, { pending: ["<Space>", "z"] });
  assert.equal(data.has(BROWSER_MODULE_STATE_STORAGE_KEY), false, "nothing changed, so nothing is written");
  data.set(BROWSER_MODULE_STATE_STORAGE_KEY, written);
});

test("a private tab's report never carries a site label", async () => {
  const { data, module, flush, raise_bar } = setup({ records: { [`${TAB_MODE_STORAGE_PREFIX}4`]: { top_mode: "normal", live: true } } });
  await module.sync();
  await flush();
  await raise_bar();
  await module.bar_report(4, 0, true, { pending: ["g"], site: "GMAIL" });
  assert.deepEqual(state_of(data).tabs["4"], { mode: "normal", live: true, pending: ["g"] });
});

test("the bar fields survive a mode change and a full sync, and go when the tab loads a new page or closes", async () => {
  const records: Record<string, TabModeRecord> = { [`${TAB_MODE_STORAGE_PREFIX}3`]: { top_mode: "normal", live: true } };
  const { data, module, flush, raise_bar } = setup({ records });
  await module.sync();
  await flush();
  await raise_bar();
  await module.bar_report(3, 0, false, { pending: ["g"] });
  await module.tab_changed("3", { top_mode: "insert", live: true });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "insert", live: true, pending: ["g"] });
  await module.sync();
  await flush();
  assert.deepEqual(state_of(data).tabs["3"]!.pending, ["g"]);
  await module.tab_changed("3", { awaiting_commit: true });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: false });
  await module.bar_report(3, 0, false, { pending: ["g"] });
  await module.bar_report(3, 7, false, { pending: ["z"] });
  await module.tab_changed("3", undefined);
  assert.equal("3" in state_of(data).tabs, false);
  delete records[`${TAB_MODE_STORAGE_PREFIX}3`];
  await module.sync();
  await flush();
  assert.equal("3" in state_of(data).tabs, false);
  // The id is reused by a new tab, which must not inherit the child frame's keys.
  records[`${TAB_MODE_STORAGE_PREFIX}3`] = { top_mode: "normal", live: true };
  await module.sync();
  await flush();
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true });
});

test("the bar is active only with the module setting, the bar setting and a hello that says bar, and a page's ask reads no storage", async () => {
  const { data, config, module, flush, timers } = setup();
  const settle = async () => {
    await module.sync();
    await flush();
    config.now += HELLO_MIN_INTERVAL_MS + 1;
    module.read_hello();
    timers.splice(0).forEach((run) => run());
    await flush();
    return module.bar_active();
  };
  assert.equal(await settle(), false, "no hello yet");
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1" });
  assert.equal(await settle(), false, "an older module that has no bar");
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1", bar: true });
  assert.equal(await settle(), true);
  const reads = config.gets.length;
  assert.equal(await module.bar_active(), true);
  assert.equal(config.gets.length, reads, "the answer is a copy");
  config.bar_setting = false;
  assert.equal(await settle(), false);
  config.bar_setting = true;
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 2, module_version: "1", bar: true });
  assert.equal(await settle(), false, "another protocol version claims nothing");
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1", bar: true });
  assert.equal(await settle(), true);
  config.on = false;
  assert.equal(await settle(), false);
});

test("a flip of the bar tells the pages once, from a hello, from the setting and from the module turning off", async () => {
  const { data, config, module, flush, bar_changes } = setup();
  await module.sync();
  await flush();
  assert.equal(bar_changes.count, 0);
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1", bar: true });
  config.now += HELLO_MIN_INTERVAL_MS + 1;
  module.read_hello();
  await flush();
  assert.equal(bar_changes.count, 1);
  config.now += HELLO_MIN_INTERVAL_MS + 1;
  module.read_hello();
  await flush();
  assert.equal(bar_changes.count, 1, "no change, no word");
  config.on = false;
  await module.sync();
  assert.equal(bar_changes.count, 2, "the module turning off takes the bar away");
  assert.equal(await module.bar_active(), false);
  const local = (settings: unknown) => ({ get: async (key: string) => ({ [key]: { settings } }) });
  assert.equal(await read_bar_config(local({ browser_bar: false })), undefined);
  assert.deepEqual(await read_bar_config(local({ browser_bar_left: ["mode"], browser_bar_right: [], browser_bar_border: "round" })), { left: ["mode"], right: [], border: "round" });
  assert.deepEqual((await read_bar_config(local({})))?.left, ["mode", "pending", "recording"], "an absent value is the default");
  assert.deepEqual((await read_bar_config(local({ browser_bar_left: ["nope"] })))?.border, "none", "a refused value is the default");
});

test("the state carries the bar settings while the bar setting is on and none when it is off", async () => {
  const { data, config, module, flush } = setup();
  await module.sync();
  await flush();
  assert.deepEqual((state_of(data) as { bar?: unknown }).bar, BAR_CONFIG);
  config.bar_setting = false;
  await module.sync();
  await flush();
  assert.equal("bar" in state_of(data), false);
});

test("the bar's reports are dropped when the bar goes away, and a load that keeps the old page keeps them", async () => {
  const records: Record<string, TabModeRecord> = { [`${TAB_MODE_STORAGE_PREFIX}3`]: { top_mode: "normal", live: true } };
  const { data, config, module, flush, raise_bar } = setup({ records });
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1", bar: true });
  await module.sync();
  await flush();
  await raise_bar();
  await module.bar_report(3, 0, false, { pending: ["g"], recording: "q" });
  await module.tab_changed("3", { top_mode: "normal", live: true, awaiting_commit: true });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true }, "hidden while the load runs");
  await module.tab_changed("3", { top_mode: "normal", live: true });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true, pending: ["g"], recording: "q" }, "the old page stayed");
  await module.bar_report(3, 7, false, { pending: ["z"] });
  config.bar_setting = false;
  await module.sync();
  await flush();
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true });
  config.bar_setting = true;
  await module.sync();
  await flush();
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true }, "nothing stale comes back");
});

test("a top frame report made while a child frame has the focus leaves the child's pending keys", async () => {
  const { data, module, flush, raise_bar } = setup({ records: { [`${TAB_MODE_STORAGE_PREFIX}3`]: { top_mode: "normal", live: true } } });
  await module.sync();
  await flush();
  await raise_bar();
  await module.bar_report(3, 7, false, { pending: ["g"], count: 2 });
  await module.bar_report(3, 0, false, { child: true, site: "FRAME" });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true, pending: ["g"], count: 2, site: "FRAME" });
  await module.bar_report(3, 0, false, { pending: ["z"] });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true, pending: ["z"] }, "a plain top report replaces the entry");
});

test("the state carries the bar theme from the stored theme and a theme change republishes it", async () => {
  const { data, config, module, flush } = setup({ theme: { dark: THEME_COLORS, light: { ...THEME_COLORS, bg_core: "#eff1f5" } } });
  await module.sync();
  await flush();
  const { accent: _, ...bar } = THEME_COLORS;
  assert.deepEqual(state_of(data).bar_theme, { dark: bar, light: { ...bar, bg_core: "#eff1f5" } });
  config.theme = { dark: { ...THEME_COLORS, mode_normal: "#000000" }, light: THEME_COLORS };
  module.storage_changed({ desertfox_theme: {} }, "local");
  await flush();
  assert.equal((state_of(data).bar_theme as { dark: { mode_normal: string } }).dark.mode_normal, "#000000");
  config.theme = undefined;
  await module.sync();
  await flush();
  assert.equal("bar_theme" in state_of(data), false, "no theme, no field");
});

test("the top frame's count does not show for a child frame, whichever comes first", async () => {
  const { data, module, flush, raise_bar } = setup({ records: { [`${TAB_MODE_STORAGE_PREFIX}3`]: { top_mode: "normal", live: true } } });
  await module.sync();
  await flush();
  await raise_bar();
  // The count was typed in the top frame, then the focus moved to a child.
  await module.bar_report(3, 0, false, { count: 3 });
  await module.bar_report(3, 0, false, { child: true });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true });
  await module.bar_report(3, 7, false, { pending: ["g"] });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true, pending: ["g"] });
  // The child reported first and the top frame's report of the move came after, with the top's old count still stored.
  await module.bar_report(3, 0, false, { count: 3 });
  await module.bar_report(3, 7, false, { pending: ["g"], count: 2 });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true, pending: ["g"], count: 2 });
  await module.bar_report(3, 0, false, { child: true, site: "FRAME" });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true, pending: ["g"], count: 2, site: "FRAME" });
  // The child loses the focus: the top frame's own report brings its keys back and drops the child's.
  await module.bar_report(3, 0, false, {});
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true });
});

test("a child frame that gets the focus back shows the keys it still holds", async () => {
  const { data, module, flush, raise_bar } = setup({ records: { [`${TAB_MODE_STORAGE_PREFIX}3`]: { top_mode: "normal", live: true } } });
  await module.sync();
  await flush();
  await raise_bar();
  await module.bar_report(3, 7, false, { pending: ["g"], count: 2 });
  // The focus leaves the child: the top frame's report drops the child's keys from the entry.
  await module.bar_report(3, 0, false, {});
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true });
  await module.bar_focus(3, 7);
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true, pending: ["g"], count: 2 });
  // A frame with nothing half typed shows nothing, and a closed tab forgets its frames.
  await module.bar_focus(3, 9);
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true });
  await module.tab_changed("3", undefined);
  await module.bar_focus(3, 7);
  assert.equal(state_of(data).tabs["3"], undefined);
});

test("a report that arrives after the bar went away is dropped", async () => {
  const { data, config, module, flush, raise_bar } = setup({ records: { [`${TAB_MODE_STORAGE_PREFIX}3`]: { top_mode: "normal", live: true } } });
  await module.sync();
  await flush();
  await raise_bar();
  config.bar_setting = false;
  await module.sync();
  await flush();
  await module.bar_report(3, 0, false, { pending: ["g"] });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true });
  config.bar_setting = true;
  await module.sync();
  await flush();
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true }, "nothing came back");
});

test("a report that arrives while a load runs stays out of the state and shows when the old page stays", async () => {
  const { data, module, flush, raise_bar } = setup({ records: { [`${TAB_MODE_STORAGE_PREFIX}3`]: { top_mode: "normal", live: true } } });
  await module.sync();
  await flush();
  await raise_bar();
  await module.tab_changed("3", { top_mode: "normal", live: true, awaiting_commit: true });
  await module.bar_report(3, 0, false, { pending: ["g"] });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true }, "hidden while the load runs");
  await module.tab_changed("3", { top_mode: "normal", live: true });
  assert.deepEqual(state_of(data).tabs["3"], { mode: "normal", live: true, pending: ["g"] }, "the kept report returns");
});

test("the extension stamps sent_at on its requests, and a module request older than its kind allows never runs", async () => {
  const { data, config, module, flush, calls } = setup();
  const sent = await module.send("note");
  assert.ok(sent.ok);
  assert.equal(outbox_of(data)[0]!.sent_at, config.now);
  from_module(data, [
    { v: 1, id: "old", kind: "ask", args: { axis: "x" }, sent_at: config.now - DEFAULT_MAX_AGE_MS - 1 },
    { v: 1, id: "stale_push", kind: "push", args: { n: 1 }, sent_at: 0 },
    { v: 1, id: "fresh", kind: "push", args: { n: 2 }, sent_at: config.now - 10 },
    { v: 1, id: "older_writer", kind: "push", args: { n: 3 } },
  ]);
  module.storage_changed({ [BROWSER_MODULE_FROM_MODULE_STORAGE_KEY]: {} }, "session");
  await flush();
  assert.deepEqual(calls, [["push", { n: 2 }], ["push", { n: 3 }]]);
  assert.deepEqual(outbox_of(data).filter((message) => "reply_to" in message), [{ v: 1, reply_to: "old", ok: false, error: "the request is too old" }]);
});

test("each status the module writes and its removal reach on_status", async () => {
  const { data, config, module, flush, statuses } = setup();
  await module.sync();
  await flush();
  assert.deepEqual(statuses, [{ result: "waiting" }]);
  config.now += 5000;
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1.0" });
  module.storage_changed({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: { newValue: {} } }, "session");
  await flush();
  assert.equal((statuses.at(-1) as { result: string }).result, "matched");
  config.on = false;
  await module.sync();
  assert.equal(statuses.at(-1), undefined);
  assert.equal(statuses.length, 3);
});

test("a call that timed out or lost its module leaves nothing in the list the module reads", async () => {
  const { data, config, module, flush } = setup();
  const timers: (() => void)[] = [];
  config.now = 20_000;
  const calls = create_module_call({
    send: (kind, args, on_id) => module.send(kind, args, on_id),
    withdraw: (id) => module.withdraw(id),
    read_status: async () => ({ result: "matched", module_version: "1", module_v: 1 }),
    later: (run) => {
      timers.push(run);
      return () => undefined;
    },
  });
  await module.sync();
  await flush();
  const timed_out = calls.call("note");
  const dropped = calls.call("note");
  const answered = calls.call("note");
  for (let turn = 0; turn < 5; turn++) await flush();
  assert.equal(outbox_of(data).length, 3);
  const [first, second, third] = outbox_of(data).map((message) => message.id as string);
  // The module answered the third call, so its request is not withdrawn and the reply settles it.
  calls.hear({ v: 1, reply_to: third!, ok: true });
  assert.deepEqual(await answered, { ok: true });
  timers[0]!();
  await timed_out;
  await flush();
  assert.deepEqual(outbox_of(data).map((message) => message.id), [second, third]);
  assert.ok(first);
  calls.status_changed(undefined);
  await dropped;
  await flush();
  assert.deepEqual(outbox_of(data).map((message) => message.id), [third]);
});

test("each new matched hello gets the DevTools key table once, and a mismatched hello gets none", async () => {
  const { data, config, module, flush, timers } = setup({ kinds: { from_module: MODULE_TO_EXTENSION_KINDS, from_extension: EXTENSION_TO_MODULE_KINDS } });
  const pushes = () => outbox_of(data).filter((message) => message.kind === "devtools.keys");
  const settle_reads = async () => {
    await flush();
    timers.splice(0).forEach((run) => run());
    await flush();
  };
  const hello = async (value: unknown) => {
    data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, value);
    config.now += HELLO_MIN_INTERVAL_MS + 1;
    module.storage_changed({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: { newValue: value } }, "session");
    await settle_reads();
  };
  await module.sync();
  await settle_reads();
  assert.deepEqual(pushes(), [], "no hello yet");
  await hello({ v: 2, module_version: "9" });
  assert.deepEqual(pushes(), [], "a mismatched module gets nothing");
  await hello({ v: 1, module_version: "1" });
  assert.equal(pushes().length, 1);
  assert.deepEqual(pushes()[0]!.args, { keys: DEVTOOLS_TREE_KEYS });
  config.now += HELLO_MIN_INTERVAL_MS + 1;
  await module.sync();
  await settle_reads();
  assert.equal(pushes().length, 1, "a sync with the same hello pushes nothing more");
  await hello({ v: 1, module_version: "1" });
  assert.equal(pushes().length, 2, "a hello said again, as after the pref went off and on, gets the table again");
  config.on = false;
  await module.sync();
  config.on = true;
  config.now += HELLO_MIN_INTERVAL_MS + 1;
  await module.sync();
  await settle_reads();
  assert.equal(pushes().length, 1, "the setting turned on again sends it to the module that is still there");
});

test("the hint key goes in the DevTools table only for a module whose hello says devtools_hints, since an older module refuses the whole table", async () => {
  const { data, config, module, flush, timers } = setup({ kinds: { from_module: MODULE_TO_EXTENSION_KINDS, from_extension: EXTENSION_TO_MODULE_KINDS } });
  const pushes = () => outbox_of(data).filter((message) => message.kind === "devtools.keys");
  const hello = async (value: unknown) => {
    data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, value);
    config.now += HELLO_MIN_INTERVAL_MS + 1;
    module.storage_changed({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: { newValue: value } }, "session");
    await flush();
    timers.splice(0).forEach((run) => run());
    await flush();
  };
  await module.sync();
  await hello({ v: 1, module_version: "1", devtools_hints: "yes" });
  assert.deepEqual(pushes().at(-1)!.args, { keys: DEVTOOLS_TREE_KEYS }, "a flag that is not true is no flag");
  await hello({ v: 1, module_version: "1", devtools_hints: true });
  assert.deepEqual(pushes().at(-1)!.args, { keys: [...DEVTOOLS_TREE_KEYS, DEVTOOLS_HINT_KEY] });
  assert.ok(validate_message(pushes().at(-1), EXTENSION_TO_MODULE_KINDS).ok);
});

test("the v row and the mode's keys go only to a module whose hello says devtools_visual, the mode's keys first", async () => {
  const { data, config, module, flush, timers } = setup({ kinds: { from_module: MODULE_TO_EXTENSION_KINDS, from_extension: EXTENSION_TO_MODULE_KINDS } });
  const devtools_pushes = () => outbox_of(data).filter((message) => message.kind === "devtools.keys" || message.kind === "devtools.visual_keys");
  const hello = async (value: unknown) => {
    data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, value);
    config.now += HELLO_MIN_INTERVAL_MS + 1;
    module.storage_changed({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: { newValue: value } }, "session");
    await flush();
    timers.splice(0).forEach((run) => run());
    await flush();
  };
  await module.sync();
  await hello({ v: 1, module_version: "1", devtools_hints: true });
  assert.deepEqual(devtools_pushes().map((message) => message.kind), ["devtools.keys"], "an older module gets no visual keys");
  assert.ok(!(devtools_pushes().at(-1)!.args as { keys: { key: string }[] }).keys.some(({ key }) => key === "v"));
  await hello({ v: 1, module_version: "1", devtools_hints: true, devtools_visual: true });
  const [visual, keys] = devtools_pushes().slice(-2);
  assert.equal(visual!.kind, "devtools.visual_keys");
  assert.deepEqual(visual!.args, { keys: DEVTOOLS_VISUAL_KEYS });
  assert.deepEqual(keys!.args, { keys: [...DEVTOOLS_TREE_KEYS, DEVTOOLS_HINT_KEY, DEVTOOLS_VISUAL_KEY] });
  for (const message of [visual, keys]) assert.ok(validate_message(message, EXTENSION_TO_MODULE_KINDS).ok);
});

test("a hello that changes while the DevTools table is on its way still gets its own table", async () => {
  const { data, config, module, flush, timers } = setup({ kinds: { from_module: MODULE_TO_EXTENSION_KINDS, from_extension: EXTENSION_TO_MODULE_KINDS } });
  const visual_pushes = () => outbox_of(data).filter((message) => message.kind === "devtools.visual_keys");
  const newer = { v: 1, module_version: "1", devtools_hints: true, devtools_visual: true };
  // The module rewrites its hello, adding a feature, while the write of the older hello's table is in flight.
  const write = data.set.bind(data);
  let overtaken = false;
  data.set = (key, value) => {
    if (key === BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY && !overtaken) {
      overtaken = true;
      write(BROWSER_MODULE_HELLO_STORAGE_KEY, newer);
      module.storage_changed({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: { newValue: newer } }, "session");
    }
    return write(key, value);
  };
  await module.sync();
  data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1", devtools_hints: true });
  config.now += HELLO_MIN_INTERVAL_MS + 1;
  module.storage_changed({ [BROWSER_MODULE_HELLO_STORAGE_KEY]: { newValue: {} } }, "session");
  for (let turn = 0; turn < 3; turn++) {
    await flush();
    config.now += HELLO_MIN_INTERVAL_MS + 1;
    timers.splice(0).forEach((run) => run());
  }
  await flush();
  assert.ok(overtaken);
  assert.equal(visual_pushes().length, 1);
});

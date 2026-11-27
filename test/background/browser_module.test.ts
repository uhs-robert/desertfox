import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { create_browser_module, key_rows_of, module_setting_on, tab_id_of_key, tab_state_of } from "../../src/background/browser_module.ts";
import type { CheckCommandArgs } from "../../src/background/browser_module.ts";
import { apply_mode_report, create_tab_modes } from "../../src/background/tab_modes.ts";
import type { TabModeRecord } from "../../src/background/tab_modes.ts";
import { MESSAGE_MIN_GAP_MS } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY, BROWSER_MODULE_HELLO_STORAGE_KEY, BROWSER_MODULE_STATE_STORAGE_KEY, BROWSER_MODULE_STATUS_STORAGE_KEY, HELLO_MIN_INTERVAL_MS, MAX_KEY_ROWS } from "../../src/shared/browser_module_protocol.ts";
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

function setup(options: { on?: boolean; disabled?: boolean; records?: Record<string, TabModeRecord> } = {}) {
  const data = new Map<string, unknown>();
  const config = { on: options.on ?? true, disabled: options.disabled ?? false, records: options.records ?? {}, now: 10_000, gets: [] as string[] };
  const timers: (() => void)[] = [];
  const calls: unknown[] = [];
  const replies: unknown[] = [];
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
    read_keymap: async () => keymap({ J: leaf("tab.next") }),
    read_tab_records: async () => config.records,
    check_args: real_check,
    kinds: TEST_KINDS,
    handlers: {
      push: async (args) => void calls.push(["push", args]),
      ask: async (args) => {
        if (args.axis === "y") throw new Error("boom");
        calls.push(["ask", args]);
      },
    },
    on_reply: (reply) => void replies.push(reply),
    now: () => config.now,
    later: (run) => void timers.push(run),
  });
  // The queue is first in, first out, and a sync asks for an input read behind itself, so three turns settle it.
  const flush = async () => {
    for (let turn = 0; turn < 3; turn++) await module.tab_changed("0", undefined);
  };
  const hello_reads = () => config.gets.filter((key) => key === BROWSER_MODULE_HELLO_STORAGE_KEY).length;
  return { data, config, timers, module, flush, calls, replies, hello_reads };
}
const status_of = (data: Map<string, unknown>) => (data.get(BROWSER_MODULE_STATUS_STORAGE_KEY) as { result: string } | undefined)?.result;

test("sync writes the state while the setting is on and removes it when off", async () => {
  const { data, config, module, flush } = setup({ records: { [`${TAB_MODE_STORAGE_PREFIX}3`]: { top_mode: "normal", live: true }, [`${TAB_MODE_STORAGE_PREFIX}insert_3`]: true as never } });
  await module.sync();
  await flush();
  assert.deepEqual(data.get(BROWSER_MODULE_STATE_STORAGE_KEY), { v: 1, enabled: true, keys: [{ key: "J", id: "tab.next", args: {} }], tabs: { "3": { mode: "normal", live: true } } });
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { create_browser_module } from "../../src/background/browser_module.ts";
import { create_browser_module_rpc, pages_setting_on } from "../../src/background/browser_module_rpc.ts";
import { dispatch } from "../../src/background/message_table.ts";
import type { Handlers } from "../../src/background/message_table.ts";
import type { ToBackground } from "../../src/shared/messages/map.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY, BROWSER_MODULE_PROTOCOL_VERSION as V, MAX_KIND_BYTES, MAX_MESSAGES, MESSAGE_MIN_GAP_MS, SNAPSHOT_PART_NAMES, SNAPSHOT_PARTS } from "../../src/shared/browser_module_protocol.ts";
import type { SnapshotPart } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY, CONFIG_STATUS_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { THEME_STORAGE_KEY } from "../../src/shared/theme/apply.ts";

type Sender = browser.runtime.MessageSender;
type Seen = { message: Record<string, unknown>; sender: Sender };

const TAB = { id: 7, url: "about:addons", index: 0, highlighted: false, active: true, pinned: false, incognito: false } as browser.tabs.Tab;

// The real base channel and the real message table, with a fake session and a handler table that records what reaches it.
function setup(options: { on?: boolean; tabs?: browser.tabs.Tab[]; parts?: Partial<Record<SnapshotPart, unknown>> } = {}) {
  const data = new Map<string, unknown>();
  const config = { on: options.on ?? true, tabs: options.tabs ?? [TAB], parts: { keymap: '{"keymap":1}', config: { settings: {} }, theme: { dark: {}, light: {} }, which_key: { title: [], rows: [] }, ...options.parts } as Record<SnapshotPart, unknown> };
  const session = {
    get: async (key: string | string[]) => Object.fromEntries([key].flat().filter((name) => data.has(name)).map((name) => [name, structuredClone(data.get(name))])),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value))),
    remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => data.delete(key)),
  };
  const seen: Seen[] = [];
  const answers: Record<string, (message: Record<string, unknown>) => unknown> = {};
  const record = (type: string) => (request: unknown, sender: Sender) => {
    seen.push({ message: request as Record<string, unknown>, sender });
    return answers[type]?.(request as Record<string, unknown>);
  };
  const handlers = {
    run: { from: "any", run: record("run") },
    mode_changed: { from: "frame", run: (request: unknown, at: { sender: Sender }) => record("mode_changed")(request, at.sender) },
    register_read: { from: "any", run: record("register_read") },
    snippet_run: { from: "any", run: record("snippet_run") },
    change_setting: { from: "page", refused: { ok: false }, run: record("change_setting") },
  } as unknown as Handlers<keyof ToBackground>;
  let module: ReturnType<typeof create_browser_module>;
  let clock = 0;
  const rpc = create_browser_module_rpc({
    session: session as never,
    is_on: async () => config.on,
    send: (kind, args) => module.send(kind, args),
    get_tab: async (tab_id) => config.tabs.find((tab) => tab.id === tab_id),
    dispatch: dispatch(handlers, () => false),
    read_part: Object.fromEntries(SNAPSHOT_PART_NAMES.map((part) => [part, async () => config.parts[part]])) as never,
    now: () => 1000,
  });
  module = create_browser_module({
    session: session as never,
    is_on: async () => true,
    read_disabled: async () => false,
    read_keymap: async () => undefined,
    read_tab_records: async () => ({}),
    check_args: () => undefined,
    handlers: rpc.handlers,
    // Each read is a gap after the last, so the limiter never waits.
    now: () => (clock += MESSAGE_MIN_GAP_MS),
    later: () => assert.fail("the limiter waited"),
  });
  let written = 0;
  // Chrome writes its list, and the extension reads it as it would on the change event.
  const from_module = async (messages: unknown) => {
    data.set(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY, messages);
    written += 1;
    module.read_messages();
    await settle();
  };
  const settle = async () => {
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
  };
  const outbox = () => (data.get(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY) ?? []) as Record<string, unknown>[];
  const page_replies = () => outbox().filter((message) => message.kind === "page_reply").map((message) => ({ ...(message.args as Record<string, unknown>), answer: JSON.parse((message.args as { answer: string }).answer) as unknown }));
  const base_replies = () => outbox().filter((message) => "reply_to" in message);
  return { data, config, rpc, module, seen, answers, from_module, settle, outbox, page_replies, base_replies, written: () => written };
}

let ids = 0;
const call = (message: unknown, patch: Record<string, unknown> = {}) => ({ v: V, id: `c${++ids}`, kind: "page_call", args: { tab_id: 7, call_id: `k${ids}`, message: typeof message === "string" ? message : JSON.stringify(message), ...patch } });

test("a page call reaches the message table with a sender built from the browser's facts, and its answer comes back", async () => {
  const { seen, answers, from_module, page_replies, base_replies, data } = setup();
  answers["register_read"] = () => Promise.resolve("yanked text");
  const request = call({ type: "register_read", name: "a" });
  await from_module([request]);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0]!.message, { type: "register_read", name: "a" });
  assert.deepEqual(seen[0]!.sender, { tab: TAB, frameId: 0, url: "about:addons" }, "no extension id, frame 0, the tab's own address");
  assert.deepEqual(page_replies(), [{ tab_id: 7, call_id: request.args.call_id, answer: { value: "yanked text" } }]);
  assert.deepEqual(base_replies(), [{ v: V, reply_to: request.id, ok: true }]);
  assert.deepEqual(data.get(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY), { "7": "about:addons" }, "the tab is marked locked");
});

test("a spoofed tab id, frame, sender or address inside the message is ignored", async () => {
  const { seen, from_module, config } = setup();
  config.tabs = [TAB, { ...TAB, id: 999, url: "https://bank.example/" }];
  await from_module([call({ type: "run", invocations: [], mode: "normal", tab: { id: 999 }, tab_id: 999, frameId: 3, sender: { id: "desertfox@uhs-robert", url: "moz-extension://x/" }, url: "https://bank.example/" })]);
  assert.equal(seen.length, 1);
  const { sender, message } = seen[0]!;
  assert.equal(sender.tab?.id, 7);
  assert.equal(sender.frameId, 0);
  assert.equal(sender.id, undefined);
  assert.equal(sender.url, "about:addons");
  assert.equal(message.url, "about:addons", "the address is the tab's");
});

test("a mode report from a locked page passes the frame guard with frame 0", async () => {
  const { seen, from_module } = setup();
  await from_module([call({ type: "mode_changed", mode: "normal" })]);
  assert.equal(seen[0]?.sender.frameId, 0);
});

test("a type off the allow list, a page-only type, junk text and a non-table never reach a handler", async () => {
  const { seen, from_module, base_replies, page_replies } = setup();
  const refused = [call({ type: "snippet_run", name: "x" }), call({ type: "change_setting", name: "browser_module", value: true }), call({ type: "eval", code: "1" }), call({ type: "load_bundle", name: "hints" }), call({ type: "read_keymap" }), call("not json {"), call("[1,2]"), call("null"), call('"run"'), call({ type: ["run"] }), call({ type: "__proto__" })];
  await from_module(refused);
  assert.deepEqual(seen, []);
  assert.deepEqual(page_replies(), []);
  const replies = base_replies();
  assert.equal(replies.length, refused.length);
  assert.ok(replies.every((reply) => reply.ok === false && reply.error === "the request failed"));
});

test("an oversize call, a bad envelope and a junk list are refused without a handler and without a throw", async () => {
  const { seen, from_module, base_replies } = setup();
  await from_module([call({ type: "run", invocations: [], mode: "normal", pad: "p".repeat(MAX_KIND_BYTES + 1024) })]);
  assert.deepEqual(seen, []);
  assert.deepEqual(base_replies(), [], "a list over the cap is refused whole");
  // One byte over the kind's limit, well under the list's cap.
  const sized = (pad: number) => call({ type: "run", invocations: [], mode: "normal", pad: "p".repeat(pad) });
  const big = sized(MAX_KIND_BYTES + 1 - JSON.stringify(sized(0)).length);
  assert.equal(JSON.stringify(big).length, MAX_KIND_BYTES + 1);
  await from_module([big]);
  assert.deepEqual(seen, []);
  assert.equal(base_replies().at(-1)?.reply_to, big.id, "a call over its kind's limit gets an error reply");
  assert.match(String(base_replies().at(-1)?.error), /over its size limit/);
  for (const junk of [undefined, null, "x", 5, {}, [null, 1, "x", []], Array.from({ length: MAX_MESSAGES + 1 }, () => call({ type: "run" })), [{ ...call({ type: "run" }), v: V + 1 }], [call({ type: "run" }, { tab_id: "7" })], [call({ type: "run" }, { call_id: "../x" })], [{ ...call({ type: "run" }), kind: "page_reply" }]]) {
    await from_module(junk);
  }
  assert.deepEqual(seen, []);
});

test("a call for a tab the browser does not know gives an error reply and marks nothing", async () => {
  const { seen, from_module, base_replies, data } = setup();
  const lost = call({ type: "run", invocations: [], mode: "normal" }, { tab_id: 12 });
  await from_module([lost]);
  assert.deepEqual(seen, []);
  assert.equal(base_replies()[0]?.ok, false);
  assert.equal(data.has(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY), false);
});

test("a handler that throws or rejects gives an error answer, and an answer too large to send gives an error too", async () => {
  const { answers, from_module, page_replies } = setup();
  answers["register_read"] = (message) => {
    if (message.name === "sync") throw new Error("sync boom");
    if (message.name === "big") return Promise.resolve("b".repeat(MAX_KIND_BYTES));
    if (message.name === "cycle") {
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      return Promise.resolve(cycle);
    }
    return Promise.reject(new Error("async boom"));
  };
  await from_module([call({ type: "register_read", name: "sync" }), call({ type: "register_read", name: "async" }), call({ type: "register_read", name: "big" }), call({ type: "register_read", name: "cycle" })]);
  assert.deepEqual(page_replies().map((reply) => (reply.answer as { error: string }).error).sort(), ["async boom", "sync boom", "the answer is not plain data", "the answer is too large"]);
});

test("a call is handled once, even when chrome rewrites its list", async () => {
  const { seen, from_module } = setup();
  const once = call({ type: "run", invocations: [], mode: "normal" });
  await from_module([once]);
  await from_module([once]);
  assert.equal(seen.length, 1);
});

test("with the setting off nothing is served, written or marked", async () => {
  const { seen, from_module, rpc, data, page_replies, base_replies } = setup({ on: false });
  await rpc.sync();
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  assert.deepEqual(seen, []);
  assert.deepEqual(page_replies(), []);
  assert.equal(base_replies()[0]?.ok, false);
  assert.equal(SNAPSHOT_PART_NAMES.some((part) => data.has(SNAPSHOT_PARTS[part].key)), false);
  assert.equal(data.has(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY), false);
  assert.equal(await rpc.is_locked_tab(7), false);
});

test("turning the setting off removes the snapshots and the locked tabs and drops waiting pushes", async () => {
  const { rpc, data, config, from_module } = setup();
  await rpc.sync();
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  const waiting = rpc.send_to_locked_tab(7, { type: "ping" });
  config.on = false;
  rpc.storage_changed({ [CONFIG_STATUS_STORAGE_KEY]: {} }, "local");
  await assert.rejects(waiting, /setting is off/);
  await rpc.sync();
  assert.equal([...SNAPSHOT_PART_NAMES.map((part) => SNAPSHOT_PARTS[part].key), BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY].some((key) => data.has(key)), false);
});

test("the setting reads both switches from the stored config status", async () => {
  const of = (settings: unknown) => pages_setting_on({ get: async (key: string) => ({ [key]: { settings } }) } as never);
  assert.equal(await of({ browser_module: true, browser_module_pages: true }), true);
  assert.equal(await of({ browser_module: false, browser_module_pages: true }), false, "needs the browser module setting");
  assert.equal(await of({ browser_module: true }), false, "off by default");
  assert.equal(await of({ browser_module: true, browser_module_pages: "yes" }), false);
  assert.equal(await pages_setting_on({ get: async () => ({}) } as never), false);
});

test("a push to a locked tab waits for the page's answer, and answers for another tab or call do nothing", async () => {
  const { rpc, outbox, from_module } = setup();
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  assert.equal(await rpc.is_locked_tab(7), true);
  const answer = rpc.send_to_locked_tab(7, { type: "get_selection" }, 0);
  await new Promise((resolve) => setImmediate(resolve));
  const push = outbox().find((message) => message.kind === "page_push") as { args: { tab_id: number; call_id: string; message: string } };
  assert.equal(push.args.tab_id, 7);
  assert.deepEqual(JSON.parse(push.args.message), { type: "get_selection" });
  const answer_of = (args: Record<string, unknown>, id: string) => ({ v: V, id, kind: "page_answer", args: { tab_id: 7, call_id: push.args.call_id, answer: JSON.stringify({ value: "picked" }), ...args } });
  // The junk answer of a3 settles the call first, and the later answers to it do nothing.
  const refused = assert.rejects(answer, /not JSON/);
  await from_module([answer_of({ tab_id: 8 }, "a1"), answer_of({ call_id: "nope" }, "a2"), answer_of({ answer: "junk" }, "a3")]);
  await from_module([answer_of({}, "a4"), answer_of({ answer: JSON.stringify({ value: "again" }) }, "a5")]);
  await refused;
  const second = rpc.send_to_locked_tab(7, { type: "get_selection" });
  await new Promise((resolve) => setImmediate(resolve));
  const next = outbox().filter((message) => message.kind === "page_push").at(-1) as { args: { call_id: string } };
  await from_module([{ v: V, id: "a6", kind: "page_answer", args: { tab_id: 7, call_id: next.args.call_id, answer: JSON.stringify({ value: "picked" }) } }]);
  assert.equal(await second, "picked");
  const failed = rpc.send_to_locked_tab(7, { type: "get_selection" });
  await new Promise((resolve) => setImmediate(resolve));
  const last = outbox().filter((message) => message.kind === "page_push").at(-1) as { args: { call_id: string } };
  const failed_check = assert.rejects(failed, /no listener/);
  await from_module([{ v: V, id: "a7", kind: "page_answer", args: { tab_id: 7, call_id: last.args.call_id, answer: JSON.stringify({ error: "no listener" }) } }]);
  await failed_check;
});

test("a push to a subframe, a push too large and a push to a page that left are refused", async () => {
  const { rpc, from_module } = setup();
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  await assert.rejects(rpc.send_to_locked_tab(7, { type: "ping" }, 2), /only its top frame/);
  await assert.rejects(rpc.send_to_locked_tab(7, { type: "refusal", pad: "p".repeat(MAX_KIND_BYTES) }), /over its size limit/);
  const left = rpc.send_to_locked_tab(7, { type: "ping" });
  rpc.tab_left(7);
  await assert.rejects(left, /went away/);
  const closed = rpc.send_to_locked_tab(7, { type: "ping" });
  await rpc.tab_removed(7);
  await assert.rejects(closed, /closed/);
  assert.equal(await rpc.is_locked_tab(7), false);
});

test("a locked tab stops counting as locked once it navigates", async () => {
  const { rpc, from_module, config } = setup();
  assert.equal(await rpc.is_locked_tab(7), false, "no call yet");
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  assert.equal(await rpc.is_locked_tab(7), true);
  config.tabs = [{ ...TAB, url: "https://example.com/" }];
  assert.equal(await rpc.is_locked_tab(7), false);
});

test("each snapshot part is written whole, rewritten on its own change, and removed when it fails its cap", async () => {
  const { rpc, data, config, settle } = setup();
  await rpc.sync();
  for (const part of SNAPSHOT_PART_NAMES) assert.deepEqual(data.get(SNAPSHOT_PARTS[part].key), { v: V, value: config.parts[part] }, part);
  config.parts.theme = { dark: { a: 1 }, light: {} };
  config.parts.keymap = '{"keymap":2}';
  rpc.storage_changed({ [THEME_STORAGE_KEY]: {} }, "local");
  await settle();
  assert.deepEqual((data.get(SNAPSHOT_PARTS.theme.key) as { value: unknown }).value, { dark: { a: 1 }, light: {} });
  assert.equal((data.get(SNAPSHOT_PARTS.keymap.key) as { value: unknown }).value, '{"keymap":1}', "a theme change leaves the keymap");
  config.parts.keymap = "k".repeat(SNAPSHOT_PARTS.keymap.max_bytes);
  config.parts.config = undefined;
  await rpc.sync();
  assert.equal(data.has(SNAPSHOT_PARTS.keymap.key), false, "over its cap, the part is gone rather than stale");
  assert.deepEqual(data.get(SNAPSHOT_PARTS.config.key), { v: V }, "nothing to serve is a snapshot with no value");
  config.parts.theme = "not a theme";
  await rpc.sync();
  assert.equal(data.has(SNAPSHOT_PARTS.theme.key), false);
});

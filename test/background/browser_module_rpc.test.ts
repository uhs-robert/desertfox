import assert from "node:assert/strict";
import { test } from "node:test";
import { create_browser_module } from "../../src/background/browser_module.ts";
import { create_browser_module_rpc, pages_setting_on } from "../../src/background/browser_module_rpc.ts";
import { dispatch } from "../../src/background/message_table.ts";
import type { Handlers } from "../../src/background/message_table.ts";
import type { ToBackground } from "../../src/shared/messages/map.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY, BROWSER_MODULE_PROTOCOL_VERSION as V, MAX_KIND_BYTES, MAX_MESSAGES, MAX_STATE_TABS, MESSAGE_MIN_GAP_MS, SNAPSHOT_PART_NAMES, SNAPSHOT_PARTS } from "../../src/shared/browser_module_protocol.ts";
import type { SnapshotPart } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY, CONFIG_STATUS_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { THEME_STORAGE_KEY } from "../../src/shared/theme/apply.ts";

type Sender = browser.runtime.MessageSender;
type Seen = { message: Record<string, unknown>; sender: Sender };

const PDF = "https://example.org/paper.pdf";
const TAB = { id: 7, url: PDF, index: 0, highlighted: false, active: true, pinned: false, incognito: false } as browser.tabs.Tab;

// The real base channel and the real message table, with a fake session and a handler table that records what reaches it.
function setup(options: { on?: boolean; tabs?: browser.tabs.Tab[]; parts?: Partial<Record<SnapshotPart, unknown>> } = {}) {
  const data = new Map<string, unknown>();
  const config = { before_send: undefined as ((id: string) => void) | undefined, before_get_tab: undefined as (() => Promise<void>) | undefined, on: options.on ?? true, tabs: options.tabs ?? [TAB], parts: { keymap: { format_version: 1, modes: {} }, config: { settings: {} }, theme: { dark: {}, light: {} }, which_key: { title: [], rows: [] }, ...options.parts } as Record<SnapshotPart, unknown> };
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
    read_keymap_state: { from: "any", run: record("read_keymap_state") },
    snippet_run: { from: "any", run: record("snippet_run") },
    change_setting: { from: "page", refused: { ok: false }, run: record("change_setting") },
  } as unknown as Handlers<keyof ToBackground>;
  let module: ReturnType<typeof create_browser_module>;
  let clock = 0;
  const rpc = create_browser_module_rpc({
    session: session as never,
    is_on: async () => config.on,
    // `before_send` runs where the module could first see the push: a fast reply, or a load during the send.
    send: (kind, args, on_id) => module.send(kind, args, (id) => (config.before_send?.(id), on_id?.(id))),
    get_tab: async (tab_id) => (await config.before_get_tab?.(), config.tabs.find((tab) => tab.id === tab_id)),
    dispatch: dispatch(handlers, () => false),
    read_part: Object.fromEntries(SNAPSHOT_PART_NAMES.map((part) => [part, async () => config.parts[part]])) as never,
  });
  module = create_browser_module({
    session: session as never,
    is_on: async () => true,
    read_disabled: async () => false,
    read_keymap: async () => undefined,
    read_tab_records: async () => ({}),
    check_args: () => undefined,
    handlers: rpc.handlers,
    on_reply: rpc.push_answered,
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
  const base_replies = () => outbox().filter((message) => "reply_to" in message);
  // The answers the page calls got, by request id, read from the replies' values.
  const page_replies = () => base_replies().filter((reply) => reply.ok === true).map((reply) => ({ reply_to: reply.reply_to, answer: JSON.parse(reply.value as string) as unknown }));
  const pushes = () => outbox().filter((message) => message.kind === "page_push") as { id: string; args: { tab_id: number; message: string } }[];
  // The module's reply to a push, written into chrome's list.
  const answer_push = (id: string, reply: Record<string, unknown>) => from_module([{ v: V, reply_to: id, ok: true, ...reply }]);
  return { data, config, rpc, module, seen, answers, from_module, settle, outbox, page_replies, base_replies, pushes, answer_push, written: () => written };
}

let ids = 0;
// Chrome's word that the page code of a document ended.
const gone = (tab_id: number, document_id: number) => ({ v: V, id: `g${++ids}`, kind: "page_gone", args: { tab_id, document_id }, sent_at: Date.now() });
const call = (message: unknown, patch: Record<string, unknown> = {}) => ({ v: V, id: `c${++ids}`, kind: "page_call", args: { tab_id: 7, document_id: 1, message: typeof message === "string" ? message : JSON.stringify(message), ...patch } });

test("a page call reaches the message table with a sender built from the browser's facts, and its answer comes back in the reply", async () => {
  const { seen, answers, from_module, page_replies, base_replies, data } = setup();
  answers["register_read"] = () => Promise.resolve("yanked text");
  const request = call({ type: "register_read", name: "a" });
  await from_module([request]);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0]!.message, { type: "register_read", name: "a" });
  assert.deepEqual(seen[0]!.sender, { tab: TAB, frameId: 0, url: PDF }, "no extension id, frame 0, the tab's own address");
  assert.deepEqual(page_replies(), [{ reply_to: request.id, answer: { value: "yanked text" } }]);
  assert.equal(base_replies().length, 1, "one reply carries the answer");
  assert.deepEqual(data.get(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY), { "7": { url: PDF, document_id: 1 } }, "the tab is marked locked, with its document");
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
  assert.equal(sender.url, PDF);
  assert.equal(message.url, PDF, "the address is the tab's");
});

test("read_keymap_state is a page call, answered from the tab's own address, and a setting that is off refuses it", async () => {
  const { seen, answers, from_module, page_replies, config, base_replies } = setup();
  answers["read_keymap_state"] = (message) => ({ address: message.url });
  const request = call({ type: "read_keymap_state", join: true, url: "https://off.test/", address: "https://off.test/" });
  await from_module([request]);
  assert.equal(seen[0]?.sender.tab?.url, PDF);
  assert.deepEqual(page_replies()[0]?.answer, { value: { address: PDF } }, "an address the page names is replaced by the tab's");
  config.on = false;
  await from_module([call({ type: "read_keymap_state", join: true })]);
  assert.equal(seen.length, 1);
  assert.equal(base_replies().at(-1)?.ok, false);
});

test("a mode report passes the frame guard with frame 0, and Reader View counts as a locked page", async () => {
  const { seen, from_module, config } = setup();
  config.tabs = [{ ...TAB, url: "about:reader?url=https%3A%2F%2Fexample.org%2F" }];
  await from_module([call({ type: "mode_changed", mode: "normal" })]);
  assert.equal(seen[0]?.sender.frameId, 0);
});

test("a call from a tab on about:addons, about:preferences, another about: page or an extension page is refused", async () => {
  for (const url of ["about:addons", "about:preferences#privacy", "about:config", "about:reader", "moz-extension://abc/home.html", "chrome://browser/content/browser.xhtml"]) {
    const { seen, from_module, base_replies, data } = setup({ tabs: [{ ...TAB, url }] });
    await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
    assert.deepEqual(seen, [], url);
    assert.equal(base_replies()[0]?.ok, false, url);
    assert.equal(data.has(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY), false, url);
  }
});

test("a type off the allow list, a page-only type, junk text and a non-table never reach a handler", async () => {
  const { seen, from_module, base_replies } = setup();
  const refused = [call({ type: "snippet_run", name: "x" }), call({ type: "change_setting", name: "browser_module", value: true }), call({ type: "eval", code: "1" }), call({ type: "load_bundle", name: "hints" }), call({ type: "read_keymap" }), call("not json {"), call("[1,2]"), call("null"), call('"run"'), call({ type: ["run"] }), call({ type: "__proto__" })];
  await from_module(refused);
  assert.deepEqual(seen, []);
  const replies = base_replies();
  assert.equal(replies.length, refused.length);
  assert.ok(replies.every((reply) => reply.ok === false && reply.error === "the request failed" && reply.value === undefined));
});

test("an oversize call, a bad envelope and a junk list are refused without a handler and without a throw", async () => {
  const { seen, from_module, base_replies } = setup();
  await from_module([call({ type: "run", invocations: [], mode: "normal", pad: "p".repeat(3 * MAX_KIND_BYTES) })]);
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
  for (const junk of [undefined, null, "x", 5, {}, [null, 1, "x", []], Array.from({ length: MAX_MESSAGES + 1 }, () => call({ type: "run" })), [{ ...call({ type: "run" }), v: V + 1 }], [call({ type: "run" }, { tab_id: "7" })], [call({ type: "run" }, { message: 5 })], [{ ...call({ type: "run" }), kind: "page_push" }], [{ v: V, reply_to: "x1", ok: true, value: 5 }], [{ v: V, reply_to: "x1", ok: true, value: "v".repeat(MAX_KIND_BYTES) }]]) {
    await from_module(junk);
  }
  assert.deepEqual(seen, []);
});

test("a call for a tab the browser does not know gives an error reply and marks nothing", async () => {
  const { seen, from_module, base_replies, data } = setup();
  await from_module([call({ type: "run", invocations: [], mode: "normal" }, { tab_id: 12 })]);
  assert.deepEqual(seen, []);
  assert.equal(base_replies()[0]?.ok, false);
  assert.equal(data.has(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY), false);
});

test("a handler that throws or rejects gives an error answer, and an answer too large or not plain data gives an error", async () => {
  const { answers, from_module, page_replies, base_replies } = setup();
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
  const big = call({ type: "register_read", name: "big" });
  await from_module([call({ type: "register_read", name: "sync" }), call({ type: "register_read", name: "async" }), big, call({ type: "register_read", name: "cycle" })]);
  assert.deepEqual(page_replies().map((reply) => (reply.answer as { error: string }).error).sort(), ["async boom", "sync boom", "the answer is not plain data"]);
  assert.deepEqual(base_replies().find((reply) => reply.reply_to === big.id), { v: V, reply_to: big.id, ok: false, error: "the answer is too large" });
});

test("a call whose handler pushes to the same tab settles, because handlers run outside the base queue", async () => {
  const { answers, from_module, rpc, pushes, answer_push, page_replies } = setup();
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  answers["run"] = () => rpc.send_to_locked_tab(7, { type: "run_in_content", invocations: [] }, 0);
  const request = call({ type: "run", invocations: [], mode: "normal" });
  await from_module([request]);
  const push = pushes().at(-1)!;
  assert.deepEqual(JSON.parse(push.args.message), { type: "run_in_content", invocations: [] });
  await answer_push(push.id, { value: JSON.stringify({ value: { ok: true } }) });
  assert.deepEqual(page_replies().find((reply) => reply.reply_to === request.id)?.answer, { value: { ok: true } });
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
  const waiting = assert.rejects(rpc.send_to_locked_tab(7, { type: "ping" }), /setting is off/);
  await new Promise((resolve) => setImmediate(resolve));
  config.on = false;
  rpc.storage_changed({ [CONFIG_STATUS_STORAGE_KEY]: {} }, "local");
  await waiting;
  await rpc.sync();
  assert.equal([...SNAPSHOT_PART_NAMES.map((part) => SNAPSHOT_PARTS[part].key), BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY].some((key) => data.has(key)), false);
});

test("a mark that lands after the setting went off is not written, because both share one queue", async () => {
  const { rpc, data, config, from_module, settle } = setup();
  const marking = from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  config.on = false;
  rpc.storage_changed({ [CONFIG_STATUS_STORAGE_KEY]: {} }, "local");
  await marking;
  await settle();
  assert.equal(data.has(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY), false);
});

test("the setting reads both switches from the stored config status", async () => {
  const of = (settings: unknown) => pages_setting_on({ get: async (key: string) => ({ [key]: { settings } }) } as never);
  assert.equal(await of({ browser_module: true, browser_module_pages: true }), true);
  assert.equal(await of({ browser_module: false, browser_module_pages: true }), false, "needs the browser module setting");
  assert.equal(await of({ browser_module: true }), false, "off by default");
  assert.equal(await of({ browser_module: true, browser_module_pages: "yes" }), false);
  assert.equal(await pages_setting_on({ get: async () => ({}) } as never), false);
});

test("a push to a locked tab waits for the module's reply, and a reply to no waiting push does nothing", async () => {
  const { rpc, pushes, answer_push, from_module } = setup();
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  assert.equal(await rpc.is_locked_tab(7), true);
  const answer = rpc.send_to_locked_tab(7, { type: "get_selection" }, 0);
  await new Promise((resolve) => setImmediate(resolve));
  const push = pushes()[0]!;
  assert.equal(push.args.tab_id, 7);
  assert.deepEqual(JSON.parse(push.args.message), { type: "get_selection" });
  await answer_push("nope", { value: JSON.stringify({ value: "other" }) });
  await answer_push(push.id, { value: JSON.stringify({ value: "picked" }) });
  assert.equal(await answer, "picked");
  await answer_push(push.id, { value: JSON.stringify({ value: "again" }) });
  const ask = async (reply: Record<string, unknown>) => {
    const asked = rpc.send_to_locked_tab(7, { type: "get_selection" });
    await new Promise((resolve) => setImmediate(resolve));
    const settled = asked.then((value) => ({ value }), (error: Error) => ({ error: error.message }));
    await answer_push(pushes().at(-1)!.id, reply);
    return settled;
  };
  assert.deepEqual(await ask({}), { value: undefined }, "a reply with no value is no answer");
  assert.deepEqual(await ask({ value: JSON.stringify({ error: "no listener" }) }), { error: "no listener" });
  assert.deepEqual(await ask({ value: "junk" }), { error: "the page's answer is not JSON" });
  assert.deepEqual(await ask({ value: "[1]" }), { error: "the page's answer is not a table" });
  assert.deepEqual(await ask({ ok: false, error: "the push failed" }), { error: "the push failed" });
});

test("a push to a subframe, a push too large and a push to a page that left are refused", async () => {
  const { rpc, from_module } = setup();
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  await assert.rejects(rpc.send_to_locked_tab(7, { type: "ping" }, 2), /only its top frame/);
  await assert.rejects(rpc.send_to_locked_tab(7, { type: "refusal", pad: "p".repeat(MAX_KIND_BYTES) }), /over its size limit/);
  const left = assert.rejects(rpc.send_to_locked_tab(7, { type: "ping" }), /went away/);
  await new Promise((resolve) => setImmediate(resolve));
  rpc.tab_url_changed(7, "https://example.com/elsewhere");
  await left;
  await from_module([call({ type: "run", invocations: [], mode: "normal" }, { document_id: 2 })]);
  const closed = assert.rejects(rpc.send_to_locked_tab(7, { type: "ping" }), /closed/);
  await new Promise((resolve) => setImmediate(resolve));
  await rpc.tab_removed(7);
  await closed;
  assert.equal(await rpc.is_locked_tab(7), false);
});

test("a load event for the same address keeps the tab locked and its push waiting, as a PDF reports two", async () => {
  const { rpc, from_module, pushes, answer_push } = setup();
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  const waiting = rpc.send_to_locked_tab(7, { type: "ping" });
  await new Promise((resolve) => setImmediate(resolve));
  rpc.tab_url_changed(7, PDF);
  rpc.tab_url_changed(7, `${PDF}#page=2`);
  assert.equal(await rpc.is_locked_tab(7), true);
  await answer_push(pushes().at(-1)!.id, { value: JSON.stringify({ value: "still here" }) });
  assert.equal(await waiting, "still here");
});

test("page_gone moves the document onto the left list and ends the lock, so a call from it is refused, and the next document locks the tab again", async () => {
  const { rpc, from_module, data, seen, base_replies } = setup();
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  assert.equal(await rpc.is_locked_tab(7), true);
  await from_module([gone(7, 1)]);
  assert.equal(await rpc.is_locked_tab(7), false, "not locked before the new document calls");
  assert.deepEqual(data.get(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY), { "7": { left: [1] } });
  // A push may come twice.
  await from_module([gone(7, 1)]);
  assert.deepEqual(data.get(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY), { "7": { left: [1] } });
  const stale = call({ type: "mode_changed", mode: "normal" }, { document_id: 1 });
  await from_module([stale]);
  assert.equal(base_replies().find((reply) => reply.reply_to === stale.id)?.ok, false, "a call from the gone document is refused");
  assert.equal(seen.length, 1);
  await from_module([call({ type: "mode_changed", mode: "normal" }, { document_id: 2 })]);
  assert.equal(await rpc.is_locked_tab(7), true);
  // A late page_gone of the old document leaves the new one locked.
  await from_module([gone(7, 0)]);
  assert.equal(await rpc.is_locked_tab(7), true);
});

test("a locked tab stops counting as locked once its address changes", async () => {
  const { rpc, from_module, config } = setup();
  assert.equal(await rpc.is_locked_tab(7), false, "no call yet");
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  assert.equal(await rpc.is_locked_tab(7), true);
  config.tabs = [{ ...TAB, url: "https://example.com/" }];
  assert.equal(await rpc.is_locked_tab(7), false);
});

test("a removal and a mark that run at once keep each other's tab", async () => {
  const { rpc, from_module, config, data } = setup();
  config.tabs = [TAB, { ...TAB, id: 8, url: "about:reader?url=x" }];
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  // Tab 7 closes while tab 8's first call registers.
  const removing = rpc.tab_removed(7);
  const marking = from_module([call({ type: "run", invocations: [], mode: "normal" }, { tab_id: 8 })]);
  await Promise.all([removing, marking]);
  assert.deepEqual(data.get(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY), { "8": { url: "about:reader?url=x", document_id: 1 } });
});

test("each snapshot part is written whole, rewritten on its own change, and removed when it fails its cap", async () => {
  const { rpc, data, config, settle } = setup();
  await rpc.sync();
  for (const part of SNAPSHOT_PART_NAMES) assert.deepEqual(data.get(SNAPSHOT_PARTS[part].key), { v: V, value: config.parts[part] }, part);
  config.parts.theme = { dark: { a: 1 }, light: {} };
  config.parts.keymap = { format_version: 1, modes: { a: 1 } };
  rpc.storage_changed({ [THEME_STORAGE_KEY]: {} }, "local");
  await settle();
  assert.deepEqual((data.get(SNAPSHOT_PARTS.theme.key) as { value: unknown }).value, { dark: { a: 1 }, light: {} });
  assert.deepEqual((data.get(SNAPSHOT_PARTS.keymap.key) as { value: unknown }).value, { format_version: 1, modes: {} }, "a theme change leaves the keymap");
  config.parts.keymap = { format_version: 1, modes: {}, pad: "k".repeat(SNAPSHOT_PARTS.keymap.max_bytes) };
  config.parts.config = undefined;
  await rpc.sync();
  assert.equal(data.has(SNAPSHOT_PARTS.keymap.key), false, "over its cap, the part is gone rather than stale");
  assert.deepEqual(data.get(SNAPSHOT_PARTS.config.key), { v: V }, "nothing to serve is a snapshot with no value");
  config.parts.theme = "not a theme";
  await rpc.sync();
  assert.equal(data.has(SNAPSHOT_PARTS.theme.key), false);
});

test("a reply that comes before the send returns settles the push", async () => {
  const { rpc, from_module, config } = setup();
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  // The reply lands while the push is still being written.
  config.before_send = (id) => queueMicrotask(() => rpc.push_answered({ v: V, reply_to: id, ok: true, value: JSON.stringify({ value: "fast" }) }));
  assert.equal(await rpc.send_to_locked_tab(7, { type: "get_selection" }), "fast");
});

test("a load or a setting off while a push is being sent rejects it, leaves no wait behind and never writes the push", async () => {
  const { rpc, from_module, config, pushes, answer_push } = setup();
  await from_module([call({ type: "run", invocations: [], mode: "normal" })]);
  let cut_id = "";
  config.before_send = (id) => {
    cut_id = id;
    rpc.tab_url_changed(7, "https://example.com/elsewhere");
  };
  await assert.rejects(rpc.send_to_locked_tab(7, { type: "ping" }), /went away/);
  config.before_send = undefined;
  assert.deepEqual(pushes(), [], "the push for the document that went away is not written, so the next document never gets it");
  // A reply to the push that was cut off settles nothing and throws nothing.
  await answer_push(cut_id, { value: JSON.stringify({ value: "late" }) });
  await from_module([call({ type: "run", invocations: [], mode: "normal" }, { document_id: 2 })]);
  config.before_send = () => {
    config.on = false;
    rpc.storage_changed({ [CONFIG_STATUS_STORAGE_KEY]: {} }, "local");
  };
  await assert.rejects(rpc.send_to_locked_tab(7, { type: "ping" }), /setting is off/);
});

test("a call the old document sent before a reload of the same address cannot mark the tab again", async () => {
  const { rpc, from_module, seen, base_replies } = setup();
  await from_module([call({ type: "mode_changed", mode: "normal" }, { document_id: 41 })]);
  await from_module([gone(7, 41)]);
  const stale = call({ type: "mode_changed", mode: "normal" }, { document_id: 41 });
  await from_module([stale]);
  assert.equal(await rpc.is_locked_tab(7), false, "the old document's call leaves the tab unmarked");
  assert.equal(seen.length, 1, "and never reaches a handler");
  assert.equal(base_replies().find((reply) => reply.reply_to === stale.id)?.ok, false);
  await from_module([call({ type: "mode_changed", mode: "normal" }, { document_id: 42 })]);
  assert.equal(await rpc.is_locked_tab(7), true, "the new document's first call marks it");
  assert.equal(seen.length, 2);
});

test("an answer that settles after the setting went off carries no page text", async () => {
  const { answers, from_module, base_replies, config } = setup();
  answers["register_read"] = async () => {
    config.on = false;
    return "page text";
  };
  const request = call({ type: "register_read", name: "a" });
  await from_module([request]);
  const reply = base_replies().find((message) => message.reply_to === request.id);
  assert.equal(reply?.ok, false);
  assert.equal(reply?.value, undefined);
});

test("a first call whose document chrome called gone while its tab was read is refused and marks nothing", async () => {
  const { rpc, from_module, config, seen, base_replies } = setup();
  config.before_get_tab = async () => {
    config.before_get_tab = undefined;
    await rpc.handlers.page_gone({ tab_id: 7, document_id: 1 });
  };
  const first = call({ type: "mode_changed", mode: "normal" }, { document_id: 1 });
  await from_module([first]);
  assert.deepEqual(seen, []);
  assert.equal(base_replies().find((reply) => reply.reply_to === first.id)?.ok, false);
  assert.equal(await rpc.is_locked_tab(7), false);
  await from_module([call({ type: "mode_changed", mode: "normal" }, { document_id: 2 })]);
  assert.equal(seen.length, 1, "a call that no load crossed still runs");
});

test("with the table full, a new tab's call is refused and a recorded tab's call still runs", async () => {
  const { rpc, data, from_module, seen, base_replies } = setup();
  await from_module([call({ type: "mode_changed", mode: "normal" })]);
  assert.equal(seen.length, 1);
  const full = Object.fromEntries(Array.from({ length: MAX_STATE_TABS }, (_, index) => [String(1000 + index), { url: PDF, document_id: 1 }]));
  data.set(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY, { ...full, 7: { url: PDF, document_id: 1 } });
  await from_module([call({ type: "mode_changed", mode: "normal" })]);
  assert.equal(seen.length, 2, "the recorded tab's matching call runs");
  data.set(BROWSER_MODULE_LOCKED_TABS_STORAGE_KEY, full);
  const extra = call({ type: "mode_changed", mode: "normal" });
  await from_module([extra]);
  assert.equal(seen.length, 2, "the new tab's call reaches no handler");
  assert.equal(base_replies().find((reply) => reply.reply_to === extra.id)?.ok, false);
  assert.equal(await rpc.is_locked_tab(7), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_MODULE_PROTOCOL_VERSION } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { create_firefox, source_of } from "./fake_firefox.ts";

const FILE = "desertfox-find.js";
type Reply = { ok: boolean; error?: string; value?: string };
type Listener = { onFindResult(options: { result: number }): void; onMatchesCountResult(count: { current: number; total: number; limit: number }): void };

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

// A Finder that answers each find at once with the next scripted outcome: its result code and the place among `total` matches.
function stub_finder(outcomes: { result: number; current: number; total: number }[]) {
  const listeners = new Set<Listener>();
  const calls: unknown[][] = [];
  const answer = () => {
    const outcome = outcomes.shift() ?? { result: 1, current: 0, total: 0 };
    for (const listener of listeners) {
      listener.onFindResult({ result: outcome.result });
      listener.onMatchesCountResult({ current: outcome.current, total: outcome.total, limit: 1000 });
    }
  };
  const finder = {
    searchString: "",
    fastFind(...args: unknown[]) {
      calls.push(["fastFind", ...args]);
      finder.searchString = String(args[0]);
      answer();
    },
    findAgain(...args: unknown[]) {
      calls.push(["findAgain", ...args]);
      answer();
    },
    addResultListener: (listener: Listener) => listeners.add(listener),
    removeResultListener: (listener: Listener) => listeners.delete(listener),
  };
  return { finder, calls, listener_count: () => listeners.size };
}

function world({ private_window = false, private_access = false } = {}) {
  const firefox = create_firefox({ extra_files: { [FILE]: source_of(FILE) } });
  firefox.Components.interfaces.nsITypeAheadFind = { FIND_FOUND: 0, FIND_NOTFOUND: 1, FIND_WRAPPED: 2, FIND_PENDING: 3 };
  firefox.start_extension({ private_access });
  firefox.write_state({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: [], tabs: {} });
  const window = firefox.make_window({ private_window });
  const a = window.add_tab();
  const b = window.add_tab();
  window.load();
  for (const tab of [a.tab, b.tab]) Object.assign(tab, { closing: false, ownerGlobal: { closed: false } });
  const services = firefox.Services as Record<string, unknown>;
  const wm = services.wm as { getEnumerator(type: string | null): unknown[] };
  services.wm = { getEnumerator: (type: string | null) => (type === "navigator:browser" ? [window.win] : wm.getEnumerator(type)) };
  window.select(a.tab);
  const tracker = (window.win as unknown as { ChromeUtils: { importESModule(url: string): { ExtensionParent: { apiManager: { global: { tabTracker: { getId(tab: unknown): number } } } } } } }).ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs").ExtensionParent.apiManager.global.tabTracker;
  const ids = { a: tracker.getId(a.tab), b: tracker.getId(b.tab) };
  const give_finder = (tab: { browser: unknown }, outcomes: Parameters<typeof stub_finder>[0]) => {
    const stub = stub_finder(outcomes);
    (tab.browser as { finder: unknown }).finder = stub.finder;
    return stub;
  };
  let next_id = 0;
  async function ask(kind: string, args: Record<string, unknown>): Promise<Reply> {
    const id = `r${next_id++}`;
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [{ v: 1, id, kind, args, sent_at: Date.now() }]);
    for (let turn = 0; turn < 8; turn++) await new Promise((resolve) => setImmediate(resolve));
    const reply = ((firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) ?? []) as (Reply & { reply_to: string })[]).find((each) => each.reply_to === id);
    assert.ok(reply, "no reply");
    const { ok, error, value } = plain(reply) as Reply;
    return { ok, ...(error === undefined ? {} : { error }), ...(value === undefined ? {} : { value }) };
  }
  return { firefox, window, a, b, ids, ask, give_finder };
}

const counted = (reply: Reply) => JSON.parse(reply.value ?? "null");

test("a search runs the text through the Finder as plain text and replies with whole numbers", async () => {
  const { a, ids, ask, give_finder } = world();
  const { finder, calls, listener_count } = give_finder(a, [{ result: 0, current: 3, total: 12 }]);
  const reply = await ask("find.search", { tab_id: ids.a, text: "a.*b[", backwards: 0 });
  assert.ok(reply.ok, reply.error ?? "no error");
  assert.deepEqual(counted(reply), { result: 0, current: 3, total: 12, limit: 1000 });
  assert.deepEqual(calls, [["fastFind", "a.*b[", false, false]]);
  assert.equal(finder.searchString, "a.*b[");
  assert.equal(listener_count(), 0, "the listener is removed");
});

test("a search backward steps back once from the first match", async () => {
  const { a, ids, ask, give_finder } = world();
  const { calls } = give_finder(a, [{ result: 0, current: 1, total: 4 }, { result: 2, current: 4, total: 4 }]);
  const reply = await ask("find.search", { tab_id: ids.a, text: "word", backwards: 1 });
  assert.deepEqual(counted(reply), { result: 2, current: 4, total: 4, limit: 1000 });
  assert.deepEqual(calls, [["fastFind", "word", false, false], ["findAgain", "word", true, false, false]]);
});

test("no match ends at once with the not found code, and a backward search does not step back", async () => {
  const { a, ids, ask, give_finder } = world();
  const { calls } = give_finder(a, [{ result: 1, current: 0, total: 0 }]);
  const reply = await ask("find.search", { tab_id: ids.a, text: "nothing", backwards: 1 });
  assert.equal(counted(reply).result, 1);
  assert.equal(calls.length, 1);
});

test("n repeats the search the way it started and N the other way", async () => {
  const { a, ids, ask, give_finder } = world();
  const { calls } = give_finder(a, [{ result: 0, current: 1, total: 3 }, { result: 0, current: 2, total: 3 }, { result: 0, current: 1, total: 3 }]);
  await ask("find.search", { tab_id: ids.a, text: "word", backwards: 0 });
  assert.ok((await ask("find.again", { tab_id: ids.a, reverse: 0 })).ok);
  assert.ok((await ask("find.again", { tab_id: ids.a, reverse: 1 })).ok);
  assert.deepEqual(calls.slice(1), [["findAgain", "word", false, false, false], ["findAgain", "word", true, false, false]]);
});

test("after a search backward n keeps going backward", async () => {
  const { a, ids, ask, give_finder } = world();
  const { calls } = give_finder(a, [{ result: 0, current: 1, total: 3 }, { result: 0, current: 3, total: 3 }, { result: 0, current: 2, total: 3 }]);
  await ask("find.search", { tab_id: ids.a, text: "word", backwards: 1 });
  await ask("find.again", { tab_id: ids.a, reverse: 0 });
  assert.deepEqual(calls.at(-1), ["findAgain", "word", true, false, false]);
});

test("n with no search in the window is refused", async () => {
  const { a, ids, ask, give_finder } = world();
  const { calls } = give_finder(a, []);
  assert.deepEqual(await ask("find.again", { tab_id: ids.a, reverse: 0 }), { ok: false, error: "No earlier search" });
  assert.deepEqual(calls, []);
});

test("n in another tab, whose Finder holds no such search, searches the window's last text again", async () => {
  const { window, a, b, ids, ask, give_finder } = world();
  give_finder(a, [{ result: 0, current: 1, total: 3 }]);
  await ask("find.search", { tab_id: ids.a, text: "word", backwards: 0 });
  const other = give_finder(b, [{ result: 0, current: 1, total: 2 }]);
  window.select(b.tab);
  const reply = await ask("find.again", { tab_id: ids.b, reverse: 0 });
  assert.ok(reply.ok, reply.error ?? "no error");
  assert.deepEqual(other.calls, [["fastFind", "word", false, false]]);
});

test("text that is empty, too long or holds a control or format character is refused", async () => {
  const { a, ids, ask, give_finder } = world();
  const { calls } = give_finder(a, []);
  for (const text of ["", "x".repeat(257), "a\nb", "a‍b"]) assert.deepEqual(await ask("find.search", { tab_id: ids.a, text, backwards: 0 }), { ok: false, error: "The search text is not allowed" }, JSON.stringify(text.slice(0, 6)));
  assert.deepEqual(calls, []);
});

test("a tab that is gone, not selected or private is refused and never searched", async () => {
  const { b, ids, ask, give_finder } = world();
  const { calls } = give_finder(b, []);
  assert.deepEqual(await ask("find.search", { tab_id: ids.b, text: "word", backwards: 0 }), { ok: false, error: "The tab that asked is no longer selected" });
  assert.deepEqual(await ask("find.search", { tab_id: 99999, text: "word", backwards: 0 }), { ok: false, error: "The tab that asked is gone" });
  assert.deepEqual(calls, []);
});

test("a private tab is refused even where the module may act", async () => {
  const { a, ids, ask, give_finder } = world({ private_window: true, private_access: true });
  const { calls } = give_finder(a, [{ result: 0, current: 1, total: 1 }]);
  (a.browser as { private_browser?: boolean }).private_browser = true;
  assert.deepEqual(await ask("find.search", { tab_id: ids.a, text: "word", backwards: 0 }), { ok: false, error: "Find is off in private tabs" });
  assert.deepEqual(calls, []);
});

test("a private window the module may not act in is refused", async () => {
  const { a, ids, ask, give_finder } = world({ private_window: true });
  give_finder(a, []);
  assert.deepEqual(await ask("find.search", { tab_id: ids.a, text: "word", backwards: 0 }), { ok: false, error: "The browser module may not act in this window" });
});

test("a count that never comes ends the reply at the time limit with no place", async () => {
  const { firefox, a, ids, ask, give_finder } = world();
  const { finder } = give_finder(a, []);
  const listeners = new Set<Listener>();
  finder.addResultListener = (listener: Listener) => listeners.add(listener);
  finder.removeResultListener = (listener: Listener) => listeners.delete(listener);
  finder.fastFind = () => {
    for (const listener of listeners) listener.onFindResult({ result: 0 });
  };
  const pending = ask("find.search", { tab_id: ids.a, text: "word", backwards: 0 });
  for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));
  firefox.run_timers();
  const reply = await pending;
  assert.ok(reply.ok, reply.error ?? "no error");
  assert.deepEqual(counted(reply), { result: 0, current: -1, total: -1, limit: -1 });
});

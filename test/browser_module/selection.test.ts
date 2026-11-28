import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { BROWSER_MODULE_PROTOCOL_VERSION } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { create_firefox, source_of } from "./fake_firefox.ts";

const FILE = "desertfox-selection.js";
type Reply = { ok: boolean; error?: string; value?: string };
type FakeBrowser = { currentURI?: { scheme: string }; contentWindow?: unknown };

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

// A page document whose focus sits on `active` and whose selection is `selected`.
const page_document = (selected: string, active?: Record<string, unknown>) => {
  const document: Record<string, unknown> = { activeElement: active ?? null, defaultView: { getSelection: () => selected } };
  return document;
};

const PREFIX = "desertfox-browser-module:selection-";

function world({ private_window = false, private_access = false } = {}) {
  const firefox = create_firefox({ extra_files: { [FILE]: source_of(FILE) } });
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
  const show = (tab: { browser: unknown }, scheme: string, content_document?: unknown) => {
    const browser = tab.browser as FakeBrowser;
    browser.currentURI = { scheme };
    browser.contentWindow = content_document === undefined ? null : { document: content_document };
  };
  let next_id = 0;
  async function ask(args: Record<string, unknown>): Promise<Reply> {
    const id = `r${next_id++}`;
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [{ v: 1, id, kind: "selection.read", args, sent_at: Date.now() }]);
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
    const reply = ((firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) ?? []) as (Reply & { reply_to: string })[]).find((each) => each.reply_to === id);
    assert.ok(reply, "no reply");
    const { ok, error, value } = plain(reply) as Reply;
    return { ok, ...(error === undefined ? {} : { error }), ...(value === undefined ? {} : { value }) };
  }
  // A request whose reply the test holds back: the module has sent its message to the tab, and nothing has answered yet.
  function ask_later(args: Record<string, unknown>) {
    const id = `r${next_id++}`;
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [{ v: 1, id, kind: "selection.read", args, sent_at: Date.now() }]);
    const turns = async () => {
      for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
    };
    const reply = async (): Promise<Reply> => {
      await turns();
      const found = ((firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) ?? []) as (Reply & { reply_to: string })[]).find((each) => each.reply_to === id);
      assert.ok(found, "no reply");
      const { ok, error, value } = plain(found) as Reply;
      return { ok, ...(error === undefined ? {} : { error }), ...(value === undefined ? {} : { value }) };
    };
    return { turns, reply };
  }
  // A tab whose page runs in a content process, with no window in the parent.
  const remote = (tab: { browser: unknown }, inner = 10) => Object.assign(tab.browser as object, { currentURI: { scheme: "https" }, contentWindow: null, isRemoteBrowser: true, innerWindowID: inner });
  const requests = () => (firefox.sent_to_frames as { browser: unknown; name: string; data: { req: number } }[]).filter((each) => each.name === PREFIX + "read");
  return { firefox, window, a, b, ids, ask, ask_later, show, remote, requests };
}

test("the page selection of a parent-process about: page comes back as text", async () => {
  const { a, ids, ask, show } = world();
  show(a, "about", page_document("chosen words"));
  assert.deepEqual(await ask({ tab_id: ids.a }), { ok: true, value: "chosen words" });
});

test("a selected range in a focused field wins, and a field with none leaves the page selection", async () => {
  const { a, ids, ask, show } = world();
  show(a, "about", page_document("page text", { localName: "input", value: "search the settings", selectionStart: 7, selectionEnd: 10 }));
  assert.deepEqual(await ask({ tab_id: ids.a }), { ok: true, value: "the" });
  show(a, "about", page_document("page text", { localName: "input", value: "abc", selectionStart: 2, selectionEnd: 2 }));
  assert.deepEqual(await ask({ tab_id: ids.a }), { ok: true, value: "page text" });
  const throwing = { localName: "input", get selectionStart(): number { throw new Error("no text selection on this type"); } };
  show(a, "about", page_document("page text", throwing));
  assert.deepEqual(await ask({ tab_id: ids.a }), { ok: true, value: "page text" });
});

test("a focused frame is read through to its own document", async () => {
  const { a, ids, ask, show } = world();
  show(a, "about", page_document("outer", { localName: "browser", contentDocument: page_document("inner") }));
  assert.deepEqual(await ask({ tab_id: ids.a }), { ok: true, value: "inner" });
});

test("control and format characters are stripped and the text is cut at 1000 characters", async () => {
  const { a, ids, ask, show } = world();
  show(a, "about", page_document("a\u0000b\nc\t\r\nd\u200De"));
  assert.deepEqual(await ask({ tab_id: ids.a }), { ok: true, value: "ab c de" });
  show(a, "about", page_document("x".repeat(1500)));
  assert.equal((await ask({ tab_id: ids.a })).value?.length, 1000);
});

test("a page that is not an about: page, or has no window in the parent, is refused with no text", async () => {
  const { a, ids, ask, show } = world();
  show(a, "https", page_document("secret"));
  assert.deepEqual(await ask({ tab_id: ids.a }), { ok: false, error: "Only about: pages are read here" });
  show(a, "about");
  assert.deepEqual(await ask({ tab_id: ids.a }), { ok: false, error: "This page does not run in the parent process" });
});

test("a tab that is gone or no longer selected is refused", async () => {
  const { a, b, ids, ask, show } = world();
  show(a, "about", page_document("one"));
  show(b, "about", page_document("two"));
  assert.deepEqual(await ask({ tab_id: ids.b }), { ok: false, error: "The tab that asked is no longer selected" });
  assert.deepEqual(await ask({ tab_id: 99999 }), { ok: false, error: "The tab that asked is gone" });
});

test("a private window the module may not act in is refused", async () => {
  const { a, ids, ask, show } = world({ private_window: true });
  show(a, "about", page_document("private words"));
  assert.deepEqual(await ask({ tab_id: ids.a }), { ok: false, error: "The browser module may not act in this window" });
});

test("a private window with private access is read", async () => {
  const { a, ids, ask, show } = world({ private_window: true, private_access: true });
  show(a, "about", page_document("private words"));
  assert.deepEqual(await ask({ tab_id: ids.a }), { ok: true, value: "private words" });
});

test("U+2028 and U+2029 become spaces like other line breaks", async () => {
  const { a, ids, ask, show } = world();
  show(a, "about", page_document("first\u2028second\u2029third"));
  assert.deepEqual(await ask({ tab_id: ids.a }), { ok: true, value: "first second third" });
});

const text_reply = (firefox: ReturnType<typeof world>["firefox"], browser: unknown, data: unknown) => firefox.emit_message(PREFIX + "text", browser, data);

test("a page in a content process is read through the frame script, and the text is cleaned again", async () => {
  const { firefox, a, ids, ask_later, remote, requests } = world();
  const browser = remote(a);
  const asked = ask_later({ tab_id: ids.a });
  await asked.turns();
  assert.equal(requests().length, 1);
  assert.equal(requests()[0]!.browser, browser);
  text_reply(firefox, browser, { req: requests()[0]!.data.req, inner: 10, text: "a\u0000b\nc\u2028d" });
  assert.deepEqual(await asked.reply(), { ok: true, value: "ab c d" });
});

test("a reply that is not a string, too long, from another tab or for another document is dropped, and the read ends with no selection", async () => {
  const { firefox, a, b, ids, ask_later, remote, requests } = world();
  const browser = remote(a);
  const other = remote(b);
  const attempts: [string, (req: number) => [unknown, unknown]][] = [
    ["not a string", (req) => [browser, { req, inner: 10, text: { toString: "x" } }]],
    ["too long", (req) => [browser, { req, inner: 10, text: "x".repeat(5000) }]],
    ["another tab", (req) => [other, { req, inner: 10, text: "stolen" }]],
    ["another document", (req) => [browser, { req, inner: 11, text: "stale" }]],
    ["not a record", () => [browser, "stolen"]],
  ];
  for (const [label, make] of attempts) {
    const asked = ask_later({ tab_id: ids.a });
    await asked.turns();
    const [from, data] = make(requests().at(-1)!.data.req);
    text_reply(firefox, from, data);
    // The wait ends at its timer.
    firefox.run_timers();
    const reply = await asked.reply();
    assert.equal(reply.ok, false, label);
    assert.equal(reply.value, undefined, label);
  }
});

test("a reply that comes after the timer is dropped", async () => {
  const { firefox, a, ids, ask_later, remote, requests } = world();
  const browser = remote(a);
  const asked = ask_later({ tab_id: ids.a });
  await asked.turns();
  firefox.run_timers();
  assert.deepEqual(await asked.reply(), { ok: false, error: "No selection could be read from this page" });
  text_reply(firefox, browser, { req: requests()[0]!.data.req, inner: 10, text: "late" });
  await asked.turns();
  assert.deepEqual(await asked.reply(), { ok: false, error: "No selection could be read from this page" });
});

test("the tab switched away while the frame script answered is refused", async () => {
  const { firefox, window, a, b, ids, ask_later, remote, requests } = world();
  const browser = remote(a);
  const asked = ask_later({ tab_id: ids.a });
  await asked.turns();
  window.select(b.tab);
  text_reply(firefox, browser, { req: requests()[0]!.data.req, inner: 10, text: "private words" });
  assert.deepEqual(await asked.reply(), { ok: false, error: "The tab that asked is no longer selected" });
});

test("a tab that is not remote or a window the module may not act in sends the frame script nothing", async () => {
  const world_a = world();
  world_a.show(world_a.a, "https", undefined);
  assert.deepEqual(await world_a.ask({ tab_id: world_a.ids.a }), { ok: false, error: "Only about: pages are read here" });
  const world_b = world({ private_window: true });
  world_b.remote(world_b.a);
  assert.equal((await world_b.ask({ tab_id: world_b.ids.a })).ok, false);
  assert.equal(world_a.requests().length + world_b.requests().length, 0);
});

// The frame script in a content process, run from the data: URL the core loads.
function frame_child(firefox: ReturnType<typeof world>["firefox"], page: Record<string, unknown>, { pref = true } = {}) {
  const url = firefox.frame_scripts.find((each) => decodeURIComponent(each).includes(PREFIX));
  assert.ok(url, "the selection feature loads its frame script");
  const listeners = new Map<string, (message: { data: unknown }) => void>();
  const sent: { name: string; data: Record<string, unknown> }[] = [];
  const context = vm.createContext({
    content: { document: page, windowGlobalChild: { innerWindowId: 77 } },
    Services: { prefs: { getBoolPref: () => pref } },
    addMessageListener: (name: string, listener: (message: { data: unknown }) => void) => listeners.set(name, listener),
    sendAsyncMessage: (name: string, data: Record<string, unknown>) => sent.push({ name, data }),
  });
  vm.runInContext(decodeURIComponent(url.slice(url.indexOf(",") + 1)), context);
  return { sent, send: (data: unknown) => listeners.get(PREFIX + "read")?.({ data }) };
}

test("the frame script replies with the cleaned selection of a focused field, else of the page", () => {
  const { firefox } = world();
  const field = page_document("page", { localName: "input", value: "search the add-ons", selectionStart: 7, selectionEnd: 10 });
  const child = frame_child(firefox, field);
  child.send({ req: 3 });
  assert.deepEqual(plain(child.sent), [{ name: PREFIX + "text", data: { req: 3, inner: 77, text: "the" } }]);
  const page = frame_child(firefox, page_document("x".repeat(1500)));
  page.send({ req: 4 });
  assert.equal((page.sent[0]!.data.text as string).length, 1000);
});

test("the frame script ignores a request with no integer id and answers nothing while the module is off", () => {
  const { firefox } = world();
  const child = frame_child(firefox, page_document("words"));
  child.send({ req: "1" });
  child.send(undefined);
  assert.deepEqual(plain(child.sent), []);
  const off = frame_child(firefox, page_document("words"), { pref: false });
  off.send({ req: 1 });
  assert.deepEqual(plain(off.sent), []);
});

test("a reply for the document asked about is dropped once the tab shows another document", async () => {
  const { firefox, a, ids, ask_later, remote, requests } = world();
  const browser = remote(a);
  const asked = ask_later({ tab_id: ids.a });
  await asked.turns();
  // A reload: the reply still names the old document, and the tab no longer shows it.
  (browser as { innerWindowID: number }).innerWindowID = 11;
  text_reply(firefox, browser, { req: requests()[0]!.data.req, inner: 10, text: "old page" });
  firefox.run_timers();
  assert.deepEqual(await asked.reply(), { ok: false, error: "No selection could be read from this page" });
});

test("a module that shuts down ends a pending read with no selection", async () => {
  const { firefox, a, ids, ask_later, remote } = world();
  remote(a);
  const asked = ask_later({ tab_id: ids.a });
  await asked.turns();
  (firefox.Services.desertfox_browser_module as { shut_down(): void }).shut_down();
  await asked.turns();
  // A module that is off writes no reply, and the read no longer waits for its timer. Nothing carries text.
  const replies = (firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) ?? []) as { value?: string }[];
  assert.ok(replies.every((each) => each.value === undefined));
  assert.equal(firefox.timer_count(), 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
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
  return { firefox, window, a, b, ids, ask, show };
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
  show(a, "about", page_document("a\u0000b\nc‍d"));
  assert.deepEqual(await ask({ tab_id: ids.a }), { ok: true, value: "abcd" });
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

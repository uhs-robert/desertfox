import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { BROWSER_MODULE_PROTOCOL_VERSION as V } from "../../src/shared/browser_module_protocol.ts";
import { BUNDLE_NAMES } from "../../src/shared/bundles.ts";
import {
  BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY,
  BROWSER_MODULE_FROM_MODULE_STORAGE_KEY,
  BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY,
  BROWSER_MODULE_SNAPSHOT_KEYMAP_STORAGE_KEY,
  BROWSER_MODULE_SNAPSHOT_THEME_STORAGE_KEY,
  BROWSER_MODULE_SNAPSHOT_WHICH_KEY_STORAGE_KEY,
} from "../../src/shared/config/storage_keys.ts";
import { create_firefox, source_of } from "./fake_firefox.ts";

const LOCKED_FILE = "desertfox-locked-pages.js";
const source = source_of(LOCKED_FILE);
const plain = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const settle = async () => {
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
};

const PDF_PRINCIPAL = { spec: "resource://pdf.js/web/viewer.html", isSystemPrincipal: false, addonId: "", originAttributes: { userContextId: 0 } };
const SYSTEM_PRINCIPAL = { spec: "[System Principal]", isSystemPrincipal: true, addonId: "", originAttributes: { userContextId: 0 } };
const ON_CONFIG = { v: V, value: { settings: { browser_module: true, browser_module_pages: true } } };
const KEYMAP = { v: V, value: { format_version: 1, modes: {} } };

type Principal = typeof PDF_PRINCIPAL;
type Page = { principal: Principal; uri: string; inner: number };
type FakeSandbox = { Promise: PromiseConstructor; desertfox_locked_transport?: Transport };
type Transport = {
  extension_id: string;
  base_url: string;
  alive: () => boolean;
  call: (text: string) => Promise<string>;
  load_bundle: (name: string) => Promise<{ ok: boolean }>;
  snapshot: (part: string) => unknown;
  on_snapshot: (listener: (part: string) => void) => void;
  on_push: (listener: (text: string) => Promise<string>) => void;
};

// The frame script as Firefox runs it in a tab's process: `content` is the shown page, and its messages go to the parent half through the fake's message manager.
function frame_of(frame_source: string, to_parent: (name: string, data: unknown) => void, { pref = true } = {}) {
  const listeners = new Map<string, ((message: { data: unknown }) => void)[]>();
  const events = new Map<string, ((event: unknown) => void)[]>();
  const sandboxes: { principal: unknown; options: Record<string, unknown>; global: FakeSandbox }[] = [];
  const nuked: unknown[] = [];
  const loaded: string[] = [];
  const observers = new Set<unknown>();
  const sent: { name: string; data: Record<string, unknown> }[] = [];
  const frame = {
    content: undefined as unknown as { document: { nodePrincipal: Principal; documentURI: string }; windowGlobalChild: { innerWindowId: number } },
    pref,
  };
  const context = vm.createContext({
    Components: {
      utils: {
        Sandbox(principal: unknown, options: Record<string, unknown>) {
          const global: FakeSandbox = { Promise };
          sandboxes.push({ principal, options, global });
          return global;
        },
        cloneInto: (value: unknown) => value,
        exportFunction: (fn: unknown) => fn,
        waiveXrays: (value: unknown) => value,
        nukeSandbox: (sandbox: unknown) => nuked.push(sandbox),
        reportError: (text: unknown) => assert.fail(`the frame script reported ${String(text)}`),
      },
      interfaces: { nsISupportsPRUint64: {} },
    },
    Services: {
      prefs: { getBoolPref: () => frame.pref },
      scriptSecurityManager: { createContentPrincipal: (uri: { spec: string }) => ({ extension: uri.spec }) },
      io: { newURI: (spec: string) => ({ spec }) },
      obs: { addObserver: (observer: unknown) => observers.add(observer), removeObserver: (observer: unknown) => observers.delete(observer) },
    },
    ChromeUtils: { compileScript: async (url: string) => ({ executeInGlobal: () => void loaded.push(url) }) },
    sendAsyncMessage: (name: string, data: Record<string, unknown>) => {
      sent.push({ name, data: plain(data) });
      to_parent(name, plain(data));
    },
    addMessageListener: (name: string, listener: (message: { data: unknown }) => void) => listeners.set(name, [...(listeners.get(name) ?? []), listener]),
    addEventListener: (type: string, listener: (event: unknown) => void) => events.set(type, [...(events.get(type) ?? []), listener]),
  });
  Object.defineProperty(context, "content", { get: () => frame.content });
  vm.runInContext(frame_source, context);
  const show = ({ principal, uri, inner }: Page) => {
    frame.content = { document: { nodePrincipal: principal, documentURI: uri }, windowGlobalChild: { innerWindowId: inner } };
  };
  const fire = (type: string, persisted = false) => {
    for (const listener of events.get(type) ?? []) listener({ target: frame.content.document, persisted });
  };
  const deliver = (name: string, data: unknown) => {
    for (const listener of listeners.get(name) ?? []) listener({ data: plain(data) });
  };
  const transport = () => sandboxes.at(-1)?.global.desertfox_locked_transport;
  return { frame, show, fire, deliver, sandboxes, nuked, loaded, observers, sent, transport };
}

// One window, one tab showing a PDF, DesertFox running with both settings on, and the frame script of that tab wired to the parent half. `add_tab` opens one more such tab in the same Firefox.
function locked({ config = ON_CONFIG as unknown, keymap = KEYMAP as unknown, page = { principal: PDF_PRINCIPAL, uri: "file:///tmp/a.pdf", inner: 5 } as Page, private_browser = false, private_access = false } = {}) {
  const firefox = create_firefox({ extra_files: { [LOCKED_FILE]: source } });
  const extension = firefox.start_extension({ private_access });
  const window = firefox.make_window();
  window.load();
  if (config !== null) firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, config);
  if (keymap !== null) firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_KEYMAP_STORAGE_KEY, keymap);
  const frame_url = firefox.frame_scripts.find((url) => decodeURIComponent(url).includes("locked_pages_frame_script"));
  assert.ok(frame_url, "the feature adds its frame script");
  const frame_source = decodeURIComponent(frame_url.slice(frame_url.indexOf(",") + 1));
  const add_tab = (shown_first: Page) => {
    const { tab } = window.add_tab() as { tab: { linkedBrowser: Record<string, unknown> } };
    // The frame speaks through whichever <browser> shows the tab now, as a frame that moved to another window does.
    const frame = frame_of(frame_source, (name, data) => firefox.from_frame(name, tab.linkedBrowser, data));
    firefox.frames.add(frame.deliver);
    const shown = { ...shown_first };
    const set_page = (next: Page) => {
      Object.assign(shown, next);
      frame.show(next);
    };
    const wire = (browser: Record<string, unknown>) =>
      Object.assign(browser, {
        private_browser,
        browsingContext: { get currentWindowGlobal() { return { innerWindowId: shown.inner, documentPrincipal: shown.principal, documentURI: { spec: shown.uri } }; } },
        messageManager: { sendAsyncMessage: (name: string, data: unknown) => frame.deliver(name, data) },
      });
    wire(tab.linkedBrowser);
    set_page(shown_first);
    const move_to_another_window = () => firefox.move_tab(tab, wire({ localName: "browser" }));
    const load = async () => {
      frame.fire("DOMContentLoaded");
      await settle();
    };
    return { tab, browser: tab.linkedBrowser, frame, set_page, load, move_to_another_window };
  };
  const first = add_tab(page);
  const from_module = () => (plain(firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY)) ?? []) as Record<string, unknown>[];
  const extension_sends = (list: unknown[]) => firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, list);
  return { firefox, extension, ...first, from_module, extension_sends, add_tab };
}

const gone_of = (list: Record<string, unknown>[]) => list.filter((message) => message.kind === "page_gone").map((message) => message.args);
const push_request = (id: string, tab_id: number, message: string, document_id = 1) => ({ v: V, id, kind: "page_push", args: { tab_id, document_id, message }, sent_at: Date.now() });

test("the feature's copies of the snapshot keys, the version and the bundle names equal src/shared, and its two halves name the same messages", () => {
  const keys = new Function(`return ${/const SNAPSHOT_KEYS = (\{[^}]*\});/.exec(source)![1]}`)();
  assert.deepEqual(keys, { keymap: BROWSER_MODULE_SNAPSHOT_KEYMAP_STORAGE_KEY, config: BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, theme: BROWSER_MODULE_SNAPSHOT_THEME_STORAGE_KEY, which_key: BROWSER_MODULE_SNAPSHOT_WHICH_KEY_STORAGE_KEY });
  assert.match(source, new RegExp(`const PROTOCOL_VERSION = ${V};`));
  assert.deepEqual(plain(vm.runInNewContext(/const BUNDLE_NAMES = (\[[^\]]*\]);/.exec(source)![1]!)), [...BUNDLE_NAMES]);
  const message_tables = [...source.matchAll(/const MESSAGE = (\{[^}]*\});/g)].map((match) => plain(vm.runInNewContext(`(${match[1]})`)));
  assert.equal(message_tables.length, 2);
  assert.deepEqual(message_tables[0], message_tables[1]);
});

test("chrome code never reads the page's messages: the feature has no parser, no eval and loads no file but its fixed names", () => {
  // The page code's message text is only ever relayed. A parse in chrome code is how a message could start to pick an action, an address or a selector.
  for (const banned of [/JSON\.parse/, /\beval\(/, /evalInSandbox/, /\bFunction\(/, /loadSubScript/, /loadFrameScript/, /\.innerHTML/]) assert.doesNotMatch(source, banned);
  const files = [...source.matchAll(/run_file\(current, ([^)]+)\)/g)].map((match) => match[1]).filter((name) => name !== "file");
  assert.deepEqual(files, ["`${name}.js`", "SHIM_FILE", "CONTENT_FILE"]);
  assert.match(source, /if \(!usable\(\) \|\| !BUNDLE_NAMES\.includes\(name\)\) return answer\(false/);
});

test("the PDF viewer gets a sandbox under the expanded principal [page, extension] that loads the shim, then content.js", async () => {
  const { frame, load, extension } = locked();
  await load();
  assert.equal(frame.sandboxes.length, 1);
  const [{ principal, options }] = frame.sandboxes as unknown as [{ principal: unknown[]; options: Record<string, unknown> }];
  assert.ok(Array.isArray(principal), "an expanded principal");
  assert.equal(principal.length, 2);
  assert.equal(principal[0], PDF_PRINCIPAL, "the page's own principal first");
  assert.deepEqual(plain(principal[1]), { extension: extension.baseURI.spec }, "then the extension's");
  assert.ok(!principal.includes(SYSTEM_PRINCIPAL));
  assert.equal(options.wantXrays, true);
  assert.equal(options.sandboxPrototype, frame.frame.content);
  assert.deepEqual(plain(options.metadata), { addonId: "desertfox@uhs-robert", "inner-window-id": 5 });
  assert.deepEqual(frame.loaded, [`${extension.baseURI.spec}locked_shim.js`, `${extension.baseURI.spec}content.js`]);
  const transport = frame.transport()!;
  assert.equal(transport.base_url, extension.baseURI.spec);
  assert.equal(transport.alive(), true);
  assert.deepEqual(plain(transport.snapshot("keymap")), KEYMAP);
  assert.equal(transport.snapshot("__proto__"), undefined);
});

test("Reader View gets page code, and no other page does: about: pages, extension pages, web pages, or a document chrome sees differently", async () => {
  const reader = { principal: { ...PDF_PRINCIPAL, spec: "about:reader?url=http%3A%2F%2Fa.test%2F" }, uri: "about:reader?url=http%3A%2F%2Fa.test%2F", inner: 5 };
  const { frame, load } = locked({ page: reader });
  await load();
  assert.equal(frame.sandboxes.length, 1, "Reader View");
  const refused: Page[] = [
    { principal: SYSTEM_PRINCIPAL, uri: "about:addons", inner: 5 },
    { principal: SYSTEM_PRINCIPAL, uri: "about:preferences", inner: 5 },
    // A system principal that claims to be the PDF viewer.
    { principal: { ...SYSTEM_PRINCIPAL, spec: "resource://pdf.js/web/viewer.html" }, uri: "file:///a.pdf", inner: 5 },
    { principal: { ...PDF_PRINCIPAL, spec: "moz-extension://0123abcd-0000-4000-8000-00000000cafe/help.html", addonId: "desertfox@uhs-robert" }, uri: "moz-extension://0123abcd-0000-4000-8000-00000000cafe/help.html", inner: 5 },
    { principal: { ...PDF_PRINCIPAL, spec: "https://a.test/" }, uri: "https://a.test/", inner: 5 },
    { principal: { ...PDF_PRINCIPAL, spec: "about:reader?url=x" }, uri: "about:blank", inner: 5 },
    { principal: { ...PDF_PRINCIPAL, spec: "chrome://browser/content/browser.xhtml" }, uri: "chrome://browser/content/browser.xhtml", inner: 5 },
  ];
  for (const page of refused) {
    const each = locked({ page });
    await each.load();
    assert.equal(each.frame.sandboxes.length, 0, page.uri);
    assert.deepEqual(each.frame.sent, [], `${page.uri} asks nothing`);
  }
  // The frame asks, but chrome sees a document that is not the PDF viewer.
  const lying = locked();
  lying.frame.show({ principal: PDF_PRINCIPAL, uri: "file:///a.pdf", inner: 5 });
  Object.assign(lying.browser, { browsingContext: { currentWindowGlobal: { innerWindowId: 5, documentPrincipal: SYSTEM_PRINCIPAL, documentURI: { spec: "about:addons" } } } });
  await lying.load();
  assert.equal(lying.frame.sandboxes.length, 0, "chrome checks the page itself");
});

test("with the setting off, the pref off, another protocol version or a private window without access, nothing loads", async () => {
  const cases = {
    "setting off": locked({ config: null }),
    "pages off": locked({ config: { v: V, value: { settings: { browser_module: true, browser_module_pages: false } } } }),
    "config of another version": locked({ config: { ...ON_CONFIG, v: V + 1 } }),
    "keymap of another version": locked({ keymap: { ...KEYMAP, v: V + 1 } }),
    "no keymap": locked({ keymap: null }),
    "private window": locked({ private_browser: true }),
  };
  for (const [name, each] of Object.entries(cases)) {
    await each.load();
    assert.equal(each.frame.sandboxes.length, 0, name);
  }
  const allowed = locked({ private_browser: true, private_access: true });
  await allowed.load();
  assert.equal(allowed.frame.sandboxes.length, 1, "a private window with private access");
  const pref_off = locked();
  pref_off.frame.frame.pref = false;
  await pref_off.load();
  assert.deepEqual(pref_off.frame.sent, [], "the frame asks nothing with the pref off");
});

test("a page call goes out as the text it came as, with the tab and attach that chrome knows, and its answer comes back as it came", async () => {
  const { frame, load, from_module, extension_sends } = locked();
  await load();
  // Text that would steer a reader: not JSON, an address, a selector. Chrome hands it on unread.
  const text = 'not json {"type":"run","url":"https://evil.test/","selector":"#x"} ‮';
  const answered = frame.transport()!.call(text);
  const [request] = from_module();
  assert.equal(request!.kind, "page_call");
  assert.deepEqual(request!.args, { tab_id: 1, document_id: 1, message: text });
  const value = '{"value":"<img src=x onerror=1>"} trailing';
  extension_sends([{ v: V, reply_to: request!.id, ok: true, value }]);
  assert.equal(await answered, value);
  // An error reply rejects with its text.
  const refused = frame.transport()!.call("{}");
  extension_sends([{ v: V, reply_to: from_module().at(-1)!.id, ok: false, error: "no such tab" }]);
  await assert.rejects(refused, /no such tab/);
});

test("a push reaches the page code as the text it came as, and the page's answer text is the reply's value", async () => {
  const { frame, load, from_module, extension_sends } = locked();
  await load();
  const heard: string[] = [];
  frame.transport()!.on_push(async (text) => (heard.push(text), 'answer "as is'));
  const text = '{"type":"hint_frames_labels","labels":["<b>"]} \u0000';
  extension_sends([push_request("x1", 1, text)]);
  await settle();
  assert.deepEqual(heard, [text]);
  assert.deepEqual(from_module(), [{ v: V, reply_to: "x1", ok: true, value: 'answer "as is' }]);
  // A push to a tab with no page code gets an error reply at once.
  extension_sends([push_request("x1", 1, text), push_request("x2", 99, text)]);
  await settle();
  assert.deepEqual(from_module().at(-1), { v: V, reply_to: "x2", ok: false, error: "the page went away" });
});

test("pagehide answers every open push with an error and cuts the sandbox off, and the next document attaches under a new id", async () => {
  const { frame, load, from_module, extension_sends, set_page } = locked();
  await load();
  frame.transport()!.on_push(() => new Promise(() => undefined));
  extension_sends([push_request("x1", 1, "{}")]);
  await settle();
  const open_call = assert.rejects(frame.transport()!.call("{}"), /went away/);
  assert.deepEqual(from_module().filter((message) => "reply_to" in message), [], "the push waits on the page");
  frame.fire("pagehide");
  await settle();
  assert.deepEqual(from_module().find((message) => message.reply_to === "x1"), { v: V, reply_to: "x1", ok: false, error: "the page went away" });
  await open_call;
  assert.equal(frame.nuked.length, 1);
  assert.equal(frame.observers.size, 0, "no observer outlives the page");
  assert.deepEqual(gone_of(from_module()), [{ tab_id: 1, document_id: 1 }], "chrome tells the extension the document is gone");
  // The call's late reply finds no page.
  extension_sends([{ v: V, reply_to: from_module().find((message) => message.kind === "page_call")!.id as string, ok: true, value: "{}" }]);
  set_page({ principal: PDF_PRINCIPAL, uri: "file:///tmp/b.pdf", inner: 6 });
  await load();
  assert.equal(frame.sandboxes.length, 2);
  void frame.transport()!.call("{}");
  assert.equal((from_module().at(-1)!.args as { document_id: number }).document_id, 2, "a new attach, a new document_id");
});

test("a page that Back restores from the cache keeps its sandbox and calls under a new document_id", async () => {
  const { frame, load, from_module, extension_sends } = locked();
  await load();
  frame.transport()!.on_push(() => new Promise(() => undefined));
  extension_sends([push_request("x1", 1, "{}")]);
  await settle();
  frame.fire("pagehide", true);
  await settle();
  assert.equal(from_module().find((message) => message.reply_to === "x1")?.ok, false, "the cached page answers its open push");
  assert.equal(frame.nuked.length, 0);
  assert.equal(frame.transport()!.alive(), false, "a cached page sends nothing");
  assert.deepEqual(gone_of(from_module()), [{ tab_id: 1, document_id: 1 }], "a cached document's attach is gone too");
  extension_sends([push_request("x1", 1, "{}"), push_request("x2", 1, "{}")]);
  await settle();
  assert.equal(from_module().find((message) => message.reply_to === "x2")?.ok, false, "nor takes a push");
  frame.fire("pageshow", true);
  await settle();
  assert.equal(frame.sandboxes.length, 1, "the same sandbox");
  assert.equal(frame.transport()!.alive(), true);
  void frame.transport()!.call("{}");
  assert.equal((from_module().at(-1)!.args as { document_id: number }).document_id, 2);
});

test("a new attach in the same tab with no pagehide before it tells the extension the old document is gone", async () => {
  const { frame, load, from_module, set_page } = locked();
  await load();
  set_page({ principal: PDF_PRINCIPAL, uri: "file:///tmp/b.pdf", inner: 6 });
  await load();
  assert.equal(frame.sandboxes.length, 2);
  assert.deepEqual(gone_of(from_module()), [{ tab_id: 1, document_id: 1 }]);
});

test("bundles load by their fixed names only, once each", async () => {
  const { frame, load, extension } = locked();
  await load();
  const transport = frame.transport()!;
  assert.deepEqual(plain(await transport.load_bundle("hints")), { ok: true });
  assert.deepEqual(plain(await transport.load_bundle("hints")), { ok: true });
  for (const name of ["../background", "hints.js", "https://evil.test/x", "__proto__", "content"]) assert.equal((await transport.load_bundle(name)).ok, false, name);
  assert.deepEqual(frame.loaded.slice(2), [`${extension.baseURI.spec}hints.js`]);
});

test("a snapshot change reaches the page code, and the setting going off drops it", async () => {
  const { firefox, frame, load } = locked();
  await load();
  const changed: string[] = [];
  frame.transport()!.on_snapshot((part) => changed.push(part));
  const theme = { v: V, value: { dark: {}, light: {} } };
  firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_THEME_STORAGE_KEY, theme);
  assert.deepEqual(changed, ["theme"]);
  assert.deepEqual(plain(frame.transport()!.snapshot("theme")), theme);
  firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, { v: V, value: { settings: { browser_module: true, browser_module_pages: false } } });
  assert.equal(frame.nuked.length, 1, "the setting off cuts the sandbox off");
});

test("the module pref going off drops the page code", async () => {
  const { firefox, frame, load } = locked();
  await load();
  firefox.set_pref(false);
  assert.equal(frame.nuked.length, 1);
});

test("a reply to a call the module started reaches its on_reply once, and watch_session hears its keys", async () => {
  const firefox = create_firefox();
  firefox.start_extension();
  firefox.make_window().load();
  const core = firefox.Services.desertfox_browser_module as { send(kind: string, args: unknown, on_reply?: (reply: unknown) => void): { ok: boolean; id: string }; watch_session(keys: string[], fn: (key: string, value: unknown) => void): void };
  const replies: unknown[] = [];
  const sent = core.send("page_call", { tab_id: 1, document_id: 1, message: "{}" }, (reply) => replies.push(plain(reply)));
  assert.ok(sent.ok);
  const reply = { v: V, reply_to: sent.id, ok: true, value: "{}" };
  firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [reply]);
  firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [reply]);
  assert.deepEqual(replies, [{ reply_to: sent.id, ok: true, value: "{}" }]);
  const heard: unknown[] = [];
  core.watch_session(["watched"], (key, value) => heard.push([key, plain(value)]));
  firefox.extension_writes("watched", { a: 1 });
  firefox.extension_writes("other", { a: 2 });
  assert.deepEqual(heard, [["watched", { a: 1 }]]);
});

test("the core's fail-safe shut down drops every page's code, a cached one too, and takes the feature's listeners down", async () => {
  const { firefox, frame, load, add_tab } = locked();
  await load();
  const cached = add_tab({ principal: PDF_PRINCIPAL, uri: "file:///tmp/c.pdf", inner: 7 });
  await cached.load();
  cached.frame.fire("pagehide", true);
  const observers_before = firefox.pref_observer_count();
  (firefox.Services.desertfox_browser_module as { shut_down(): void }).shut_down();
  assert.equal(frame.nuked.length, 1, "the shown page");
  assert.equal(cached.frame.nuked.length, 1, "the cached page");
  assert.equal(firefox.message_listener_count(), 0, "the feature's message listeners are gone, as are the core's");
  assert.ok(firefox.pref_observer_count() < observers_before, "its pref observer is gone");
  const later = add_tab({ principal: PDF_PRINCIPAL, uri: "file:///tmp/d.pdf", inner: 9 });
  await later.load();
  assert.equal(later.frame.sandboxes.length, 0, "no page attaches after the shut down");
});

test("a tab moved to another window keeps its page code: calls, pushes and the end of the attach go through the new <browser>", async () => {
  const { frame, load, move_to_another_window, from_module, extension_sends } = locked();
  await load();
  const heard: string[] = [];
  frame.transport()!.on_push(async (text) => (heard.push(text), "answer"));
  move_to_another_window();
  const answered = frame.transport()!.call("after the move");
  const request = from_module().find((message) => message.kind === "page_call");
  assert.deepEqual(request?.args, { tab_id: 1, document_id: 1, message: "after the move" });
  extension_sends([{ v: V, reply_to: request!.id, ok: true, value: "reached" }]);
  assert.equal(await answered, "reached");
  extension_sends([push_request("x1", 1, "a push")]);
  await settle();
  assert.deepEqual(heard, ["a push"]);
  assert.deepEqual(from_module().find((message) => message.reply_to === "x1"), { v: V, reply_to: "x1", ok: true, value: "answer" });
  frame.fire("pagehide");
  assert.deepEqual(gone_of(from_module()), [{ tab_id: 1, document_id: 1 }]);
});

test("turning the setting or the pref off drops a page in the back-forward cache, so Back never revives it", async () => {
  for (const turn_off of ["setting", "pref"] as const) {
    const { firefox, frame, load } = locked();
    await load();
    frame.fire("pagehide", true);
    if (turn_off === "setting") firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, { v: V, value: { settings: { browser_module: true, browser_module_pages: false } } });
    else firefox.set_pref(false);
    assert.equal(frame.nuked.length, 1, `the ${turn_off} off nukes the cached page`);
    frame.fire("pageshow", true);
    await settle();
    assert.equal(frame.sandboxes.length, 1, `Back after the ${turn_off} went off starts nothing`);
  }
});

test("Back drops a cached page whose attach is refused, or that the frame finds with the pref off", async () => {
  const refused = locked();
  await refused.load();
  refused.frame.fire("pagehide", true);
  // A config snapshot removed without a watcher's word, as when DesertFox goes away.
  refused.firefox.extension!.bucket.delete(BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY);
  refused.frame.fire("pageshow", true);
  await settle();
  assert.equal(refused.frame.nuked.length, 1, "a refused attach drops the cached page");
  const pref_off = locked();
  await pref_off.load();
  pref_off.frame.fire("pagehide", true);
  pref_off.frame.frame.pref = false;
  pref_off.frame.fire("pageshow", true);
  assert.equal(pref_off.frame.nuked.length, 1, "the frame drops it itself with the pref off");
});

test("Back never revives the page code of a DesertFox that reloaded since: the cached sandbox goes and a new one starts", async () => {
  const { firefox, frame, load } = locked();
  await load();
  frame.fire("pagehide", true);
  firefox.start_extension();
  frame.fire("pageshow", true);
  await settle();
  assert.equal(frame.sandboxes.length, 1, "no snapshots yet, so nothing attaches");
  firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, ON_CONFIG);
  firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_KEYMAP_STORAGE_KEY, KEYMAP);
  await settle();
  assert.equal(frame.nuked.length, 1, "the old code is cut off");
  assert.equal(frame.sandboxes.length, 2, "the new DesertFox's code starts");
});

test("an open PDF gets page code again with no reload once the setting, the pref or DesertFox comes back", async () => {
  const { firefox, frame, load } = locked();
  await load();
  firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, { v: V, value: { settings: { browser_module: true, browser_module_pages: false } } });
  assert.equal(frame.nuked.length, 1);
  firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, ON_CONFIG);
  await settle();
  assert.equal(frame.sandboxes.length, 2, "the setting on again");
  // More snapshot writes ask again, and a page that already runs this DesertFox's code keeps it.
  firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_THEME_STORAGE_KEY, { v: V, value: { dark: {}, light: {} } });
  await settle();
  assert.equal(frame.sandboxes.length, 2, "no second sandbox for the same document");
  firefox.set_pref(false);
  firefox.set_pref(true);
  await settle();
  assert.equal(frame.sandboxes.length, 3, "the pref on again");
  firefox.start_extension();
  firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, ON_CONFIG);
  firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_KEYMAP_STORAGE_KEY, KEYMAP);
  await settle();
  assert.equal(frame.nuked.length, 3, "the reloaded DesertFox's pages drop the old code");
  assert.equal(frame.sandboxes.length, 4, "and get the new one");
  assert.equal(frame.transport()!.base_url, firefox.extension!.baseURI.spec);
});

test("an open PDF that loaded while the setting was off gets page code once it turns on", async () => {
  const { firefox, frame, load } = locked({ config: null });
  await load();
  assert.equal(frame.sandboxes.length, 0);
  firefox.extension_writes(BROWSER_MODULE_SNAPSHOT_CONFIG_STORAGE_KEY, ON_CONFIG);
  await settle();
  assert.equal(frame.sandboxes.length, 1);
});

test("a push for a document that a reload replaced never reaches the new document", async () => {
  const { frame, load, set_page, from_module, extension_sends } = locked();
  await load();
  set_page({ principal: PDF_PRINCIPAL, uri: "file:///tmp/a.pdf", inner: 6 });
  await load();
  const heard: string[] = [];
  frame.transport()!.on_push(async (text) => (heard.push(text), "answer"));
  extension_sends([push_request("old", 1, "for document 1", 1)]);
  await settle();
  assert.deepEqual(heard, []);
  assert.deepEqual(from_module().find((message) => message.reply_to === "old"), { v: V, reply_to: "old", ok: false, error: "the page went away" });
  extension_sends([push_request("new", 1, "for document 2", 2)]);
  await settle();
  assert.deepEqual(heard, ["for document 2"]);
});

test("one tab's frame can neither end another tab's attach, call under it, nor answer its push", async () => {
  const a = locked();
  await a.load();
  const b = a.add_tab({ principal: PDF_PRINCIPAL, uri: "file:///tmp/b.pdf", inner: 8 });
  await b.load();
  a.frame.transport()!.on_push(() => new Promise(() => undefined));
  a.extension_sends([push_request("to_a", 1, "{}", 1)]);
  await settle();
  assert.equal(a.from_module().find((message) => message.reply_to === "to_a"), undefined, "tab A's push waits on its page");
  // Tab B's frame names tab A's attach (1) and push (1).
  a.firefox.from_frame("desertfox-browser-module:locked-push-answer", b.browser, { push_id: 1, ok: true, text: "forged" });
  a.firefox.from_frame("desertfox-browser-module:locked-call", b.browser, { attach_id: 1, call_id: 99, message: "forged call" });
  a.firefox.from_frame("desertfox-browser-module:locked-gone", b.browser, { attach_id: 1 });
  await settle();
  assert.equal(a.from_module().find((message) => message.reply_to === "to_a"), undefined, "B's answer does not settle A's push");
  assert.deepEqual(a.from_module().filter((message) => message.kind === "page_call"), [], "B's call under A's attach goes nowhere");
  assert.deepEqual(gone_of(a.from_module()), [], "B cannot end A's attach");
  void a.frame.transport()!.call("A still calls");
  assert.deepEqual(a.from_module().find((message) => message.kind === "page_call")?.args, { tab_id: 1, document_id: 1, message: "A still calls" }, "A's attach still stands");
});

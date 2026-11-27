import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_PROTOCOL_VERSION, MODULE_COMMAND_ARGS } from "../../src/shared/browser_module_protocol.ts";
import {
  BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY,
  BROWSER_MODULE_FROM_MODULE_STORAGE_KEY,
  BROWSER_MODULE_HELLO_STORAGE_KEY,
  BROWSER_MODULE_STATE_STORAGE_KEY,
} from "../../src/shared/config/storage_keys.ts";
import { event_to_token } from "../../src/shared/keys/token.ts";
import { CORE_FILE, create_firefox, FEATURE_FILE, IME_ENABLED, key_event, source_of } from "./fake_firefox.ts";

const DEFAULT_KEYS = [
  { key: "J", id: "tab.next", args: {} },
  { key: "K", id: "tab.prev", args: {} },
  { key: "j", id: "scroll.lines", args: { count: 10 } },
  { key: "G", id: "scroll.to", args: { percent: 100, axis: "y" } },
  { key: "<C-d>", id: "scroll.pages", args: { fraction: 0.5, count: 1 } },
];
const state = (patch: Record<string, unknown> = {}) => ({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: DEFAULT_KEYS, tabs: {}, ...patch });

// One window with one tab, the module loaded, DesertFox running and its state written.
function started({ pref = true as boolean | string | null, private_window = false, private_access = false, written = state() as unknown } = {}) {
  const firefox = create_firefox({ pref });
  firefox.start_extension({ private_access });
  const window = firefox.make_window({ private_window });
  window.load();
  const { tab, browser } = window.add_tab();
  if (written !== null) firefox.write_state(written);
  const press = (key: string, patch = {}) => window.press(key_event(key, { target: browser, originalTarget: browser, ...patch }));
  return { firefox, window, tab, browser, press };
}

// Values made inside a vm context have that context's prototypes, which a strict deep equal tells apart.
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const constant_in = (source: string, name: string) => new RegExp(`const ${name} = ("[^"]*"|\\d+);`).exec(source)?.[1];

const table_in = (source: string, name: string) => {
  const text = new RegExp(`const ${name} = (\\{[^;]*\\});`).exec(source)?.[1];
  return text === undefined ? undefined : plain(vm.runInNewContext(`(${text})`));
};

test("the module's copy of the key names, the version, the limits and the kind lists equals src/shared", () => {
  const source = source_of(CORE_FILE);
  assert.equal(constant_in(source, "STATE_STORAGE_KEY"), JSON.stringify(BROWSER_MODULE_STATE_STORAGE_KEY));
  assert.equal(constant_in(source, "HELLO_STORAGE_KEY"), JSON.stringify(BROWSER_MODULE_HELLO_STORAGE_KEY));
  assert.equal(constant_in(source, "FROM_EXTENSION_STORAGE_KEY"), JSON.stringify(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY));
  assert.equal(constant_in(source, "FROM_MODULE_STORAGE_KEY"), JSON.stringify(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY));
  assert.equal(constant_in(source, "PROTOCOL_VERSION"), String(BROWSER_MODULE_PROTOCOL_VERSION));
  for (const name of ["MAX_KEY_ROWS", "MAX_STATE_TABS", "MAX_MESSAGES", "MAX_MESSAGE_LIST_BYTES", "MAX_ERROR_CHARS", "DEFAULT_MAX_AGE_MS", "MAX_KIND_BYTES", "MESSAGE_ENVELOPE_BYTES", "MAX_RESIZE_STEPS"] as const) assert.equal(constant_in(source, name), String(protocol[name]), name);
  assert.match(source, new RegExp(`\\{1,${protocol.MAX_MESSAGE_ID_CHARS}\\}`), "the message id pattern takes MAX_MESSAGE_ID_CHARS");
  assert.deepEqual(plain(vm.runInNewContext(/const PANE_REGIONS = (\[[^\]]*\]);/.exec(source)![1]!)), protocol.PANE_REGIONS);
  assert.deepEqual(table_in(source, "EXTENSION_TO_MODULE_KINDS"), protocol.EXTENSION_TO_MODULE_KINDS);
  assert.deepEqual(table_in(source, "MODULE_TO_EXTENSION_KINDS"), protocol.MODULE_TO_EXTENSION_KINDS);
});

test("the feature file defines every command of the protocol with the protocol's arg shapes", () => {
  const { firefox } = started();
  const core = firefox.Services.desertfox_browser_module as { status(): { commands: string[] } };
  assert.deepEqual(plain(core.status().commands).sort(), Object.keys(MODULE_COMMAND_ARGS).sort());
  const source = source_of(FEATURE_FILE);
  for (const [id, args] of Object.entries(MODULE_COMMAND_ARGS)) {
    for (const name of Object.keys(args)) assert.match(source, new RegExp(`"${id.replace(".", "\\.")}", \\{[^}]*\\b${name}:`), `${id} ${name}`);
  }
});

test("J switches to the next tab and stops the key, K to the previous one", () => {
  const { window, press } = started();
  const event = press("J");
  assert.ok(event.prevented && event.stopped);
  press("K");
  assert.deepEqual(window.tab_moves, [1, -1]);
});

test("a scroll key goes to the tab's frame script with the checked args, and a held key says so", () => {
  const { firefox, browser, press } = started();
  press("j", { repeat: true });
  assert.equal(firefox.sent_to_frames.length, 1);
  assert.equal(firefox.sent_to_frames[0]!.browser, browser);
  assert.deepEqual(plain(firefox.sent_to_frames[0]), { browser: plain(browser), name: "desertfox-browser-module:scroll", data: { id: "scroll.lines", args: { count: 10 }, repeat: true } });
});

test("the module's key token equals event_to_token for every key shape it meets", () => {
  const shapes = [
    key_event("J"),
    key_event("j"),
    key_event("$", { shiftKey: true }),
    key_event(" "),
    key_event("Escape"),
    key_event("d", { ctrlKey: true }),
    key_event("D", { ctrlKey: true, shiftKey: true }),
    key_event("в", { ctrlKey: true, code: "KeyD" }),
    key_event("в", { code: "KeyD" }),
    key_event("F5"),
    key_event("ArrowDown", { shiftKey: true }),
    key_event("k", { altKey: true, metaKey: true }),
  ];
  for (const event of shapes) {
    const token = event_to_token(event)!;
    const { window, press } = started({ written: state({ keys: [{ key: token, id: "tab.next", args: {} }] }) });
    const { target: _target, originalTarget: _original, ...shape } = event;
    press(event.key, shape);
    assert.deepEqual(window.tab_moves, [1], `the module did not read ${JSON.stringify(event.key)} as ${token}`);
  }
});

test("nothing is taken with the pref unset, off or not a boolean, and a bad pref logs one line", () => {
  for (const pref of [null, false]) {
    const { window, press } = started({ pref });
    assert.equal(press("J").prevented, false);
    assert.deepEqual(window.tab_moves, []);
  }
  const { firefox, window, press } = started({ pref: "yes" });
  press("J");
  press("J");
  assert.deepEqual(window.tab_moves, []);
  assert.equal(firefox.errors.filter((line) => line.includes("not true or false")).length, 1);
});

test("nothing is taken with the toolbar switch off, another protocol version, no state or a broken state", () => {
  for (const written of [state({ enabled: false }), state({ v: BROWSER_MODULE_PROTOCOL_VERSION + 1 }), null, "junk", state({ keys: "J" }), state({ tabs: [] })]) {
    const { window, press } = started({ written });
    assert.equal(press("J").prevented, false, String(JSON.stringify(written)));
    assert.deepEqual(window.tab_moves, []);
  }
});

test("unknown fields are accepted, and a row the module cannot run is skipped without losing the others", () => {
  const keys = [
    { key: "J", id: "tab.next", args: {}, label: "new field" },
    { key: "x", id: "tab.close", args: {} },
    { key: "j", id: "scroll.lines", args: { count: "10" } },
    { key: "k", id: "scroll.lines" },
    { key: "two words", id: "tab.prev", args: {} },
    { key: "J", id: "tab.prev", args: {} },
  ];
  const { window, firefox, press } = started({ written: state({ keys, future: { anything: true } }) });
  for (const key of ["x", "j", "k"]) assert.equal(press(key).prevented, false, key);
  press("J");
  assert.deepEqual(window.tab_moves, [1]);
  assert.deepEqual(firefox.sent_to_frames, []);
});

test("an extension reload empties the state, so the module claims nothing until the new extension writes it", () => {
  const { firefox, window, press } = started();
  firefox.start_extension();
  assert.equal(press("J").prevented, false);
  firefox.write_state(state());
  press("J");
  assert.deepEqual(window.tab_moves, [1]);
});

test("DesertFox live in the shown document keeps the key, by the live mark or by the report for the current document", () => {
  const live_mark = started({ written: state({ tabs: { "1": { mode: "normal", live: true } } }) });
  assert.equal(live_mark.press("J").prevented, false);

  const reported = started();
  reported.firefox.report(reported.browser, { inner: 10, listeners: 1, field: false });
  assert.equal(reported.press("J").prevented, false);
});

test("a report from an old document is not trusted, and a tab with no record is normal and not live", () => {
  const { firefox, browser, window, press } = started({ written: state({ tabs: { "99": { mode: "insert", live: true } } }) });
  firefox.report(browser, { inner: 9, listeners: 1, field: true });
  press("J");
  assert.deepEqual(window.tab_moves, [1]);
});

test("a tab in a mode other than normal keeps the key", () => {
  for (const mode of ["insert", "ignore", "hint"]) {
    const { press } = started({ written: state({ tabs: { "1": { mode, live: false } } }) });
    assert.equal(press("J").prevented, false, mode);
  }
});

test("a key in a field types: the report says so, or the input state shows a field before the report lands", () => {
  const reported = started();
  reported.firefox.report(reported.browser, { inner: 10, listeners: 0, field: true });
  assert.equal(reported.press("J").prevented, false);

  const early = started();
  early.window.win.windowUtils.IMEStatus = IME_ENABLED;
  assert.equal(early.press("J").prevented, false);
});

test("a page in this process is read directly: a focused field or a design mode document types", () => {
  const { window, browser, press } = started();
  const page_document = { designMode: "off", activeElement: { localName: "div" }, defaultView: { browsingContext: { isContent: true, top: { embedderElement: browser } } } };
  const field = { localName: "input", type: "search", ownerDocument: page_document };
  const body = { localName: "div", ownerDocument: page_document };
  assert.equal(press("J", { target: field, originalTarget: field }).prevented, false);
  page_document.activeElement = field;
  assert.equal(press("J", { target: body, originalTarget: body }).prevented, false);
  page_document.activeElement = { localName: "div" };
  page_document.designMode = "on";
  assert.equal(press("J", { target: body, originalTarget: body }).prevented, false);
  page_document.designMode = "off";
  press("J", { target: body, originalTarget: body });
  assert.deepEqual(window.tab_moves, [1]);
});

test("a key in the browser UI, DevTools, a sidebar or a popup is not for a page", () => {
  const { window, press } = started();
  const ui = { localName: "input", ownerDocument: window.win.document };
  const devtools_document = { defaultView: { browsingContext: { isContent: false, top: {} } } };
  const devtools_tree = { localName: "div", ownerDocument: devtools_document };
  const sidebar_browser = { localName: "browser" };
  for (const target of [ui, devtools_tree, sidebar_browser, undefined]) assert.equal(press("J", { target, originalTarget: target }).prevented, false);
  assert.deepEqual(window.tab_moves, []);
});

test("a private window gets the module only when DesertFox may run in private windows", () => {
  const denied = started({ private_window: true });
  assert.equal(denied.press("J").prevented, false);
  const allowed = started({ private_window: true, private_access: true });
  assert.equal(allowed.press("J").prevented, true);
});

test("an untrusted key, an IME composition or a modifier alone is never taken", () => {
  const { window, press } = started();
  press("J", { isTrusted: false });
  press("J", { isComposing: true });
  press("J", { keyCode: 229 });
  press("Shift", { shiftKey: true });
  press("J", { defaultPrevented: true });
  assert.deepEqual(window.tab_moves, []);
});

test("a Firefox internal that throws leaves the key to the page and logs one line", () => {
  const { firefox, window, press } = started();
  firefox.fail_tab_ids = true;
  assert.equal(press("J").prevented, false);
  assert.equal(press("J").prevented, false);
  assert.deepEqual(window.tab_moves, []);
  assert.equal(firefox.errors.filter((line) => line.includes("tabTracker changed")).length, 1);
});

test("the core is built once per process: one sandbox, one report listener and one frame script set for two windows", () => {
  const { firefox } = started();
  const second = firefox.make_window();
  second.load();
  assert.equal(firefox.sandboxes, 1);
  assert.equal(firefox.message_listener_count(), 1);
  assert.equal(firefox.frame_scripts.length, 2);
  firefox.set_pref(false);
  firefox.set_pref(true);
  assert.equal(firefox.frame_scripts.length, 2, "turning the pref off and on again loads the frame scripts again");
  const core = firefox.Services.desertfox_browser_module as { status(): { windows: number; features: string[] } };
  assert.equal(core.status().windows, 2);
  assert.deepEqual(plain(core.status().features), [FEATURE_FILE]);
});

test("a closed window loses its listeners and leaves the core to the other windows", () => {
  const { firefox, window } = started();
  const second = firefox.make_window();
  second.load();
  const { browser } = second.add_tab();
  window.close();
  assert.equal(window.listener_count("keydown"), 0);
  assert.equal(window.listener_count("unload"), 0);
  second.press(key_event("J", { target: browser, originalTarget: browser }));
  assert.deepEqual(second.tab_moves, [1]);
});

test("with the pref off the module loads no frame script and says no hello, and turning it on does both", () => {
  const firefox = create_firefox({ pref: false });
  firefox.start_extension();
  firefox.make_window().load();
  assert.deepEqual(firefox.frame_scripts, []);
  assert.equal(firefox.hello(), undefined);
  firefox.set_pref(true);
  assert.equal(firefox.frame_scripts.length, 2);
  assert.deepEqual(firefox.hello(), { v: BROWSER_MODULE_PROTOCOL_VERSION, module_version: "1.0.0" });
  firefox.set_pref(false);
  assert.equal(firefox.hello(), undefined, "the pref turned off takes the hello back");
  firefox.set_pref(true);
  assert.deepEqual(firefox.hello(), { v: BROWSER_MODULE_PROTOCOL_VERSION, module_version: "1.0.0" }, "the pref turned on again says the hello again");
  assert.equal(firefox.frame_scripts.length, 2);
});

test("each new extension object gets the hello, so a reloaded DesertFox sees the module again", () => {
  const firefox = create_firefox();
  firefox.make_window().load();
  assert.equal(firefox.extension, undefined);
  firefox.start_extension();
  assert.equal((firefox.hello() as { v: number }).v, BROWSER_MODULE_PROTOCOL_VERSION);
  const before = firefox.extension;
  firefox.start_extension();
  assert.notEqual(firefox.extension, before);
  assert.equal((firefox.hello() as { v: number }).v, BROWSER_MODULE_PROTOCOL_VERSION);
});

test("a core that fails to build turns the module off for the session, logs once and never throws into the loader", () => {
  const firefox = create_firefox();
  firefox.fail_import = true;
  const first = firefox.make_window();
  first.load();
  const { browser } = first.add_tab();
  firefox.fail_import = false;
  const second = firefox.make_window();
  second.load();
  assert.equal(firefox.Services.desertfox_browser_module, "off");
  assert.equal(firefox.sandboxes, 1, "a later window must not try again");
  assert.deepEqual(firefox.errors.filter((line) => line.startsWith("loader:")), []);
  assert.equal(firefox.errors.filter((line) => line.includes("turned off for this session")).length, 1);
  first.press(key_event("J", { target: browser }));
  assert.deepEqual(first.tab_moves, []);
});

test("a window whose attach fails turns the module off for every window", () => {
  const { firefox, window } = started();
  const broken = firefox.make_window();
  // A window without the listener calls Firefox gives every window.
  broken.win.addEventListener = () => {
    throw new Error("no listeners here");
  };
  broken.load();
  assert.equal(firefox.Services.desertfox_browser_module, "off");
  assert.equal(window.listener_count("keydown"), 0);
  assert.deepEqual(firefox.errors.filter((line) => line.startsWith("loader:")), []);
});

test("the core loads only feature files from its own folder", () => {
  const { firefox } = started();
  const core = firefox.Services.desertfox_browser_module as { adopt(url: string): void; status(): { features: string[] } };
  core.adopt("file:///home/user/.mozilla/evil.js");
  core.adopt("file:///usr/lib/firefox/chrome.d/sub/evil.js");
  assert.deepEqual(plain(core.status().features), [FEATURE_FILE]);
  assert.equal(firefox.errors.filter((line) => line.includes("refused a feature file")).length, 2);
});

test("a command that throws leaves the key to the page: the module cancels a key only after its command ran", () => {
  const { firefox, window, press } = started();
  firefox.fail_tab_moves = true;
  const event = press("J");
  assert.equal(event.prevented || event.stopped, false);
  assert.deepEqual(window.tab_moves, []);
  assert.equal(firefox.errors.filter((line) => line.includes("advanceSelectedTab changed")).length, 1);
});

test("a feature file that fails partway through its start turns the module off for the session", () => {
  const broken = `(function (scope) {
    const core = Services.desertfox_browser_module;
    if (typeof core !== "object" || core === null) return;
    if (scope.gBrowser) return core.adopt(Components.stack.filename);
    core.define_command("broken.first", { args: {}, run: () => undefined });
    throw new Error("half started");
  })(this);`;
  const firefox = create_firefox({ extra_files: { "desertfox-zz-broken.js": broken } });
  firefox.start_extension();
  const window = firefox.make_window();
  window.load();
  const { browser } = window.add_tab();
  firefox.write_state(state());
  assert.equal(firefox.Services.desertfox_browser_module, "off");
  assert.equal(window.press(key_event("J", { target: browser, originalTarget: browser })).prevented, false);
  assert.deepEqual(window.tab_moves, []);
  assert.deepEqual(firefox.errors.filter((line) => line.startsWith("loader:")), []);
  assert.equal(firefox.errors.filter((line) => line.includes("half started")).length, 1);
});

test("a feature file of the tab and scroll set that throws in its start turns the module off too", () => {
  const firefox = create_firefox({ patch_source: (name, source) => (name === FEATURE_FILE ? source.replace(`core.add_frame_script(scroll_frame_script);`, `throw new Error("no frame scripts");`) : source) });
  firefox.start_extension();
  firefox.make_window().load();
  assert.equal(firefox.Services.desertfox_browser_module, "off");
});

test("a state past the protocol's limits or with a malformed tab claims nothing and never throws", () => {
  const many_keys = Array.from({ length: 33 }, (_, index) => ({ key: index === 0 ? "J" : `<F${index}>`, id: "tab.next", args: {} }));
  const many_tabs = Object.fromEntries(Array.from({ length: 1025 }, (_, index) => [String(index + 100), { mode: "normal", live: false }]));
  for (const written of [state({ keys: many_keys }), state({ tabs: many_tabs }), state({ tabs: { "1": null } }), state({ tabs: { "1": { mode: 3, live: false } } }), state({ tabs: { "1": { mode: "normal", live: "no" } } }), state({ tabs: { tab: { mode: "normal", live: false } } }), state({ blur_on_load: "yes" })]) {
    const { firefox, window, press } = started({ written });
    assert.equal(press("J").prevented, false, JSON.stringify(written).slice(0, 80));
    assert.deepEqual(window.tab_moves, []);
    assert.deepEqual(firefox.errors, []);
  }
});

// ---- The messages. These tests put test-only rows into the module's copy of the kind lists, so each path has a kind to take.

const TEST_EXTENSION_KINDS = {
  note: { args: { n: "int" }, reply: true },
  nudge: { args: { n: "int" }, reply: false },
  quick: { args: {}, reply: true, max_age_ms: 100 },
  fails: { args: {}, reply: true },
  rejects: { args: {}, reply: true },
  shapeless: { args: {}, reply: true },
  wordy: { args: {}, reply: true },
  later: { args: {}, reply: true },
  unanswered: { args: {}, reply: true },
  sized: { args: { message: "text" }, reply: true, max_bytes: 200 },
  noisy: { args: {}, reply: true },
};
const TEST_MODULE_KINDS = { ping: { args: { axis: "axis" }, reply: true } };

// A feature file that answers the test kinds and notes each call on `Services`, which the test shares with the module.
const ANSWERING_FEATURE = `(function (scope) {
  const core = Services.desertfox_browser_module;
  if (typeof core !== "object" || core === null) return;
  if (scope.gBrowser) return core.adopt(Components.stack.filename);
  const calls = (Services.test_calls = []);
  core.register_kind("note", (args) => (calls.push("note " + args.n), { ok: true, value: "seen " + args.n }));
  core.register_kind("nudge", (args) => void calls.push("nudge " + args.n));
  core.register_kind("quick", () => ({ ok: true }));
  core.register_kind("fails", () => { throw new Error("secret detail"); });
  core.register_kind("rejects", () => Promise.reject(new Error("secret detail")));
  core.register_kind("shapeless", () => "yes");
  core.register_kind("wordy", () => ({ ok: false, error: "x".repeat(500) }));
  core.register_kind("noisy", () => ({ ok: false, error: "no\\u202e split\\n\\u0007here" }));
  core.register_kind("later", () => new Promise((resolve) => { Services.test_resolve = resolve; }));
  core.register_kind("sized", (args) => ({ ok: true, value: args.message.repeat(10) }));
  core.register_kind("tab.close", () => ({ ok: true }));
})(this);`;

function messaging({ pref = true as boolean | null } = {}) {
  const firefox = create_firefox({
    pref,
    extra_files: { "desertfox-zz-answers.js": ANSWERING_FEATURE },
    patch_source: (name, source) => {
      if (name !== CORE_FILE) return source;
      const patched = source.replace(/const EXTENSION_TO_MODULE_KINDS = \{[^;]*\};/, `const EXTENSION_TO_MODULE_KINDS = ${JSON.stringify(TEST_EXTENSION_KINDS)};`).replace(/const MODULE_TO_EXTENSION_KINDS = \{[^;]*\};/, `const MODULE_TO_EXTENSION_KINDS = ${JSON.stringify(TEST_MODULE_KINDS)};`);
      assert.notEqual(patched, source, "the kind lists moved, so the test rows went nowhere");
      return patched;
    },
  });
  firefox.start_extension();
  firefox.make_window().load();
  const services = firefox.Services as Record<string, unknown>;
  const send = (list: unknown, extension = firefox.extension) => firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, list, extension);
  const replies = (extension = firefox.extension) => plain(firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY, extension) ?? []);
  const calls = () => plain(services.test_calls);
  const core = services.desertfox_browser_module as { send(kind: string, args?: unknown): { ok: boolean; id?: string; problem?: string }; register_kind(kind: string, fn: unknown): void; status(): { errors: string[] } };
  return { firefox, send, replies, calls, core, services };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const request = (id: string, kind: string, args: Record<string, unknown> = {}, more: Record<string, unknown> = {}) => ({ v: 1, id, kind, args, sent_at: Date.now(), ...more });

test("a request is answered once and a push gets no reply, though the extension rewrites its list whole", async () => {
  const { send, replies, calls } = messaging();
  send([request("a", "note", { n: 1 }), request("b", "nudge", { n: 2 })]);
  await settle();
  assert.deepEqual(calls(), ["note 1", "nudge 2"]);
  assert.deepEqual(replies(), [{ v: 1, reply_to: "a", ok: true, value: "seen 1" }]);
  send([request("a", "note", { n: 1 }), request("b", "nudge", { n: 2 }), request("c", "note", { n: 3 })]);
  await settle();
  assert.deepEqual(calls(), ["note 1", "nudge 2", "note 3"]);
  assert.deepEqual(replies(), [
    { v: 1, reply_to: "a", ok: true, value: "seen 1" },
    { v: 1, reply_to: "c", ok: true, value: "seen 3" },
  ]);
});

test("junk, another version, a bad id, too many messages and too many bytes are dropped without a word", async () => {
  const { firefox, send, replies, calls } = messaging();
  const too_many = Array.from({ length: protocol.MAX_MESSAGES + 1 }, (_, index) => request(`m${index}`, "note", { n: index }));
  const too_big = [request("big", "note", { n: 1, pad: "x".repeat(protocol.message_list_bytes(TEST_EXTENSION_KINDS as never)) })];
  for (const list of ["junk", { 0: request("o", "note", { n: 1 }) }, [request("v", "note", { n: 1 }, { v: 2 })], [request("bad id!", "note", { n: 1 })], [42, null, "x"], too_many, too_big]) send(list);
  await settle();
  assert.deepEqual(calls(), []);
  assert.deepEqual(replies(), []);
  assert.deepEqual(firefox.errors.filter((line) => !line.includes("is not a kind the extension sends")), []);
});

test("a request of a kind not on the list or with bad args is refused with an error reply, and a bad push is dropped", async () => {
  const { send, replies, calls } = messaging();
  send([request("u", "tab.close"), request("w", "note", { n: "1" }), request("p", "nudge", { n: 1.5 }), request("t", "note", { n: 1 }, { sent_at: -1 })]);
  await settle();
  assert.deepEqual(calls(), []);
  assert.deepEqual(replies(), [
    { v: 1, reply_to: "u", ok: false, error: "the kind is not on the allow list" },
    { v: 1, reply_to: "w", ok: false, error: "note n has the wrong shape" },
    { v: 1, reply_to: "t", ok: false, error: "sent_at must be whole ms since the epoch" },
  ]);
});

test("a request older than its kind allows is dropped, and refused when it expects a reply; one with no sent_at is accepted", async () => {
  const { send, replies, calls } = messaging();
  const old = Date.now() - protocol.DEFAULT_MAX_AGE_MS - 500;
  send([request("o", "note", { n: 1 }, { sent_at: old }), request("p", "nudge", { n: 1 }, { sent_at: old }), request("q", "quick", {}, { sent_at: Date.now() - 500 }), request("n", "note", { n: 2 }, { sent_at: undefined })]);
  await settle();
  assert.deepEqual(calls(), ["note 2"]);
  assert.deepEqual(replies(), [
    { v: 1, reply_to: "o", ok: false, error: "the request is too old" },
    { v: 1, reply_to: "q", ok: false, error: "the request is too old" },
    { v: 1, reply_to: "n", ok: true, value: "seen 2" },
  ]);
});

test("a handler that throws, rejects or gives no result replies with a fixed error, never its own text, and a long error is cut", async () => {
  const { firefox, send, replies } = messaging();
  send([request("f", "fails"), request("r", "rejects"), request("s", "shapeless"), request("l", "wordy"), request("x", "unanswered")]);
  await settle();
  const got = replies() as { reply_to: string; ok: boolean; error?: string }[];
  assert.deepEqual(
    got.map(({ reply_to, ok, error }) => [reply_to, ok, error?.length ?? 0]).sort(),
    [
      ["f", false, "the request failed".length],
      ["l", false, protocol.MAX_ERROR_CHARS],
      ["r", false, "the request failed".length],
      ["s", false, "the request failed".length],
      ["x", false, "no handler for this kind".length],
    ],
  );
  assert.ok(!JSON.stringify(got).includes("secret"), "the exception text reached the reply");
  assert.ok(got.every((reply) => protocol.validate_message(reply, {}).ok), "a reply the extension refuses");
  assert.equal(firefox.errors.filter((line) => line.includes("failed: Error: secret detail")).length, 2);
});

test("a kind not on the list gets no handler", () => {
  const { firefox } = messaging();
  assert.equal(firefox.errors.filter((line) => line.includes("tab.close is not a kind the extension sends")).length, 1);
});

test("one storage listener for many windows, and a reloaded DesertFox gets its own while the old one goes", async () => {
  const { firefox, send, replies, calls, services } = messaging();
  firefox.make_window().load();
  firefox.make_window().load();
  const first = firefox.extension!;
  assert.equal(first.listeners.size, 1);
  send([request("slow", "later")]);
  await settle();
  const second = firefox.start_extension();
  assert.equal(first.listeners.size, 0);
  assert.equal(second.listeners.size, 1);
  // The old extension's handler answers after the reload: its bucket is gone, and the new one never heard the request.
  (services.test_resolve as (result: unknown) => void)({ ok: true });
  await settle();
  assert.deepEqual(replies(first), []);
  assert.deepEqual(replies(second), []);
  // A new extension starts its ids again, so an id the old one used is new here.
  send([request("slow", "note", { n: 7 })]);
  await settle();
  assert.deepEqual(calls(), ["note 7"]);
  assert.deepEqual(replies(second), [{ v: 1, reply_to: "slow", ok: true, value: "seen 7" }]);
});

test("with the pref off the reader runs nothing, and a reply that settles after the pref went off is not written", async () => {
  const { firefox, send, replies, calls, services } = messaging();
  send([request("slow", "later")]);
  await settle();
  firefox.set_pref(false);
  (services.test_resolve as (result: unknown) => void)({ ok: true });
  send([request("a", "note", { n: 1 })]);
  await settle();
  assert.deepEqual(calls(), []);
  assert.deepEqual(replies(), []);

  const unset = messaging({ pref: null });
  unset.send([request("a", "note", { n: 1 })]);
  await settle();
  assert.deepEqual(unset.calls(), []);
  assert.deepEqual(unset.replies(), []);
});

test("send writes a checked request with sent_at to the module's own list, and nothing while the pref is off", () => {
  const { firefox, core, replies } = messaging();
  const before = Date.now();
  const sent = core.send("ping", { axis: "x", extra: "dropped" });
  assert.equal(sent.ok, true);
  const [written] = replies() as { id: string; sent_at: number }[];
  assert.deepEqual(plain({ ...written, sent_at: 0 }), { v: 1, id: sent.id, kind: "ping", args: { axis: "x" }, sent_at: 0 });
  assert.ok(written!.sent_at >= before && written!.sent_at <= Date.now());
  const read_back = protocol.validate_message_list(replies(), TEST_MODULE_KINDS as never, Date.now());
  assert.ok(read_back.ok && read_back.value.messages.length === 1, "the extension refuses what send wrote");
  assert.equal(core.send("ping", { axis: "z" }).ok, false);
  assert.equal(core.send("tab.close").ok, false);
  for (let count = 0; count < 20; count++) core.send("ping", { axis: "y" });
  assert.equal((replies() as unknown[]).length, protocol.MAX_MESSAGES, "the list keeps the newest messages within the cap");
  firefox.set_pref(false);
  assert.equal(core.send("ping", { axis: "x" }).ok, false);
});

test("turning off for the session stops the storage listener and every other registration", () => {
  const { firefox } = messaging();
  const broken = firefox.make_window();
  broken.win.addEventListener = () => {
    throw new Error("no listeners here");
  };
  broken.load();
  assert.equal(firefox.Services.desertfox_browser_module, "off");
  assert.equal(firefox.extension!.listeners.size, 0);
  assert.equal(firefox.pref_observer_count(), 0);
  assert.equal(firefox.ready_listener_count(), 0);
  assert.equal(firefox.message_listener_count(), 0);
});

test("a core whose start fails halfway undoes what it registered", () => {
  const firefox = create_firefox({ patch_source: (name, source) => (name === CORE_FILE ? source.replace("listen(desertfox());", `throw new Error("halfway");`) : source) });
  firefox.start_extension();
  firefox.make_window().load();
  assert.equal(firefox.Services.desertfox_browser_module, "off");
  assert.equal(firefox.pref_observer_count(), 0);
  assert.equal(firefox.ready_listener_count(), 0);
  assert.equal(firefox.message_listener_count(), 0);
  firefox.set_pref(false);
  firefox.set_pref(true);
  assert.deepEqual(firefox.frame_scripts, []);
});

test("blur_on_load: a field the page focused on load gets a blur back, only with the setting on and only where the module takes keys", () => {
  const load_focus = { inner: 10, listeners: 0, field: true, load_focus: true };
  const blurs = (firefox: ReturnType<typeof create_firefox>) => firefox.sent_to_frames.filter(({ name }) => name === "desertfox-browser-module:blur").map(({ data }) => plain(data));
  const on = started({ written: state({ blur_on_load: true }) });
  on.firefox.report(on.browser, load_focus);
  assert.deepEqual(blurs(on.firefox), [{ inner: 10 }]);
  on.firefox.report(on.browser, { ...load_focus, load_focus: false });
  assert.equal(blurs(on.firefox).length, 1, "a focus the user gave stays");

  for (const [what, written, report] of [
    ["the setting off", state(), load_focus],
    ["DesertFox live", state({ blur_on_load: true }), { ...load_focus, listeners: 1 }],
    ["a tab in insert mode", state({ blur_on_load: true, tabs: { "1": { mode: "insert", live: false } } }), load_focus],
    ["the toolbar switch off", state({ blur_on_load: true, enabled: false }), load_focus],
  ] as const) {
    const { firefox, browser } = started({ written });
    firefox.report(browser, report);
    assert.deepEqual(blurs(firefox), [], what);
  }
});

test("the pref turned off forgets the reports, and turned on again asks every tab for a fresh one", () => {
  const { firefox, browser, press } = started();
  firefox.report(browser, { inner: 10, listeners: 1, field: false });
  assert.equal(press("J").prevented, false);
  firefox.set_pref(false);
  firefox.set_pref(true);
  assert.deepEqual(firefox.broadcasts, ["desertfox-browser-module:report-now"]);
  assert.equal(press("J").prevented, true, "a report from before the pref went off still counted");
});

test("a message over its kind's max_bytes is refused, and an answer over it becomes an error reply", async () => {
  const { send, replies, calls } = messaging();
  send([request("big", "sized", { message: "x".repeat(300) }), request("fits", "sized", { message: "y".repeat(50) }), request("small", "sized", { message: "z" })]);
  await settle();
  assert.deepEqual(calls(), []);
  assert.deepEqual(replies(), [
    { v: 1, reply_to: "big", ok: false, error: "a sized message is over its size limit" },
    { v: 1, reply_to: "fits", ok: false, error: "the answer is too large" },
    { v: 1, reply_to: "small", ok: true, value: "zzzzzzzzzz" },
  ]);
});

test("the real page_push kind with no feature to answer it gets an error reply", async () => {
  const firefox = create_firefox();
  firefox.start_extension();
  firefox.make_window().load();
  firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [request("p1", "page_push", { tab_id: 3, message: "{}" })]);
  await settle();
  assert.deepEqual(plain(firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY)), [{ v: 1, reply_to: "p1", ok: false, error: "no handler for this kind" }]);
  assert.ok(protocol.validate_message_list(plain(firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY)), protocol.MODULE_TO_EXTENSION_KINDS, Date.now()).ok);
});

test("a DesertFox reload while the pref is off gets no hello, and the pref turned on again says it", () => {
  const firefox = create_firefox();
  firefox.start_extension();
  firefox.make_window().load();
  firefox.set_pref(false);
  firefox.start_extension();
  assert.equal(firefox.hello(), undefined, "the module said its hello with the pref off");
  firefox.set_pref(true);
  assert.deepEqual(firefox.hello(), { v: BROWSER_MODULE_PROTOCOL_VERSION, module_version: "1.0.0" });
});

test("a handler's error text loses control and bidi characters", async () => {
  const { send, replies } = messaging();
  send([request("n", "noisy")]);
  await settle();
  assert.deepEqual(replies(), [{ v: 1, reply_to: "n", ok: false, error: "no splithere" }]);
});

test("the pane kinds take only their arg shapes, and with no feature to answer them they get an error reply", async () => {
  const firefox = create_firefox();
  firefox.start_extension();
  firefox.make_window().load();
  firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [
    request("r0", "pane.resize", { steps: 0 }),
    request("r9", "pane.resize", { steps: 21 }),
    request("f1", "pane.focus_region", { region: "toolbar" }),
    request("ok", "pane.focus_region", { region: "devtools" }),
  ]);
  await settle();
  const got = plain(firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY)) as { reply_to: string; error: string }[];
  assert.deepEqual(got.map(({ reply_to, error }) => [reply_to, error]), [
    ["r0", "pane.resize steps has the wrong shape"],
    ["r9", "pane.resize steps has the wrong shape"],
    ["f1", "pane.focus_region region has the wrong shape"],
    ["ok", "no handler for this kind"],
  ]);
});

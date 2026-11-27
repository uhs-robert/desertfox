import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_MODULE_PROTOCOL_VERSION, MODULE_COMMAND_ARGS } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_HELLO_STORAGE_KEY, BROWSER_MODULE_STATE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
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

test("the module's copy of the key names and the version equals src/shared", () => {
  const source = source_of(CORE_FILE);
  assert.equal(constant_in(source, "STATE_STORAGE_KEY"), JSON.stringify(BROWSER_MODULE_STATE_STORAGE_KEY));
  assert.equal(constant_in(source, "HELLO_STORAGE_KEY"), JSON.stringify(BROWSER_MODULE_HELLO_STORAGE_KEY));
  assert.equal(constant_in(source, "PROTOCOL_VERSION"), String(BROWSER_MODULE_PROTOCOL_VERSION));
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

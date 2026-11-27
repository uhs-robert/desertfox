import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_MODULE_PROTOCOL_VERSION, DEVTOOLS_TREE_KEYS } from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { create_firefox, key_event } from "./fake_firefox.ts";

const KEYS = [
  { key: "J", id: "tab.next", args: {} },
  { key: "j", id: "scroll.lines", args: { count: 10 } },
];
const state = (patch: Record<string, unknown> = {}) => ({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: KEYS, tabs: {}, ...patch });
const settle = () => new Promise((resolve) => setImmediate(resolve));
let pushes = 0;
const push_of = (keys: unknown, sent_at = Date.now()) => ({ v: BROWSER_MODULE_PROTOCOL_VERSION, id: `d${pushes++}`, kind: "devtools.keys", args: { keys }, sent_at });

// A browser window with a docked toolbox, the module on, the state written and, unless `table` is null, the tree keys pushed.
async function docked({ pref = true as boolean | null, written = state() as unknown, table = DEVTOOLS_TREE_KEYS as unknown } = {}) {
  const firefox = create_firefox({ pref });
  firefox.start_extension();
  const window = firefox.make_window();
  window.load();
  window.add_tab();
  if (written !== null) firefox.write_state(written);
  const push = async (keys: unknown) => {
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [push_of(keys)]);
    await settle();
  };
  if (table !== null) await push(table);
  const devtools = window.devtools_document();
  const tree = devtools.element("div");
  const press = (key: string, patch = {}, target: unknown = tree) => window.press(key_event(key, { target, originalTarget: target, ...patch }));
  return { firefox, window, devtools, tree, press, push };
}

test("j, k, h and l in docked DevTools become the arrow keys on the focused element, and the key stops there", async () => {
  const { window, devtools, press } = await docked();
  for (const key of ["j", "k", "h", "l"]) {
    const event = press(key);
    assert.ok(event.prevented && event.stopped, key);
  }
  assert.deepEqual(devtools.dispatched, [
    { type: "keydown", key: "ArrowDown", keyCode: 40, trusted: false },
    { type: "keydown", key: "ArrowUp", keyCode: 38, trusted: false },
    { type: "keydown", key: "ArrowLeft", keyCode: 37, trusted: false },
    { type: "keydown", key: "ArrowRight", keyCode: 39, trusted: false },
  ]);
  assert.deepEqual(window.tab_moves, []);
});

test("every other key in DevTools stays DevTools': a key row of the state, Escape, a letter with no row, a modifier, a shifted letter", async () => {
  const { window, devtools, press } = await docked();
  for (const [key, patch] of [["J", {}], ["Escape", {}], ["x", {}], ["s", {}], ["j", { ctrlKey: true }], ["k", { altKey: true }], ["l", { metaKey: true }], ["H", { shiftKey: true }], ["ArrowDown", {}]] as const) {
    assert.equal(press(key, patch).prevented, false, `${key} ${JSON.stringify(patch)}`);
  }
  assert.deepEqual(devtools.dispatched, []);
  assert.deepEqual(window.tab_moves, []);
});

test("a key typed in an editable field in DevTools types: an input, a textarea, editable text and a code editor", async () => {
  const { devtools, press } = await docked();
  for (const field of [devtools.element("input"), devtools.element("textarea"), devtools.element("div", { editable: true }), devtools.element("span", { in_code_editor: true })]) {
    assert.equal(press("j", {}, field).prevented, false, field.localName);
  }
  assert.deepEqual(devtools.dispatched, []);
});

test("a key for a frame of another process, such as an extension's DevTools panel, goes on to that frame", async () => {
  const { devtools, press } = await docked();
  for (const frame of [devtools.element("iframe"), devtools.element("browser")]) assert.equal(press("j", {}, frame).prevented, false, frame.localName);
  assert.deepEqual(devtools.dispatched, []);
});

test("with no table pushed, DevTools gets every key, as with an older extension", async () => {
  const { devtools, press } = await docked({ table: null });
  assert.equal(press("j").prevented, false);
  assert.deepEqual(devtools.dispatched, []);
});

test("the consent setting off (no state), the toolbar switch off or the pref off leave every key to DevTools", async () => {
  for (const setup of [{ written: null }, { written: state({ enabled: false, keys: [] }) }]) {
    const { devtools, press } = await docked(setup);
    assert.equal(press("j").prevented, false, JSON.stringify(setup));
    assert.deepEqual(devtools.dispatched, []);
  }
  const { firefox, devtools, press } = await docked();
  firefox.set_pref(false);
  assert.equal(press("j").prevented, false);
  assert.deepEqual(devtools.dispatched, []);
});

test("an untrusted key is never taken", async () => {
  const { devtools, press } = await docked();
  assert.equal(press("j", { isTrusted: false }).prevented, false);
  assert.deepEqual(devtools.dispatched, []);
});

// Chrome code makes the arrow, so Gecko marks it trusted (measured on Firefox 161), and it passes the core's key gate like a real arrow.
test("the arrow the module dispatched comes back trusted, and no row takes it: it moves the tree only once", async () => {
  const { devtools, press } = await docked();
  for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]) assert.equal(press(key, { isTrusted: true }).prevented, false, key);
  assert.deepEqual(devtools.dispatched, []);
});

test("a key in the browser UI is not in DevTools, so the table takes nothing there", async () => {
  const { window, devtools, press } = await docked();
  const urlbar = { localName: "input", ownerDocument: window.win.document };
  const button = { localName: "toolbarbutton", ownerDocument: window.win.document };
  for (const target of [urlbar, button]) assert.equal(press("j", {}, target).prevented, false);
  assert.deepEqual(devtools.dispatched, []);
});

test("a bad table is dropped and the last good one stays: a long key, Escape, a space, an action off the list, a repeated key, too many rows", async () => {
  const { devtools, press, push } = await docked();
  const bad_tables = [
    [{ key: "<C-p>", action: "tree.down" }],
    [{ key: "Escape", action: "tree.up" }],
    [{ key: " ", action: "tree.up" }],
    [{ key: "x", action: "click" }],
    [{ key: "x", action: "tree.down" }, { key: "x", action: "tree.up" }],
    Array.from({ length: 9 }, (_, index) => ({ key: String(index), action: "tree.down" })),
    [],
    "j=tree.down",
  ];
  for (const table of bad_tables) await push(table);
  assert.equal(press("x").prevented, false);
  assert.equal(press("j").prevented, true);
  await push([{ key: "n", action: "tree.down" }]);
  assert.equal(press("j").prevented, false, "the newest table replaces the old one");
  assert.equal(press("n").prevented, true);
  assert.deepEqual(
    devtools.dispatched.map(({ key }) => key),
    ["ArrowDown", "ArrowDown"],
  );
});

test("a push read late still sets the table: the default 2 s age limit is for keys, not for a table", async () => {
  const { firefox, press } = await docked({ table: null });
  firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [push_of(DEVTOOLS_TREE_KEYS, Date.now() - 60_000)]);
  await settle();
  assert.equal(press("j").prevented, true);
});

test("a reloaded or older DesertFox gets no table of the one before: the keys come back only with its own push", async () => {
  const { firefox, devtools, press, push } = await docked();
  assert.equal(press("j").prevented, true);
  firefox.start_extension();
  firefox.write_state(state());
  assert.equal(press("j").prevented, false, "a DesertFox that never pushes, such as an older one");
  await push(DEVTOOLS_TREE_KEYS);
  assert.equal(press("j").prevented, true);
  assert.deepEqual(devtools.dispatched.map(({ key }) => key), ["ArrowDown", "ArrowDown"]);
});

test("blur_on_load still reaches a browser window opened after a DevTools window, which has no tab browser", async () => {
  const firefox = create_firefox();
  firefox.start_extension();
  firefox.make_window().load();
  firefox.make_window({ devtools_window: true }).open();
  const later = firefox.make_window();
  later.load();
  const { browser } = later.add_tab();
  firefox.write_state(state({ blur_on_load: true }));
  firefox.report(browser, { inner: 10, listeners: 0, field: true, load_focus: true });
  assert.equal(firefox.sent_to_frames.filter(({ name }) => name === "desertfox-browser-module:blur").length, 1);
});

test("a DevTools window gets the keys once it loads, one open before the module started too, and loses them on close", async () => {
  const firefox = create_firefox();
  firefox.start_extension();
  const early = firefox.make_window({ devtools_window: true });
  early.open();
  firefox.make_window().load();
  firefox.write_state(state());
  firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [push_of(DEVTOOLS_TREE_KEYS)]);
  await settle();
  const later = firefox.make_window({ devtools_window: true });
  later.open();
  for (const window of [early, later]) {
    const devtools = window.devtools_document();
    const tree = devtools.element("div");
    const event = window.press(key_event("j", { target: tree, originalTarget: tree }));
    assert.ok(event.prevented, "j in a DevTools window");
    assert.equal(window.press(key_event("J", { target: tree, originalTarget: tree })).prevented, false, "J in a DevTools window");
    assert.deepEqual(devtools.dispatched.map(({ key }) => key), ["ArrowDown"]);
  }
  later.close();
  assert.equal(later.listener_count("keydown"), 0);
  assert.equal(early.listener_count("keydown"), 1);
});

test("a DevTools window still loading when the module starts gets the keys once it loads", async () => {
  const firefox = create_firefox();
  firefox.start_extension();
  const loading = firefox.make_window({ devtools_window: true });
  loading.open_while_loading();
  firefox.make_window().load();
  firefox.write_state(state());
  firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [push_of(DEVTOOLS_TREE_KEYS)]);
  await settle();
  loading.finish_loading();
  const devtools = loading.devtools_document();
  const tree = devtools.element("div");
  assert.ok(loading.press(key_event("j", { target: tree, originalTarget: tree })).prevented);
});

test("turning off for the session stops watching for DevTools windows", async () => {
  const firefox = create_firefox();
  firefox.start_extension();
  firefox.make_window().load();
  (firefox.Services.desertfox_browser_module as { shut_down(): void }).shut_down();
  const window = firefox.make_window({ devtools_window: true });
  window.open();
  assert.equal(window.listener_count("keydown"), 0);
});

test("an older core with no DevTools claim leaves the module on, logs one line and takes no key in DevTools", () => {
  const firefox = create_firefox({ patch_source: (name, source) => (name === "desertfox-browser.js" ? source.replace("claim_devtools_keys(fn) {", "claim_devtools_keys_gone(fn) {") : source) });
  firefox.start_extension();
  firefox.make_window().load();
  const core = firefox.Services.desertfox_browser_module as { status(): { active: boolean; errors: string[] } };
  assert.equal(core.status().active, true);
  assert.deepEqual(JSON.parse(JSON.stringify(core.status().errors)), ["the core cannot hand DevTools keys to a feature, so the DevTools feature stays off"]);
});

// The chrome hints feature (browser_module/desertfox-chrome-hints.js) against a small stand-in for a browser window's DOM. It drives the lifecycle: which window gets a session, what a draw shows, what a pick runs, and what each end takes away.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { create_firefox, IME_ENABLED, key_event, source_of } from "./fake_firefox.ts";
import { label_parts } from "../../src/background/chrome_hints.ts";
import { make_labels } from "../../src/shared/hints/labels.ts";
import { Node } from "./chrome_dom.ts";
import type { FakeEvent } from "./fake_firefox.ts";
import { box, button as chrome_button, chrome_window as plain_chrome_window, settle as settle_run, started as started_run } from "./chrome_windows.ts";

const FILE = "desertfox-chrome-hints.js";
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));

const TAB_STRIP_TAKE = "tab.tabbrowser-tab, toolbarbutton, .tab-group-label";
const button = (id: string, left: number, props: Partial<Node> = {}) => new Node("toolbarbutton", { id, box: { left, top: 10, width: 24, height: 24 }, ...props });

// A browser window: a nav bar with buttons, a tab strip with tabs, and an app menu panel that is closed until a test opens it.
function chrome_window(firefox: ReturnType<typeof create_firefox>, { buttons = 3, private_window = false, loaded = true } = {}) {
  const root = new Node("#root");
  const document_element = new Node("window");
  document_element.setAttribute("windowtype", "navigator:browser");
  root.append(document_element);
  const nav = new Node("toolbar", { id: "nav-bar" });
  const tabs_bar = new Node("toolbar", { id: "TabsToolbar" });
  // The vertical strip: empty until a test fills it, as Firefox keeps #TabsToolbar empty while it shows.
  const vertical_tabs = new Node("box", { id: "vertical-tabs" });
  document_element.append(nav, tabs_bar, vertical_tabs);
  nav.query.toolbarbutton = Array.from({ length: buttons }, (_, index) => button(`b${index}`, 10 + (index % 30) * 30, { box: { left: 10 + (index % 30) * 30, top: 100 + Math.floor(index / 30) * 30, width: 24, height: 24 } }));
  nav.append(...nav.query.toolbarbutton);
  const tab_list = [0, 1].map((index) => new Node("tab", { box: { left: 200 + index * 100, top: 50, width: 90, height: 30 } }));
  tabs_bar.query[TAB_STRIP_TAKE] = tab_list;
  tabs_bar.append(...tab_list);
  const view = new Node("panelview", { box: { left: 500, top: 60, width: 200, height: 300 } });
  const rows = [0, 1].map((index) => new Node("toolbarbutton", { id: `row${index}`, box: { left: 510, top: 70 + index * 30, width: 180, height: 24 } }));
  view.query["toolbarbutton, button"] = rows;
  view.append(...rows);
  view.setAttribute("visible", "true");
  // A view PanelMultiView keeps in the panel but does not show: it still passes checkVisibility.
  const other_view = new Node("panelview", { box: { left: 500, top: 60, width: 200, height: 300 } });
  other_view.query["toolbarbutton, button"] = [new Node("toolbarbutton", { id: "hidden-row", box: { left: 510, top: 70, width: 180, height: 24 } })];
  const panel = new Node("panel", { id: "appMenu-popup" });
  panel.query.panelview = [view, other_view];
  panel.append(view, other_view);
  // The walk tells a multi-view panel by this.
  Object.assign(panel, { querySelector: (selector: string) => (selector === "panelmultiview" ? new Node("panelmultiview") : null) });
  const downloads_view = new Node("panelview", { box: { left: 500, top: 60, width: 200, height: 300 } });
  downloads_view.setAttribute("visible", "true");
  downloads_view.query["richlistitem, toolbarbutton, button"] = [new Node("richlistitem", { id: "download-row", box: { left: 510, top: 70, width: 180, height: 24 } })];
  const downloads_panel = new Node("panel", { id: "downloadsPanel" });
  downloads_panel.query.panelview = [downloads_view];
  downloads_panel.append(downloads_view);
  document_element.append(panel, downloads_panel);
  const by_id: Record<string, Node> = { "nav-bar": nav, TabsToolbar: tabs_bar, "vertical-tabs": vertical_tabs, "appMenu-popup": panel, downloadsPanel: downloads_panel, "cmd:go": new Node("command"), "cmd:off": new Node("command", { attrs: new Map([["disabled", "true"]]) }) };
  const all_targets = () => [...nav.query.toolbarbutton!, ...tab_list, ...rows, ...(vertical_tabs.query[TAB_STRIP_TAKE] ?? [])];
  let focused: Node | undefined;
  const document = {
    readyState: loaded ? "complete" : "uninitialized",
    documentElement: document_element,
    commandDispatcher: {
      get focusedElement() {
        return focused;
      },
    },
    createElementNS: (_ns: string, name: string) => new Node(name),
    getElementById: (id: string) => by_id[id] ?? null,
    querySelectorAll: (selector: string) => (selector.startsWith("#") ? (by_id[selector.slice(1)] ? [by_id[selector.slice(1)]] : []) : (document_element.query[selector] ?? [])),
    // The hit test finds a target whose box holds the point. A test hides one by making it `covered`.
    elementFromPoint: (x: number, y: number) => all_targets().find((node) => !node.attrs.has("covered") && x >= node.box.left && x <= node.box.left + node.box.width && y >= node.box.top && y <= node.box.top + node.box.height) ?? null,
  };
  for (const target of all_targets()) target.ownerDocument = document;
  const window_view: { CSSStyleSheet?: unknown } = {};
  Object.assign(document, { defaultView: window_view });
  window_view.CSSStyleSheet = class {
    text = "";
    replaceSync(text: string) {
      this.text = text;
    }
  };
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const window_root = new Node("#windowroot");
  const win = Object.assign(new Node("#window"), {
    document,
    innerWidth: 1200,
    innerHeight: 800,
    closed: false,
    private_window,
    windowRoot: window_root,
    windowUtils: { IMEStatus: 0 },
    location: { href: loaded ? "chrome://browser/content/browser.xhtml" : "about:blank" },
    gBrowser: { selectedTab: tab_list[0] },
    setTimeout: (run: () => void, ms: number) => timers.push({ run, ms, live: true }) - 1,
    clearTimeout: (handle: number) => void (timers[handle] && (timers[handle]!.live = false)),
  });
  const id = firefox.windows_by_id.size + 1;
  firefox.windows_by_id.set(id, win);
  const press = (key: string, patch: Partial<FakeEvent> = {}) => window_root.fire("keydown", key_event(key, patch));
  const layers = () => [document_element, view].flatMap((parent) => parent.children.filter((child) => child.className === "desertfox-chrome-hints"));
  const labels = () => layers().flatMap((host) => host.shadow!.children.find((child) => child.className === "desertfox-hints")!.children.map((node) => ({ text: node.textContent, typed: node.children[0]!.textContent, left: node.style.left, top: node.style.top, position: node.style.position ?? "" })));
  const fire_timers = () => timers.filter((timer) => timer.live).forEach((timer) => ((timer.live = false), timer.run()));
  const open_panel = () => (panel.state = "open");
  // The feature's own listeners while no session runs: the key listener on the window root, and the deactivate and unload listeners of the window.
  const session_listeners = () => window_root.listener_total() + win.listener_total() - 3;
  const focus = (node: Node | undefined) => (focused = node);
  const finish_load = () => {
    win.location.href = "chrome://browser/content/browser.xhtml";
    document.readyState = "complete";
    win.fire("load");
  };
  return { session_listeners, id, win, nav, tab_list, vertical_tabs, tabs_bar, rows, panel, downloads_panel, view, press, layers, labels, fire_timers, timers, window_root, document_element, focus, finish_load };
}

function started({ pref = true as boolean | null, private_access = false, buttons = 3, private_window = false } = {}) {
  const firefox = create_firefox({ pref, extra_files: { [FILE]: source_of(FILE) } });
  const extension = firefox.start_extension({ private_access });
  Object.assign(extension, { baseURI: { resolve: (path: string) => `moz-extension://uuid/${path}` } });
  firefox.write_state({ v: 1, enabled: true, keys: [], tabs: {} });
  const chrome = chrome_window(firefox, { buttons, private_window });
  const watchers = new Set<{ observe(subject: unknown, topic: string): void }>();
  Object.assign(firefox.Services, {
    ww: { registerNotification: (watcher: never) => watchers.add(watcher), unregisterNotification: (watcher: never) => watchers.delete(watcher) },
    wm: { getEnumerator: () => [chrome.win] },
  });
  firefox.make_window().load();
  (firefox.Services.focus as { activeWindow: unknown }).activeWindow = chrome.win;
  let sent = 0;
  const send = (kind: string, args: Record<string, unknown>) => {
    const id = `r${sent++}`;
    const list = (plain(firefox.read_holder(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY) ?? []) as unknown[]).slice(-10);
    firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [...list, { v: 1, id, kind, args, sent_at: Date.now() }]);
    return id;
  };
  const from_module = () => plain(firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY) ?? []) as { kind?: string; args?: Record<string, unknown>; reply_to?: string; ok?: boolean; error?: string }[];
  const reply = (id: string) => from_module().find((message) => message.reply_to === id);
  const pushes = (kind: string) => from_module().filter((message) => message.kind === kind).map((message) => message.args!);
  const target_ids = (): number[] => pushes("chrome_hints.targets").flatMap((args) => (JSON.parse(args.targets as string) as number[][]).map(([id]) => id!));
  const collect = async (session = 1, window_id = chrome.id, colors = "") => {
    const id = send("chrome_hints.collect", { session, window_id, colors });
    await settle();
    return reply(id);
  };
  const draw = async (session: number, gen: number, rows: [number, string][], { part = 0, parts = 1, typed = "" } = {}) => {
    send("chrome_hints.draw", { session, gen, part, parts, typed, labels: JSON.stringify(rows) });
    await settle();
  };
  const pick = async (session: number, id: number) => {
    const request = send("chrome_hints.pick", { session, id });
    await settle();
    return reply(request);
  };
  const held = () => (firefox.Services.desertfox_browser_module as { keys_held_by(win: unknown): unknown }).keys_held_by(chrome.win);
  return { firefox, chrome, send, from_module, reply, pushes, target_ids, collect, draw, pick, held };
}

test("the module's kind rows are the protocol's, so a collect is answered and its targets pass the extension's check", async () => {
  const { collect, from_module } = started();
  assert.deepEqual(await collect(), { v: 1, reply_to: "r0", ok: true });
  assert.ok(protocol.validate_message_list(from_module(), protocol.MODULE_TO_EXTENSION_KINDS, Date.now()).ok);
});

test("a collect sends each target's id and box, ids count up across sessions, and the layer goes in a closed shadow root with no sheet of the extension's", async () => {
  const { collect, pushes, chrome, target_ids } = started();
  await collect(1);
  const [part] = pushes("chrome_hints.targets");
  assert.deepEqual({ ...part, targets: undefined }, { session: 1, part: 0, parts: 1, targets: undefined });
  const rows = JSON.parse(part!.targets as string) as number[][];
  assert.deepEqual(rows.map((row) => row.slice(1)), [[10, 100, 24, 24], [40, 100, 24, 24], [70, 100, 24, 24], [200, 50, 90, 30], [300, 50, 90, 30]]);
  const [host] = chrome.layers();
  assert.deepEqual(host!.shadow!.children.map((child) => child.localName), ["div"], "the layer took a sheet or link of the extension's");
  assert.equal(host!.style.cssText!.includes("pointer-events: none"), true);
  const first_ids = target_ids();
  await collect(2);
  const second_ids = target_ids().slice(first_ids.length);
  assert.ok(Math.min(...second_ids) > Math.max(...first_ids), "a newer session reused an older session's ids");
  assert.equal(chrome.layers().length, 1, "the older session's layer is left");
});

test("window and panel labels carry their look inline, so no sheet of the extension's can restyle them or the layer", async () => {
  const { collect, draw, chrome, target_ids } = started();
  await collect(1, chrome.id, JSON.stringify({ dark: { primary: "#ff0000", bg_core: "url(x)" }, light: {} }));
  await draw(1, 1, target_ids().map((id, index) => [id, "asdfg"[index]!]));
  const [host] = chrome.layers();
  assert.equal(host!.shadow!.descendants().some((node) => node.localName === "link" || node.localName === "style"), false, "the layer loads a sheet");
  const [label] = host!.shadow!.children[0]!.children;
  assert.match(label!.style.cssText!, /background: var\(--desertfox-primary, #7fa3c9\)/);
  assert.match(label!.style.cssText!, /position: fixed/);
  const theme = (host!.shadow as unknown as { adoptedStyleSheets: { text: string }[] }).adoptedStyleSheets[0]!.text;
  assert.ok(theme.includes("--desertfox-primary: #ff0000;") && !theme.includes("url(x)"), theme);
});

test("a collect is refused for a window that is not in front, a private window without access, an open menu, nothing to hint and the pref off", async () => {
  const run = started();
  (run.firefox.Services.focus as { activeWindow: unknown }).activeWindow = {};
  assert.equal((await run.collect())?.error, "The window is not in front");
  assert.equal((await run.collect(1, 999))?.error, "The window is gone");

  const in_private = started({ private_window: true });
  assert.equal((await in_private.collect())?.error, "DesertFox cannot run in this window");

  const menu = started();
  menu.chrome.document_element.query.menupopup = [new Node("menupopup", { state: "open" })];
  assert.equal((await menu.collect())?.error, "Close the menu first");

  const empty = started({ buttons: 0 });
  empty.chrome.tab_list.forEach((tab) => (tab.visible = false));
  assert.equal((await empty.collect())?.error, "Nothing to hint here");
  assert.equal(empty.chrome.layers().length, 0);
  assert.equal(empty.chrome.session_listeners(), 0);
});

test("a covered target, a hidden one, a disabled one and one outside the window get no label", async () => {
  const { collect, chrome, target_ids } = started({ buttons: 5 });
  const [covered, hidden, disabled, outside] = chrome.nav.query.toolbarbutton!;
  covered!.setAttribute("covered", "");
  hidden!.visible = false;
  disabled!.setAttribute("disabled", "true");
  outside!.box = { left: 1300, top: 100, width: 24, height: 24 };
  await collect();
  assert.equal(target_ids().length, 3, "only the fifth button and the two tabs are targets");
});

test("a draw shows only once all its parts came, a part of an older draw and bad rows are dropped, and a lost part leaves the labels before it", async () => {
  const { collect, draw, chrome, target_ids } = started();
  await collect(1);
  const [a, b, c] = target_ids();
  await draw(1, 1, [[a!, "a"]], { parts: 2 });
  assert.deepEqual(chrome.labels(), [], "half a draw showed");
  await draw(1, 1, [[b!, "s"], [c!, "d"]], { part: 1, parts: 2 });
  assert.deepEqual(chrome.labels().map((label) => label.text), ["a", "s", "d"]);
  assert.deepEqual(chrome.labels()[0], { text: "a", typed: "", left: "10px", top: "100px", position: "" });
  // gen 2 loses its second part: the labels of gen 1 stay.
  await draw(1, 2, [[a!, "a"]], { parts: 2 });
  assert.deepEqual(chrome.labels().map((label) => label.text), ["a", "s", "d"]);
  await draw(1, 3, [[b!, "sd"]], { typed: "s" });
  assert.deepEqual(chrome.labels(), [{ text: "sd", typed: "s", left: "40px", top: "100px", position: "" }]);
  await draw(1, 2, [[a!, "a"]], { part: 1, parts: 2 });
  assert.deepEqual(chrome.labels().map((label) => label.text), ["sd"], "a late part of an older draw showed");
  for (const bad of [[[999999, "a"]], [[a!, "a b"]], [[a!, "a/"]], [[a!, "abcdefghij"]], [[a!]], [[a!, 5]]] as never[]) await draw(1, 9, bad);
  await draw(2, 10, [[a!, "a"]]);
  assert.deepEqual(chrome.labels().map((label) => label.text), ["sd"], "a bad row or another session's draw showed");
});

test("keys before the first draw wait, then go out in order; Escape ends the session in chrome and tells the extension", async () => {
  const { collect, draw, chrome, pushes, target_ids, held } = started();
  await collect(1);
  assert.equal(held(), "chrome_hints", "a session does not hold the window's keys");
  const early = chrome.press("s");
  assert.ok(early.prevented && early.stopped, "a key of the session reached the page");
  assert.deepEqual(pushes("chrome_hints.key"), []);
  await draw(1, 1, target_ids().map((id, index) => [id, "asdfg"[index]!]));
  assert.deepEqual(pushes("chrome_hints.key"), [{ session: 1, seq: 1, key: "s" }]);
  chrome.press("Backspace");
  assert.ok(!chrome.press("ArrowDown").prevented, "an arrow was taken from the page");
  chrome.press("Shift");
  assert.deepEqual(pushes("chrome_hints.key").map((args) => args.key), ["s", "Backspace"]);
  const escape = chrome.press("Escape");
  assert.ok(escape.prevented, "Escape reached the page");
  assert.deepEqual(pushes("chrome_hints.end"), [{ session: 1 }]);
  assert.equal(chrome.layers().length, 0);
  assert.equal(chrome.session_listeners(), 0, "a listener outlived the session");
  assert.ok(chrome.timers.every((timer) => !timer.live), "the first draw timer outlived the session");
  assert.equal(held(), undefined, "Escape left the window's keys held");
  const after = chrome.press("j");
  assert.ok(!after.prevented, "a key after the end was taken");
});

test("a key with Ctrl, a click, the window leaving the front, a resize and the window closing each end the session", async () => {
  for (const end of ["ctrl", "mousedown", "deactivate", "resize", "unload"]) {
    const { collect, chrome, pushes, held } = started();
    await collect(1);
    if (end === "ctrl") assert.ok(!chrome.press("w", { ctrlKey: true }).prevented, "Ctrl+W was taken");
    else chrome.win.fire(end);
    assert.deepEqual(pushes("chrome_hints.end"), [{ session: 1 }], end);
    assert.equal(chrome.layers().length, 0, end);
    assert.equal(end === "unload" ? chrome.session_listeners() + 3 : chrome.session_listeners(), 0, end);
    assert.equal(held(), undefined, end);
  }
});

test("no first draw within its time ends the session, and the pref off ends it with nothing left", async () => {
  const late = started();
  await late.collect(1);
  late.chrome.fire_timers();
  assert.deepEqual(late.pushes("chrome_hints.end"), [{ session: 1 }]);
  assert.equal(late.chrome.layers().length, 0);
  assert.equal(late.held(), undefined);

  const off = started();
  await off.collect(1);
  off.firefox.set_pref(false);
  assert.equal(off.chrome.layers().length, 0);
  assert.equal(off.chrome.session_listeners(), 0);
  assert.equal(off.held(), undefined);
});

test("a pick runs the target's fixed action once, and refuses another session, an unknown id, an undrawn target, a gone one and a moved one", async () => {
  const { collect, draw, pick, chrome, target_ids, held } = started();
  await collect(1);
  let ids = target_ids();
  await draw(1, 1, ids.slice(0, 4).map((id, index) => [id, "asdf"[index]!]));
  assert.equal((await pick(2, ids[0]!))?.error, "The hints have ended");
  assert.equal((await pick(1, 999999))?.error, "No such hint");
  assert.equal(chrome.layers().length, 1, "a refused id ended the session");
  assert.equal((await pick(1, ids[4]!))?.error, "No such hint", "a target with no label was picked");
  assert.equal(chrome.layers().length, 1, "a refused id ended the session");
  assert.equal((await pick(1, ids[3]!))?.ok, true);
  assert.equal(chrome.layers().length, 0, "the session outlived a pick");
  assert.equal(held(), undefined, "a pick left the window's keys held");
  assert.equal((await pick(1, ids[0]!))?.error, "The hints have ended", "a second pick of the session ran");
  assert.equal(chrome.nav.query.toolbarbutton![0]!.clicks, 0);
  assert.equal(chrome.win.gBrowser.selectedTab, chrome.tab_list[0]);

  await collect(3);
  ids = target_ids().slice(-5);
  await draw(3, 1, ids.map((id, index) => [id, "asdfg"[index]!]));
  chrome.nav.query.toolbarbutton![1]!.box = { left: 44, top: 100, width: 24, height: 24 };
  assert.equal((await pick(3, ids[1]!))?.error, "The hint's target moved");
  assert.equal(chrome.nav.query.toolbarbutton![1]!.clicks, 0);

  await collect(4);
  ids = target_ids().slice(-5);
  await draw(4, 1, ids.map((id, index) => [id, "asdfg"[index]!]));
  chrome.nav.query.toolbarbutton![2]!.remove();
  assert.equal((await pick(4, ids[2]!))?.error, "The hint's target is gone");
  chrome.nav.query.toolbarbutton!.splice(2, 1);

  await collect(5);
  ids = target_ids().slice(-4);
  await draw(5, 1, ids.map((id, index) => [id, "asdf"[index]!]));
  assert.equal((await pick(5, ids[0]!))?.ok, true);
  assert.equal(chrome.nav.query.toolbarbutton![0]!.clicks, 1);
  await collect(6);
  ids = target_ids().slice(-4);
  await draw(6, 1, ids.map((id, index) => [id, "asdf"[index]!]));
  assert.equal((await pick(6, ids.at(-1)!))?.ok, true);
  assert.equal(chrome.win.gBrowser.selectedTab, chrome.tab_list[1], "a tab pick did not select the tab");
  assert.equal(chrome.tab_list[1]!.clicks, 0);
});

test("with vertical tabs the strip's tabs and tab group labels get labels, and a pick selects the tab or clicks the label", async () => {
  const { collect, draw, pick, chrome, target_ids } = started({ buttons: 0 });
  // Firefox empties #TabsToolbar while the strip is vertical.
  chrome.tabs_bar.query[TAB_STRIP_TAKE] = [];
  const strip_tab = new Node("tab", { box: { left: 10, top: 200, width: 120, height: 30 } });
  const group_label = new Node("label", { box: { left: 10, top: 240, width: 120, height: 24 } });
  group_label.className = "tab-group-label";
  const grouped_tab = new Node("tab", { box: { left: 20, top: 270, width: 110, height: 30 } });
  const in_strip = [strip_tab, group_label, grouped_tab];
  chrome.vertical_tabs.query[TAB_STRIP_TAKE] = in_strip;
  chrome.vertical_tabs.append(...in_strip);
  for (const node of in_strip) node.ownerDocument = chrome.win.document;
  await collect(1);
  const ids = target_ids();
  assert.equal(ids.length, 3, "the vertical strip's tabs and group label were not all labelled");
  await draw(1, 1, ids.map((id, index) => [id, "asd"[index]!]));
  assert.equal((await pick(1, ids[0]!))?.ok, true);
  assert.equal(chrome.win.gBrowser.selectedTab, strip_tab, "a vertical tab pick did not select the tab");

  await collect(2);
  const again = target_ids().slice(-3);
  await draw(2, 1, again.map((id, index) => [id, "asd"[index]!]));
  assert.equal((await pick(2, again[1]!))?.ok, true);
  assert.equal(group_label.clicks, 1, "a group label pick did not click the label");
  assert.equal(chrome.win.gBrowser.selectedTab, strip_tab, "a group label pick selected a tab");
});

test("a tab group label in the horizontal strip gets a label and its pick clicks it", async () => {
  const { collect, draw, pick, chrome, target_ids } = started({ buttons: 0 });
  const group_label = new Node("label", { box: { left: 400, top: 50, width: 60, height: 24 } });
  group_label.className = "tab-group-label";
  group_label.ownerDocument = chrome.win.document;
  chrome.tab_list.push(group_label);
  chrome.tabs_bar.append(group_label);
  await collect(1);
  const ids = target_ids();
  assert.equal(ids.length, 3);
  await draw(1, 1, ids.map((id, index) => [id, "asd"[index]!]));
  assert.equal((await pick(1, ids[2]!))?.ok, true);
  assert.equal(group_label.clicks, 1);
});

test("with the app menu open the rows of its shown view are the targets, and their labels sit inside the panel", async () => {
  const { collect, draw, chrome, target_ids, pushes } = started();
  chrome.panel.state = "open";
  await collect(1);
  const ids = target_ids();
  assert.equal(ids.length, 2, "the toolbar buttons were collected with the panel open");
  const panel_host = chrome.view.children[0]!;
  assert.equal(panel_host.className, "desertfox-chrome-hints");
  Object.assign(panel_host, { box: { left: 500, top: 60, width: 0, height: 0 } });
  await draw(1, 1, [[ids[0]!, "a"], [ids[1]!, "s"]]);
  assert.deepEqual(chrome.labels(), [
    { text: "a", typed: "", left: "10px", top: "10px", position: "absolute" },
    { text: "s", typed: "", left: "10px", top: "40px", position: "absolute" },
  ]);
  chrome.panel.fire("popuphidden", { target: chrome.panel } as never);
  assert.deepEqual(pushes("chrome_hints.end"), [{ session: 1 }]);
  assert.equal(chrome.layers().length, 0);
  assert.equal(chrome.panel.listener_total(), 0);
});

test("many targets go out in ordered parts that each fit the kind's limit", async () => {
  const { collect, pushes, from_module } = started({ buttons: 300 });
  await collect(1);
  const parts = pushes("chrome_hints.targets");
  assert.ok(parts.length > 1, "300 targets fit one part, so batching is not tested");
  assert.ok(parts.length <= 6, "the parts crowd the from-module list");
  assert.deepEqual(parts.map((args) => args.part), parts.map((_, index) => index));
  assert.ok(parts.every((args) => args.parts === parts.length));
  assert.equal(parts.flatMap((args) => JSON.parse(args.targets as string)).length, 302);
  const checked = protocol.validate_message_list(from_module(), protocol.MODULE_TO_EXTENSION_KINDS, Date.now());
  assert.ok(checked.ok && checked.value.messages.length === parts.length + 1, "a part failed the extension's check");
});

test("a button that runs a <command> follows the command's state, not its own stale `disabled`, and a pick runs the command", async () => {
  const { collect, draw, pick, chrome, target_ids } = started({ buttons: 2 });
  const [runs, off] = chrome.nav.query.toolbarbutton!;
  runs!.setAttribute("command", "cmd:go");
  runs!.setAttribute("disabled", "");
  runs!.disabled = true;
  off!.setAttribute("command", "cmd:off");
  await collect(1);
  const ids = target_ids();
  assert.equal(ids.length, 3, "the button of a disabled command was collected, or the one with a stale disabled was not");
  await draw(1, 1, [[ids[0]!, "a"]]);
  assert.equal((await pick(1, ids[0]!))?.ok, true);
  assert.deepEqual([runs!.commands, runs!.clicks], [1, 0]);
});

test("the session's key listener runs before a listener a later feature adds on the window root, and the module shutting down takes every listener away", async () => {
  const { firefox, collect, chrome, held } = started();
  const later: boolean[] = [];
  chrome.window_root.addEventListener("keydown", (event) => void later.push(event.prevented));
  await collect(1);
  chrome.press("j");
  assert.deepEqual(later, [], "a later listener heard the session's key");
  (firefox.Services.desertfox_browser_module as { shut_down(): void }).shut_down();
  assert.equal(chrome.layers().length, 0);
  assert.equal(held(), undefined, "the module shut down with the window's keys held");
  assert.equal(chrome.window_root.listener_total(), 1, "the feature's window root listener outlived the module");
  assert.equal(chrome.win.listener_total(), 0);
});

test("a whole draw with no labels ends the session, so it never holds the keys with nothing shown", async () => {
  const { collect, draw, chrome, pushes, held } = started();
  await collect(1);
  await draw(1, 1, []);
  assert.deepEqual(pushes("chrome_hints.end"), [{ session: 1 }]);
  assert.equal(chrome.layers().length, 0);
  assert.equal(held(), undefined);
  assert.ok(!chrome.press("a").prevented, "a key after an empty draw was taken");
});

test("a collect is refused while another feature holds the window's keys, and that hold stays", async () => {
  const { firefox, collect, chrome, held } = started();
  const core = firefox.Services.desertfox_browser_module as { hold_keys(win: unknown, owner: string): boolean };
  assert.equal(core.hold_keys(chrome.win, "sidebar"), true);
  assert.notEqual((await collect(1))?.ok, true);
  assert.equal(chrome.layers().length, 0);
  assert.equal(held(), "sidebar");
  assert.equal(chrome.press("a").prevented, false, "a session that never started took a key");
});

test("a collect is refused while a field of the window has the focus, such as the address bar", async () => {
  const { collect, chrome, held } = started();
  chrome.focus(new Node("input", { id: "urlbar-input" }));
  assert.equal((await collect(1))?.error, "Leave the field first");
  assert.equal(chrome.layers().length, 0);
  assert.equal(held(), undefined);
  chrome.focus(new Node("browser", { isRemoteBrowser: true } as never));
  assert.equal((await collect(2))?.ok, true, "a collect with the focus in a page was refused");
});

test("a collect is refused while a field of a page in another process has the focus, as the window's input state says", async () => {
  const { collect, chrome, held } = started();
  chrome.focus(new Node("browser", { isRemoteBrowser: true } as never));
  chrome.win.windowUtils.IMEStatus = IME_ENABLED;
  assert.equal((await collect(1))?.error, "Leave the field first");
  assert.equal(chrome.layers().length, 0);
  assert.equal(held(), undefined);
});

test("a session whose start throws takes back its hold and what it added, so the window's letters stay free", async () => {
  const { collect, chrome, held } = started();
  chrome.document_element.append = () => {
    throw new Error("the DOM changed");
  };
  assert.equal((await collect(1))?.ok, false);
  assert.equal(held(), undefined, "a failed start left the window's keys held");
  assert.ok(!chrome.press("a").prevented, "a failed start swallowed a letter");
  assert.equal(chrome.session_listeners(), 0);
});

test("a key after DesertFox stops acting in the window ends the session and goes on to the page", async () => {
  const { firefox, collect, draw, chrome, target_ids, pushes, held } = started();
  await collect(1);
  await draw(1, 1, target_ids().map((id, index) => [id, "asdfg"[index]!]));
  firefox.write_state({ v: 1, enabled: false, keys: [], tabs: {} });
  assert.ok(!chrome.press("a").prevented, "a key was taken with the toolbar switch off");
  assert.deepEqual(pushes("chrome_hints.key"), []);
  assert.equal(chrome.layers().length, 0);
  assert.equal(held(), undefined);
});

test("a request alone labels nothing while the downloads panel is open, since a pick there opens a file", async () => {
  const { collect, chrome, target_ids, held } = started();
  chrome.downloads_panel.state = "open";
  assert.equal((await collect(1))?.error, "Type the hint key in the panel");
  assert.equal(target_ids().length, 0);
  assert.equal(chrome.downloads_panel.children[0]!.children.length, 0, "a layer went into the downloads panel");
  assert.equal(held(), undefined);
});

test("labels of any hint letters the settings allow show, up to 400 targets with two letters", async () => {
  const { collect, chrome, target_ids, send } = started({ buttons: 398 });
  await collect(1);
  const ids = target_ids();
  assert.equal(ids.length, 400);
  const labels = make_labels(ids.length, [",", "."]);
  assert.equal(Math.max(...labels.map((label) => label.length)), 9);
  const parts = label_parts(ids.map((id, index) => [id, labels[index]!]));
  // One message at a time, as the module reads each draw part off the list.
  for (const [part, rows] of parts.entries()) {
    send("chrome_hints.draw", { session: 1, gen: 1, part, parts: parts.length, typed: "", labels: JSON.stringify(rows) });
    await settle();
  }
  assert.equal(chrome.labels().length, 400);
  assert.equal(chrome.labels()[0]!.text, labels[0]);
});

test("in a window opened after startup the popup walk, whose watcher Firefox calls first, leaves a session's j to the labels", async () => {
  const firefox = create_firefox({ extra_files: { [FILE]: source_of(FILE), "desertfox-popup-walk.js": source_of("desertfox-popup-walk.js") } });
  const extension = firefox.start_extension();
  Object.assign(extension, { baseURI: { resolve: (path: string) => `moz-extension://uuid/${path}` } });
  firefox.write_state({ v: 1, enabled: true, keys: [], tabs: {} });
  // Firefox's observer list calls the newest observer first, so the later feature file hears a new window first.
  const watchers: { observe(subject: unknown, topic: string): void }[] = [];
  const typed: string[] = [];
  Object.assign(firefox.Services, {
    ww: { registerNotification: (watcher: never) => watchers.unshift(watcher), unregisterNotification: (watcher: never) => watchers.splice(watchers.indexOf(watcher), 1) },
    wm: { getEnumerator: () => [] },
  });
  firefox.Components.interfaces.nsITextInputProcessor = {};
  firefox.Components.classes["@mozilla.org/text-input-processor;1"] = {
    createInstance: () => ({ beginInputTransaction: () => true, keydown: (event: { key: string }) => typed.push(event.key), keyup: () => undefined }),
  };
  firefox.make_window().load();
  const chrome = chrome_window(firefox, { loaded: false });
  Object.assign(chrome.win, { KeyboardEvent: class { key: string; constructor(_type: string, init: { key: string }) { this.key = init.key; } } });
  for (const watcher of [...watchers]) watcher.observe(chrome.win, "domwindowopened");
  chrome.finish_load();
  (firefox.Services.focus as { activeWindow: unknown }).activeWindow = chrome.win;
  chrome.panel.state = "open";
  chrome.win.fire("popupshown", { originalTarget: chrome.panel } as never);
  const without_session = chrome.press("j");
  chrome.fire_timers();
  assert.ok(without_session.prevented && typed.join() === "ArrowDown", "the walk is not attached to the new window, so the test proves nothing");

  const sent = [{ v: 1, id: "r0", kind: "chrome_hints.collect", args: { session: 1, window_id: chrome.id, colors: "" }, sent_at: Date.now() }];
  firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, sent);
  await settle();
  const ids = (plain(firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY)) as { kind?: string; args?: { targets: string } }[])
    .filter((message) => message.kind === "chrome_hints.targets")
    .flatMap((message) => (JSON.parse(message.args!.targets) as number[][]).map(([id]) => id!));
  firefox.extension_writes(BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, [...sent, { v: 1, id: "r1", kind: "chrome_hints.draw", args: { session: 1, gen: 1, part: 0, parts: 1, typed: "", labels: JSON.stringify(ids.map((id, index) => [id, ["j", "k"][index]!])) }, sent_at: Date.now() }]);
  await settle();
  assert.equal(chrome.labels().length, 2);
  chrome.press("j");
  chrome.fire_timers();
  assert.deepEqual(typed, ["ArrowDown"], "the walk moved the menu on a session's j");
  const keys = (plain(firefox.read_holder(BROWSER_MODULE_FROM_MODULE_STORAGE_KEY)) as { kind?: string; args?: { key: string } }[]).filter((message) => message.kind === "chrome_hints.key");
  assert.deepEqual(keys.map((message) => message.args!.key), ["j"]);
});

// ---- Notification bars.

// A browser window with the page focused and one notification bar under the toolbar: its buttons and a link in the light DOM, its close button in the shadow root, as Firefox builds one.
function window_with_bar(value: string, { buttons = 1, shown = true } = {}) {
  const run = started_run((firefox) => {
    const page = new Node("browser", { box: box(0, 120, 1200, 600) });
    const bar = new Node("notification-message", { box: box(0, 60, 1200, 40), visible: shown });
    bar.setAttribute("value", value);
    const actions = Array.from({ length: buttons }, (_, index) => new Node("button", { className: "notification-button", box: box(300 + index * 100, 66) }));
    const link = new Node("label", { className: "text-link notification-link", box: box(200, 66, 80, 20) });
    const close = new Node("moz-button", { className: "close", box: box(1150, 66, 24, 24) });
    const shadow = new Node("#shadow");
    shadow.append(close);
    bar.openOrClosedShadowRoot = shadow;
    shadow.host = bar;
    bar.append(link, ...actions);
    const nav = new Node("toolbar", { id: "nav-bar" });
    const reload = chrome_button("reload-button", 10);
    nav.append(reload);
    const window = plain_chrome_window(firefox, "navigator:browser", (root) => root.append(nav, bar, page));
    window.focus(page);
    return Object.assign(window, { bar, actions, link, close, reload });
  });
  return { run, chrome: run.chrome as unknown as ReturnType<typeof plain_chrome_window> & { bar: Node; actions: Node[]; link: Node; close: Node; reload: Node } };
}

// The extension's own start, as gB typed in the page sends it. `typed: false` has no key of the user's behind it.
async function bar_collect(run: ReturnType<typeof window_with_bar>["run"], { typed = true } = {}) {
  if (typed) run.type_binding();
  const id = run.send("chrome_hints.collect", { session: 1, window_id: run.chrome.id, colors: "" });
  await settle_run();
  return run.reply(id);
}

const labelled_boxes = (run: ReturnType<typeof window_with_bar>["run"]) => run.target_rows().map(([, left, top]) => `${left},${top}`);
const at = (node: Node) => `${Math.round(node.box.left)},${Math.round(node.box.top)}`;

async function label_all(run: ReturnType<typeof window_with_bar>["run"]) {
  const rows = run.target_rows();
  await run.draw(1, rows.map(([id], index) => [id!, `a${String.fromCharCode(97 + index)}`]));
  return (node: Node) => run.pick(1, rows.find(([, left, top]) => `${left},${top}` === at(node))![0]!);
}

test("the popup-blocked bar's Options button waits for Enter like any bar button, and its close button and link click at once", async () => {
  const { run, chrome } = window_with_bar("popup-blocked");
  assert.equal((await bar_collect(run, { typed: false }))?.ok, true);
  const seen = labelled_boxes(run);
  assert.equal(seen.includes(at(chrome.actions[0]!)), false, "an unkeyed collect labelled Options");
  for (const node of [chrome.link, chrome.close]) assert.ok(seen.includes(at(node)), `no label on ${node.className}`);
  assert.equal(seen.filter((place) => place === at(chrome.close)).length, 1, "the close button got more than one label");
  const keyed = window_with_bar("popup-blocked");
  assert.equal((await bar_collect(keyed.run))?.ok, true);
  const pick = await label_all(keyed.run);
  assert.equal((await pick(keyed.chrome.actions[0]!))?.ok, true);
  assert.equal(keyed.chrome.actions[0]!.clicks, 0, "a pick opened the Options menu with no Enter");
  keyed.chrome.clock.now += 500;
  keyed.chrome.press("Enter");
  assert.equal(keyed.chrome.actions[0]!.clicks, 1);
});

test("an unknown bar's button is left bare by a plain collect, and the rest of the window still gets labels", async () => {
  const { run, chrome } = window_with_bar("some-future-bar");
  const reply = await bar_collect(run, { typed: false });
  assert.equal(reply?.ok, true, "a waiting button refused the whole session");
  const seen = labelled_boxes(run);
  assert.equal(seen.includes(at(chrome.actions[0]!)), false, "an unkeyed collect labelled a button that waits");
  assert.deepEqual([seen.includes(at(chrome.close)), seen.includes(at(chrome.link)), seen.includes(at(chrome.reload))], [true, true, true], "the close button, the link or the toolbar button lost its label");
});

test("with the user's own start key an unknown bar's button gets a label, and its pick waits for Enter", async () => {
  const { run, chrome } = window_with_bar("some-future-bar");
  assert.equal((await bar_collect(run))?.ok, true);
  assert.ok(labelled_boxes(run).includes(at(chrome.actions[0]!)));
  const pick = await label_all(run);
  assert.equal((await pick(chrome.actions[0]!))?.ok, true);
  assert.equal(chrome.actions[0]!.clicks, 0, "a pick ran a button of an unknown bar");
  chrome.clock.now += 500;
  chrome.press("Enter");
  assert.equal(chrome.actions[0]!.clicks, 1);
});

test("a key other than Enter cancels the wait on a bar's button", async () => {
  const { run, chrome } = window_with_bar("some-future-bar");
  await bar_collect(run);
  const pick = await label_all(run);
  await pick(chrome.actions[0]!);
  chrome.clock.now += 500;
  chrome.press("a");
  chrome.press("Enter");
  assert.equal(chrome.actions[0]!.clicks, 0);
});

test("the close button and the link of an unknown bar click at once, since they grant nothing", async () => {
  const { run, chrome } = window_with_bar("some-future-bar");
  await bar_collect(run, { typed: false });
  const pick = await label_all(run);
  assert.equal((await pick(chrome.close))?.ok, true);
  assert.equal(chrome.close.clicks, 1);
});

test("a bar that changes its value while its button waits ends the wait", async () => {
  const { run, chrome } = window_with_bar("some-future-bar");
  await bar_collect(run);
  const pick = await label_all(run);
  await pick(chrome.actions[0]!);
  chrome.mutate(chrome.bar, "value", "another-bar");
  chrome.clock.now += 500;
  chrome.press("Enter");
  assert.equal(chrome.actions[0]!.clicks, 0, "an Enter ran a button of a bar that had changed");
});

test("a bar button that Firefox disables after the labels show answers not ready, and a disabled or hidden one gets no label", async () => {
  const { run, chrome } = window_with_bar("some-future-bar", { buttons: 2 });
  chrome.actions[1]!.disabled = true;
  await bar_collect(run);
  assert.equal(labelled_boxes(run).includes(at(chrome.actions[1]!)), false, "a disabled button got a label");
  const pick = await label_all(run);
  chrome.actions[0]!.disabled = true;
  assert.equal((await pick(chrome.actions[0]!))?.error, "The prompt is not ready yet");
  assert.equal(chrome.actions[0]!.clicks, 0);

  const hidden = window_with_bar("popup-blocked", { shown: false });
  for (const node of [...hidden.chrome.actions, hidden.chrome.link, hidden.chrome.close]) node.visible = false;
  await bar_collect(hidden.run, { typed: false });
  assert.equal(labelled_boxes(hidden.run).includes(at(hidden.chrome.actions[0]!)), false, "a bar in a hidden deck box got labels");
});

// ---- Toolbar panels.

type Control = { name: string; id?: string; class_name?: string; type?: string };

// A browser window with the page focused and one panel open. `controls` are its rows. `find` leaves the panel without an id, inside a tab group editor element, as Firefox builds it. `view_id` puts the rows in a panelview that shows.
function window_with_panel(panel_id: string, controls: Control[], { find = false, view_id = "" } = {}) {
  const run = started_run((firefox) => {
    const page = new Node("browser", { box: box(0, 120, 1200, 600) });
    const panel = new Node("panel", { id: find ? "" : panel_id, box: box(400, 60, 300, 400) });
    panel.state = "open";
    const view = view_id ? new Node("panelview", { id: view_id, box: box(400, 60, 300, 400) }) : panel;
    if (view_id) {
      view.setAttribute("visible", "true");
      panel.append(view);
    }
    const nodes = controls.map((control, index) => Object.assign(new Node(control.name, { id: control.id ?? "", className: control.class_name ?? "", box: box(410, 70 + index * 30, 120, 24) }), control.type ? { type: control.type, attrs: new Map([["type", control.type]]) } : {}));
    view.append(...nodes);
    const nav = new Node("toolbar", { id: "nav-bar" });
    const reload = chrome_button("reload-button", 10);
    nav.append(reload);
    const editor = find ? new Node("tabgroup-menu", { id: "tab-group-editor" }) : undefined;
    editor?.append(panel);
    const window = plain_chrome_window(firefox, "navigator:browser", (root) => root.append(nav, page, editor ?? panel));
    window.focus(page);
    return Object.assign(window, { panel, nodes, reload });
  });
  return { run, chrome: run.chrome as unknown as ReturnType<typeof plain_chrome_window> & { panel: Node; nodes: Node[]; reload: Node } };
}

// What one pick of a control does: whether it got a label, and the clicks right after the pick and after the user's Enter.
async function panel_pick(panel_id: string, control: Control, options: { find?: boolean; view_id?: string } = {}) {
  const { run, chrome } = window_with_panel(panel_id, [control], options);
  const started = await bar_collect(run);
  const target = chrome.nodes[0]!;
  const labelled = labelled_boxes(run).includes(at(target));
  if (!labelled) return { labelled, started };
  const pick = await label_all(run);
  const reply = await pick(target);
  const after_pick = target.clicks + target.commands + (target.open ? 1 : 0);
  chrome.clock.now += 500;
  chrome.press("Enter");
  return { labelled, started, reply, after_pick, after_enter: target.clicks + target.commands + (target.open ? 1 : 0) };
}

const ONCE = { after_pick: 1, after_enter: 1 };
const WAITS = { after_pick: 0, after_enter: 1 };

const PANEL_CASES: [string, string, Control, typeof ONCE, { find?: boolean; view_id?: string }?][] = [
  ["the extensions panel's extension button", "unified-extensions-panel", { name: "toolbarbutton", class_name: "unified-extensions-item-action-button" }, ONCE],
  ["the extensions panel's menu button", "unified-extensions-panel", { name: "toolbarbutton", class_name: "unified-extensions-item-menu-button" }, ONCE],
  ["the site panel's connection row", "trustpanel-popup", { name: "toolbarbutton", id: "trustpanel-popup-connection" }, ONCE],
  ["the site panel's clear-cookies row, which only opens its confirm view", "trustpanel-popup", { name: "toolbarbutton", id: "trustpanel-clear-cookies-button" }, ONCE],
  ["the site panel's back button", "trustpanel-popup", { name: "toolbarbutton", class_name: "subviewbutton subviewbutton-back" }, ONCE],
  ["the site panel's blocker row", "trustpanel-popup", { name: "moz-button", class_name: "moz-button-subviewbutton-nav" }, ONCE],
  ["the site panel's HTTPS-only drop-down", "trustpanel-popup", { name: "menulist", id: "trustpanel-popup-security-httpsonlymode-menulist" }, ONCE],
  ["the site panel's tracking protection toggle", "trustpanel-popup", { name: "moz-toggle", id: "trustpanel-toggle" }, WAITS],
  ["the site panel's confirm Clear cookies button", "trustpanel-popup", { name: "moz-button", id: "trustpanel-clear-cookie-clear" }, WAITS],
  ["the site panel's Remove certificate exception", "trustpanel-popup", { name: "button", id: "identity-popup-remove-cert-exception" }, WAITS],
  ["the site panel's Smartblock toggle", "trustpanel-popup", { name: "moz-toggle", id: "trustpanel-smartblock-fb-toggle" }, WAITS],
  ["a control the site panel does not name", "trustpanel-popup", { name: "button", id: "a-future-button" }, WAITS],
  ["the site info panel's connection row", "identity-popup", { name: "toolbarbutton", id: "identity-popup-security-button" }, ONCE],
  ["the site info panel's Clear cookies and site data", "identity-popup", { name: "toolbarbutton", id: "identity-popup-clear-sitedata-button" }, WAITS],
  ["the site info panel's Remove certificate exception", "identity-popup", { name: "button", id: "identity-popup-remove-cert-exception" }, WAITS],
  ["the protections panel's category row", "protections-popup", { name: "toolbarbutton", id: "protections-popup-category-trackers", class_name: "protections-popup-category" }, ONCE],
  ["the protections panel's tracking protection switch", "protections-popup", { name: "moz-toggle", id: "protections-popup-tp-switch" }, WAITS],
  ["the protections panel's exception remove button", "protections-popup", { name: "button", class_name: "permission-popup-permission-remove-button" }, WAITS],
  ["the permission panel's remove button", "permission-popup", { name: "button", class_name: "permission-popup-permission-remove-button" }, WAITS],
  ["the permission panel's Allow menu", "permission-popup", { name: "menulist", id: "permission-popup-menulist" }, ONCE],
  ["the bookmark panel's Done button", "editBookmarkPanel", { name: "button", id: "editBookmarkPanelDoneButton" }, ONCE],
  ["the bookmark panel's folder drop-down", "editBookmarkPanel", { name: "menulist", id: "editBMPanel_folderMenuList" }, ONCE],
  ["the bookmark panel's Remove bookmark button", "editBookmarkPanel", { name: "button", id: "editBookmarkPanelRemoveButton" }, WAITS],
  ["the tab group editor's New tab row", "tab-group-editor", { name: "toolbarbutton", id: "tabGroupEditor_addNewTabInGroup" }, ONCE, { find: true }],
  ["the tab group editor's color swatch", "tab-group-editor", { name: "label", class_name: "tab-group-editor-swatch" }, ONCE, { find: true }],
  ["the tab group editor's Delete group row", "tab-group-editor", { name: "toolbarbutton", id: "tabGroupEditor_deleteGroup" }, WAITS, { find: true }],
  ["the tab group editor's Ungroup tabs row", "tab-group-editor", { name: "toolbarbutton", id: "tabGroupEditor_ungroupTabs" }, WAITS, { find: true }],
  ["the tab group editor's Save and close group row", "tab-group-editor", { name: "toolbarbutton", id: "tabGroupEditor_saveAndCloseGroup" }, WAITS, { find: true }],
  ["an all-tabs panel row", "customizationui-widget-panel", { name: "toolbarbutton", id: "allTabsMenu-closeDuplicateTabs" }, ONCE, { view_id: "allTabsMenu-allTabsView" }],
];

for (const [name, panel_id, control, expected, options] of PANEL_CASES) {
  test(`${name} ${expected === ONCE ? "clicks at once" : "waits for Enter"}`, async () => {
    const result = await panel_pick(panel_id, control, options);
    assert.equal(result.started?.ok, true);
    assert.equal(result.labelled, true, "the control got no label");
    assert.equal(result.reply?.ok, true);
    assert.deepEqual({ after_pick: result.after_pick, after_enter: result.after_enter }, expected);
  });
}

test("a plain collect with a site panel open refuses, since its controls can grant, and a panel of clicks at once labels with no start key", async () => {
  const site = window_with_panel("trustpanel-popup", [{ name: "toolbarbutton", id: "trustpanel-popup-connection" }, { name: "moz-toggle", id: "trustpanel-toggle" }]);
  assert.equal((await bar_collect(site.run, { typed: false }))?.error, "Type the hint key to label the prompt");
  const extensions = window_with_panel("unified-extensions-panel", [{ name: "toolbarbutton", class_name: "unified-extensions-item-action-button" }]);
  assert.equal((await bar_collect(extensions.run, { typed: false }))?.ok, true);
  assert.ok(labelled_boxes(extensions.run).includes(at(extensions.chrome.nodes[0]!)));
});

test("a key other than Enter cancels the wait on a site panel's toggle, and a navigation under it ends the wait", async () => {
  const cases = [(chrome: ReturnType<typeof window_with_panel>["chrome"]) => chrome.press("a"), (chrome: ReturnType<typeof window_with_panel>["chrome"]) => chrome.panel.fire("popuphidden", { target: chrome.panel } as never)];
  for (const end of cases) {
    const { run, chrome } = window_with_panel("trustpanel-popup", [{ name: "moz-toggle", id: "trustpanel-toggle" }]);
    await bar_collect(run);
    const pick = await label_all(run);
    await pick(chrome.nodes[0]!);
    chrome.clock.now += 500;
    end(chrome);
    chrome.press("Enter");
    assert.equal(chrome.nodes[0]!.clicks, 0);
  }
});

test("a toggle that flips between its mark and Enter ends the wait", async () => {
  const { run, chrome } = window_with_panel("trustpanel-popup", [{ name: "moz-toggle", id: "trustpanel-toggle" }]);
  await bar_collect(run);
  const pick = await label_all(run);
  await pick(chrome.nodes[0]!);
  chrome.nodes[0]!.setAttribute("pressed", "");
  chrome.clock.now += 500;
  chrome.press("Enter");
  assert.equal(chrome.nodes[0]!.clicks, 0, "an Enter ran a toggle that had changed state");
});

test("the shared widget panel is labelled only while the all-tabs view shows", async () => {
  const other = window_with_panel("customizationui-widget-panel", [{ name: "toolbarbutton", id: "PanelUI-history-clear" }], { view_id: "PanelUI-history" });
  await bar_collect(other.run, { typed: false });
  assert.equal(labelled_boxes(other.run).includes(at(other.chrome.nodes[0]!)), false, "another view of the widget panel got labels");
  assert.ok(labelled_boxes(other.run).includes(at(other.chrome.reload)), "the window lost its labels");
});

test("a panel that opens with its name field focused gets no session until the user leaves the field", async () => {
  for (const [panel_id, options] of [["editBookmarkPanel", {}], ["tab-group-editor", { find: true }]] as const) {
    const { run, chrome } = window_with_panel(panel_id, [{ name: "button", id: "editBookmarkPanelDoneButton" }, { name: "toolbarbutton", id: "tabGroupEditor_addNewTabInGroup" }], options);
    const field = new Node("input", { id: "editBMPanel_namePicker", box: box(410, 300, 200) });
    chrome.panel.append(field);
    Object.assign(field, { ownerDocument: chrome.panel.ownerDocument });
    chrome.focus(field);
    run.type_binding();
    assert.deepEqual(run.tokens(), [], `a binding typed in the field of ${panel_id} began a start`);
    assert.equal((await bar_collect(run, { typed: false }))?.error, "Leave the field first");
    chrome.focus(chrome.nodes[0]!);
    run.type_binding();
    assert.equal((await run.collect_here(2))?.ok, true, `${panel_id} gave no labels once the focus left the field`);
    assert.ok(labelled_boxes(run).includes(at(chrome.nodes[0]!)));
  }
});

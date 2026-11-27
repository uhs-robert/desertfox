// The chrome hints feature (browser_module/desertfox-chrome-hints.js) against a small stand-in for a browser window's DOM. It drives the lifecycle: which window gets a session, what a draw shows, what a pick runs, and what each end takes away.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { create_firefox, key_event, source_of } from "./fake_firefox.ts";
import type { FakeEvent } from "./fake_firefox.ts";

const FILE = "desertfox-chrome-hints.js";
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));

type Box = { left: number; top: number; width: number; height: number };
type Handler = (event: FakeEvent & { target?: unknown }) => void;

// An element with the parts of the DOM the feature uses. `query` answers querySelectorAll by selector text.
class Node {
  localName: string;
  id = "";
  hidden = false;
  disabled = false;
  visible = true;
  box: Box = { left: 0, top: 0, width: 0, height: 0 };
  children: Node[] = [];
  parentNode: Node | null = null;
  shadow: Node | null = null;
  shadowRoot: Node | null = null;
  query: Record<string, Node[]> = {};
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  className = "";
  text = "";
  clicks = 0;
  commands = 0;
  ownerDocument: { getElementById(id: string): Node | null } | null = null;
  open = false;
  state = "closed";
  listeners = new Map<string, Set<Handler>>();
  constructor(local_name: string, props: Partial<Node> = {}) {
    this.localName = local_name;
    Object.assign(this, props);
  }
  get isConnected(): boolean {
    let node: Node | null = this;
    while (node?.parentNode) node = node.parentNode;
    return node?.localName === "#root";
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  set textContent(text: string) {
    this.text = text;
  }
  checkVisibility() {
    return this.visible;
  }
  getBoundingClientRect() {
    return this.box;
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  querySelectorAll(selector: string) {
    return this.query[selector] ?? [];
  }
  append(...nodes: Node[]) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }
  prepend(...nodes: Node[]) {
    for (const node of nodes.reverse()) {
      node.remove();
      node.parentNode = this;
      this.children.unshift(node);
    }
  }
  replaceChildren(...nodes: Node[]) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  attachShadow() {
    this.shadow = new Node("#shadow");
    return this.shadow;
  }
  click() {
    this.clicks++;
  }
  doCommand() {
    this.commands++;
  }
  addEventListener(type: string, handler: Handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(handler));
  }
  removeEventListener(type: string, handler: Handler) {
    this.listeners.get(type)?.delete(handler);
  }
  fire(type: string, event: Partial<FakeEvent> & { target?: unknown } = {}) {
    const full = Object.assign(key_event("", { target: this }), event, { stopImmediatePropagation() { full.stopped = true; } });
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(full);
    return full;
  }
  listener_total() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

const button = (id: string, left: number, props: Partial<Node> = {}) => new Node("toolbarbutton", { id, box: { left, top: 10, width: 24, height: 24 }, ...props });

// A browser window: a nav bar with buttons, a tab strip with tabs, and an app menu panel that is closed until a test opens it.
function chrome_window(firefox: ReturnType<typeof create_firefox>, { buttons = 3, private_window = false } = {}) {
  const root = new Node("#root");
  const document_element = new Node("window");
  document_element.setAttribute("windowtype", "navigator:browser");
  root.append(document_element);
  const nav = new Node("toolbar", { id: "nav-bar" });
  const tabs_bar = new Node("toolbar", { id: "TabsToolbar" });
  document_element.append(nav, tabs_bar);
  nav.query.toolbarbutton = Array.from({ length: buttons }, (_, index) => button(`b${index}`, 10 + (index % 30) * 30, { box: { left: 10 + (index % 30) * 30, top: 100 + Math.floor(index / 30) * 30, width: 24, height: 24 } }));
  nav.append(...nav.query.toolbarbutton);
  const tab_list = [0, 1].map((index) => new Node("tab", { box: { left: 200 + index * 100, top: 50, width: 90, height: 30 } }));
  tabs_bar.query["tab.tabbrowser-tab, toolbarbutton"] = tab_list;
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
  document_element.append(panel);
  const by_id: Record<string, Node> = { "nav-bar": nav, TabsToolbar: tabs_bar, "appMenu-popup": panel, "cmd:go": new Node("command"), "cmd:off": new Node("command", { attrs: new Map([["disabled", "true"]]) }) };
  const all_targets = () => [...nav.query.toolbarbutton!, ...tab_list, ...rows];
  const document = {
    readyState: "complete",
    documentElement: document_element,
    createElementNS: (_ns: string, name: string) => new Node(name),
    getElementById: (id: string) => by_id[id] ?? null,
    querySelectorAll: (selector: string) => (selector.startsWith("#") ? (by_id[selector.slice(1)] ? [by_id[selector.slice(1)]] : []) : (document_element.query[selector] ?? [])),
    // The hit test finds a target whose box holds the point. A test hides one by making it `covered`.
    elementFromPoint: (x: number, y: number) => all_targets().find((node) => !node.attrs.has("covered") && x >= node.box.left && x <= node.box.left + node.box.width && y >= node.box.top && y <= node.box.top + node.box.height) ?? null,
  };
  for (const target of all_targets()) target.ownerDocument = document;
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const window_root = new Node("#windowroot");
  const win = Object.assign(new Node("#window"), {
    document,
    innerWidth: 1200,
    innerHeight: 800,
    closed: false,
    private_window,
    windowRoot: window_root,
    location: { href: "chrome://browser/content/browser.xhtml" },
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
  // The feature's own listeners while no session runs: the key listener on the window root and the unload listener that drops it.
  const session_listeners = () => window_root.listener_total() + win.listener_total() - 2;
  return { session_listeners, id, win, nav, tab_list, rows, panel, view, press, layers, labels, fire_timers, timers, window_root, document_element };
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
  const collect = async (session = 1, window_id = chrome.id) => {
    const id = send("chrome_hints.collect", { session, window_id, colors: "" });
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
  return { firefox, chrome, send, from_module, reply, pushes, target_ids, collect, draw, pick };
}

test("the module's kind rows are the protocol's, so a collect is answered and its targets pass the extension's check", async () => {
  const { collect, from_module } = started();
  assert.deepEqual(await collect(), { v: 1, reply_to: "r0", ok: true });
  assert.ok(protocol.validate_message_list(from_module(), protocol.MODULE_TO_EXTENSION_KINDS, Date.now()).ok);
});

test("a collect sends each target's id and box, ids count up across sessions, and the layer goes in a closed shadow root with the fixed sheet", async () => {
  const { collect, pushes, chrome, target_ids } = started();
  await collect(1);
  const [part] = pushes("chrome_hints.targets");
  assert.deepEqual({ ...part, targets: undefined }, { session: 1, part: 0, parts: 1, targets: undefined });
  const rows = JSON.parse(part!.targets as string) as number[][];
  assert.deepEqual(rows.map((row) => row.slice(1)), [[10, 100, 24, 24], [40, 100, 24, 24], [70, 100, 24, 24], [200, 50, 90, 30], [300, 50, 90, 30]]);
  const [host] = chrome.layers();
  assert.equal(host!.shadow!.children[0]!.getAttribute("href"), "moz-extension://uuid/chrome_hints.css");
  assert.equal(host!.style.cssText!.includes("pointer-events: none"), true);
  const first_ids = target_ids();
  await collect(2);
  const second_ids = target_ids().slice(first_ids.length);
  assert.ok(Math.min(...second_ids) > Math.max(...first_ids), "a newer session reused an older session's ids");
  assert.equal(chrome.layers().length, 1, "the older session's layer is left");
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
  for (const bad of [[[999999, "a"]], [[a!, "<b>"]], [[a!, "abcdefghi"]], [[a!]], [[a!, 5]]] as never[]) await draw(1, 9, bad);
  await draw(2, 10, [[a!, "a"]]);
  assert.deepEqual(chrome.labels().map((label) => label.text), ["sd"], "a bad row or another session's draw showed");
});

test("keys before the first draw wait, then go out in order; Escape ends the session in chrome and tells the extension", async () => {
  const { collect, draw, chrome, pushes, target_ids } = started();
  await collect(1);
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
  const after = chrome.press("j");
  assert.ok(!after.prevented, "a key after the end was taken");
});

test("a key with Ctrl, a click, the window leaving the front, a resize and the window closing each end the session", async () => {
  for (const end of ["ctrl", "mousedown", "deactivate", "resize", "unload"]) {
    const { collect, chrome, pushes } = started();
    await collect(1);
    if (end === "ctrl") assert.ok(!chrome.press("w", { ctrlKey: true }).prevented, "Ctrl+W was taken");
    else chrome.win.fire(end);
    assert.deepEqual(pushes("chrome_hints.end"), [{ session: 1 }], end);
    assert.equal(chrome.layers().length, 0, end);
    assert.equal(end === "unload" ? chrome.session_listeners() + 2 : chrome.session_listeners(), 0, end);
  }
});

test("no first draw within its time ends the session, and the pref off ends it with nothing left", async () => {
  const late = started();
  await late.collect(1);
  late.chrome.fire_timers();
  assert.deepEqual(late.pushes("chrome_hints.end"), [{ session: 1 }]);
  assert.equal(late.chrome.layers().length, 0);

  const off = started();
  await off.collect(1);
  off.firefox.set_pref(false);
  assert.equal(off.chrome.layers().length, 0);
  assert.equal(off.chrome.session_listeners(), 0);
});

test("a pick runs the target's fixed action once, and refuses another session, an unknown id, an undrawn target, a gone one and a moved one", async () => {
  const { collect, draw, pick, chrome, target_ids } = started();
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
  const { firefox, collect, chrome } = started();
  const later: boolean[] = [];
  chrome.window_root.addEventListener("keydown", (event) => void later.push(event.prevented));
  await collect(1);
  chrome.press("j");
  assert.deepEqual(later, [true], "a later listener saw the session's key as not taken");
  (firefox.Services.desertfox_browser_module as { shut_down(): void }).shut_down();
  assert.equal(chrome.layers().length, 0);
  assert.equal(chrome.window_root.listener_total(), 1, "the feature's window root listener outlived the module");
  assert.equal(chrome.win.listener_total(), 0);
});

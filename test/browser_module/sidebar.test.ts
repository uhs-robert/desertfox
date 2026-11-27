import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_MODULE_PROTOCOL_VERSION, sidebar_keys_of } from "../../src/shared/browser_module_protocol.ts";
import { create_firefox, IME_ENABLED, key_event, source_of } from "./fake_firefox.ts";
import type { FakeEvent } from "./fake_firefox.ts";

const SIDEBAR_FILE = "desertfox-sidebar.js";
const TIP = "@mozilla.org/text-input-processor;1";
const HISTORY_URL = "chrome://browser/content/sidebar/sidebar-history.html";
const OPEN_TABS_URL = "chrome://browser/content/sidebar/sidebar-opentabs.html";
const BOOKMARKS_URL = "chrome://browser/content/places/bookmarksSidebar.xhtml";

const SIDEBAR_KEYS = [
  { keys: ["j"], id: "sidebar.down" },
  { keys: ["k"], id: "sidebar.up" },
  { keys: ["g", "g"], id: "sidebar.first" },
  { keys: ["G"], id: "sidebar.last" },
  { keys: ["<Enter>"], id: "sidebar.open" },
  { keys: ["l"], id: "sidebar.expand" },
  { keys: ["h"], id: "sidebar.collapse" },
  { keys: ["d"], id: "sidebar.close_item" },
  { keys: ["/"], id: "sidebar.filter" },
  { keys: ["<Escape>"], id: "sidebar.leave" },
];
const state = (patch: Record<string, unknown> = {}) => ({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: [], tabs: {}, sidebar_keys: SIDEBAR_KEYS, ...patch });

type Listener = (event: FakeEvent) => void;
type FakeNode = {
  localName: string;
  id: string;
  className?: string;
  type?: string;
  ownerDocument: FakeDocument;
  parentElement: FakeNode | null;
  isConnected: boolean;
  shadowRoot?: { activeElement: FakeNode | null; querySelectorAll(selector: string): FakeNode[] };
  host?: FakeNode;
  attributes: Record<string, string>;
  focused: number;
  [name: string]: unknown;
};
type FakeDocument = { documentURI: string; activeElement: FakeNode | null; nodes: FakeNode[]; querySelectorAll(selector: string): FakeNode[]; querySelector(selector: string): FakeNode | null; [name: string]: unknown };

function make_document(url: string): FakeDocument {
  const doc: FakeDocument = {
    documentURI: url,
    activeElement: null,
    nodes: [],
    querySelectorAll: (selector: string) => (selector === "*" ? doc.nodes : doc.nodes.filter((node) => selector.split(", ").includes(node.localName))),
    querySelector: (selector: string) => doc.querySelectorAll(selector)[0] ?? null,
  };
  return doc;
}

// A node of `doc`. `parent` is its parent element, `inside` the strip id its `closest` finds.
function make_node(doc: FakeDocument, localName: string, more: Partial<FakeNode> & { inside?: string } = {}): FakeNode {
  const { inside, ...rest } = more;
  const node: FakeNode = {
    localName,
    id: "",
    ownerDocument: doc,
    parentElement: null,
    isConnected: true,
    attributes: {},
    focused: 0,
    getAttribute: (name: string) => node.attributes[name] ?? null,
    hasAttribute: (name: string) => name in node.attributes,
    getRootNode: () => doc,
    closest: (selector: string) => (inside !== undefined && selector === `#${inside}` ? node : null),
    focus() {
      node.focused++;
      doc.activeElement = node;
    },
    ...rest,
  };
  doc.nodes.push(node);
  return node;
}

function make_target() {
  const listeners = new Map<string, Set<Listener>>();
  const key = (type: string, options: unknown) => `${type}:${options === true || (typeof options === "object" && options !== null && (options as { capture?: boolean }).capture === true) ? "capture" : "bubble"}`;
  return {
    addEventListener(type: string, listener: Listener, options?: unknown) {
      listeners.set(key(type, options), (listeners.get(key(type, options)) ?? new Set()).add(listener));
    },
    removeEventListener(type: string, listener: Listener, options?: unknown) {
      listeners.get(key(type, options))?.delete(listener);
    },
    fire(type: string, event: FakeEvent) {
      for (const phase of ["capture", "bubble"]) for (const listener of [...(listeners.get(`${type}:${phase}`) ?? [])]) listener(event);
    },
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

function setup({ written = state() as unknown, vertical = false, panel_url = HISTORY_URL, core_patch = (source: string) => source } = {}) {
  const firefox = create_firefox({ extra_files: { [SIDEBAR_FILE]: source_of(SIDEBAR_FILE) }, patch_source: (name, source) => (name === "desertfox-browser.js" ? core_patch(source) : source) });
  const watchers = new Set<{ observe(subject: unknown, topic: string): void }>();
  const typed: string[] = [];
  const timers: (() => void)[] = [];
  let dispatch_typed = (_key: string): unknown => undefined;
  firefox.Services.ww = {
    registerNotification: (observer: { observe(subject: unknown, topic: string): void }) => watchers.add(observer),
    unregisterNotification: (observer: { observe(subject: unknown, topic: string): void }) => watchers.delete(observer),
  };
  firefox.Components.interfaces.nsITextInputProcessor = {};
  firefox.Components.classes[TIP] = {
    // As in Firefox, a typed key goes through the window's listeners like any other.
    createInstance: () => ({
      beginInputTransaction: () => true,
      keydown: (event: { key: string }) => {
        typed.push(event.key);
        dispatch_typed(event.key);
      },
      keyup: () => undefined,
    }),
  };
  firefox.start_extension();
  if (written !== null) firefox.write_state(written);

  const fake = firefox.make_window();
  const { tab, browser } = fake.add_tab();
  const own = make_target();
  const root = make_target();
  const main_doc = make_document("chrome://browser/content/browser.xhtml");
  const panel_doc = make_document(panel_url);
  const sidebar_browser = make_node(main_doc, "browser", { id: "sidebar", contentDocument: panel_doc });
  const page = browser as unknown as FakeNode;
  Object.assign(page, { ownerDocument: main_doc, isConnected: true, focused: 0, focus: () => ((page.focused as number)++, (main_doc.activeElement = page)) });

  // The strip: three tabs, the middle one in a group, and the group's label.
  const strip_tabs = ["a", "b", "c"].map((id) => make_node(main_doc, "tab", { id, inside: "tabbrowser-tabs" }));
  const group = { collapsed: false, labelElement: null as FakeNode | null };
  const label = make_node(main_doc, "label", { id: "group-label", inside: "tabbrowser-tabs", group, click() {} });
  group.labelElement = label;
  strip_tabs[1]!.group = group;
  const removed: unknown[] = [];
  // Each tab's browser container, where Firefox docks the tab's DevTools.
  const containers = new Map<unknown, FakeNode>();
  const container_of = (each_tab: { browser: unknown }) => {
    const contains = (node: FakeNode | null): boolean => !!node && (node === container || contains(node.parentElement));
    const container = make_node(main_doc, "vbox", { contains });
    Object.assign(each_tab, { linkedBrowser: each_tab.browser });
    containers.set(each_tab.browser, container);
    return container;
  };
  const all_tabs_panel: number[] = [];
  const tab_container = { verticalMode: vertical, ariaFocusableItems: [strip_tabs[0], label, strip_tabs[1], strip_tabs[2]], ariaFocusedItem: null as FakeNode | null };
  const win = fake.win as unknown as Record<string, unknown> & { gBrowser: Record<string, unknown> };
  Object.assign(win, {
    windowRoot: root,
    addEventListener: own.addEventListener,
    removeEventListener: own.removeEventListener,
    location: { href: "chrome://browser/content/browser.xhtml" },
    setTimeout: (run: () => void) => timers.push(run),
    KeyboardEvent: class {
      key: string;
      constructor(_type: string, init: { key: string }) {
        this.key = init.key;
      }
    },
    SidebarController: { browser: sidebar_browser },
    gTabsPanel: { showAllTabsPanel: () => all_tabs_panel.push(1) },
  });
  Object.assign(main_doc, { readyState: "complete", documentElement: { getAttribute: (name: string) => (name === "windowtype" ? "navigator:browser" : null) }, commandDispatcher: { focusedElement: null } });
  win.document = main_doc;
  Object.assign(win.gBrowser, {
    tabContainer: tab_container,
    selectedTab: tab,
    selectedBrowser: page,
    removeTab: (each: unknown) => removed.push(each),
    removeTabs: (list: unknown[]) => removed.push(...list),
    getBrowserContainer: (each: unknown) => containers.get(each),
  });
  firefox.Services.wm = { getEnumerator: () => [win] };
  fake.load();

  // The focus in the main document's view: the deepest element, with `commandDispatcher` naming the element the window holds.
  const focus = (node: FakeNode | null) => {
    if (node === null) return;
    if (node.ownerDocument === panel_doc) {
      panel_doc.activeElement = node;
      (main_doc.commandDispatcher as { focusedElement: unknown }).focusedElement = node;
    } else {
      main_doc.activeElement = node;
      (main_doc.commandDispatcher as { focusedElement: unknown }).focusedElement = node;
    }
    own.fire("focus", key_event("focus", { target: node, originalTarget: node }));
  };
  const press = (key: string, patch: Partial<FakeEvent> = {}) => {
    const target = (main_doc.commandDispatcher as { focusedElement: unknown }).focusedElement;
    const event = key_event(key, { target, originalTarget: target, ...patch });
    root.fire("keydown", event);
    if (!event.stopped) own.fire("keydown", event);
    return event;
  };
  dispatch_typed = (key: string) => press(key);
  // Runs the timers the timers start too, as the event loop does before the next key.
  const run_timers = () => {
    while (timers.length > 0) timers.splice(0).forEach((run) => run());
  };
  return { firefox, win, fake, main_doc, panel_doc, page, tab, container_of, strip_tabs, label, group, tab_container, removed, all_tabs_panel, typed, timers, run_timers, focus, press, root, own, watchers };
}

const panel_row = (doc: FakeDocument, more: Partial<FakeNode> = {}) => make_node(doc, "sidebar-tab-row", { attributes: { tabindex: "0" }, ...more });

test("in a panel row j, k, gg, G, Enter, l and h type the arrow keys once the key's event is over", () => {
  const { panel_doc, focus, press, typed, run_timers } = setup();
  focus(panel_row(panel_doc));
  for (const key of ["j", "k", "g", "g", "G", "Enter", "l", "h"]) assert.ok(press(key).prevented, `${key} was not taken`);
  assert.deepEqual(typed, [], "a key went out inside the key's event");
  run_timers();
  assert.deepEqual(typed, ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "ArrowRight", "ArrowLeft"]);
});

test("a typed Enter goes on to the panel and is not taken again as sidebar.open", () => {
  const { panel_doc, focus, press, typed, run_timers } = setup();
  focus(panel_row(panel_doc));
  press("Enter");
  run_timers();
  assert.deepEqual(typed, ["Enter"]);
});

test("a typed key is dropped when the focus left the panel before it went out", () => {
  const { panel_doc, page, main_doc, focus, press, typed, run_timers } = setup();
  const row = panel_row(panel_doc);
  focus(row);
  press("j");
  // As in Firefox, the panel document keeps its own active element after the window's focus moves on.
  focus(page);
  assert.equal(panel_doc.activeElement, row);
  run_timers();
  focus(row);
  press("j");
  focus(make_node(main_doc, "toolbarbutton"));
  run_timers();
  assert.deepEqual(typed, []);
});

test("in the search box only Escape is taken, and it moves the focus to the list", () => {
  const { panel_doc, focus, press, typed, run_timers } = setup();
  const row = panel_row(panel_doc);
  const input = make_node(panel_doc, "input", { type: "search" });
  focus(input);
  for (const key of ["j", "k", "g", "G", "d", "/", "Enter"]) assert.equal(press(key).prevented, false, `${key} was taken in the search box`);
  run_timers();
  assert.deepEqual(typed, []);
  assert.ok(press("Escape").prevented);
  assert.equal(row.focused, 1);
});

test("Escape in the search box goes to the page when the list has no row that takes the focus", () => {
  const empty = setup();
  empty.focus(make_node(empty.panel_doc, "input", { type: "search" }));
  assert.ok(empty.press("Escape").prevented);
  assert.equal(empty.page.focused, 1);
  const hidden = setup();
  const row = panel_row(hidden.panel_doc, { focus: () => (row.focused += 1) });
  hidden.focus(make_node(hidden.panel_doc, "input", { type: "search" }));
  assert.ok(hidden.press("Escape").prevented);
  assert.deepEqual([row.focused, hidden.page.focused], [1, 1]);
});

test("a field inside a shadow root counts as a field", () => {
  const { panel_doc, focus, press } = setup();
  const inner = make_node(panel_doc, "input", { type: "text" });
  const host = make_node(panel_doc, "moz-input-search", { shadowRoot: { activeElement: inner, querySelectorAll: () => [] } });
  panel_doc.activeElement = host;
  focus(host);
  assert.equal(press("j").prevented, false);
});

test("the page, the toolbars, an add-on's sidebar and the horizontal strip keep their keys", () => {
  const add_on = setup({ panel_url: "chrome://browser/content/webext-panels.xhtml" });
  add_on.focus(panel_row(add_on.panel_doc));
  assert.equal(add_on.press("j").prevented, false, "j was taken in an add-on's sidebar");
  const { page, main_doc, strip_tabs, focus, press } = setup();
  focus(page);
  assert.equal(press("j").prevented, false, "j was taken in the page");
  focus(make_node(main_doc, "toolbarbutton"));
  assert.equal(press("j").prevented, false, "j was taken on a toolbar");
  focus(strip_tabs[0]!);
  assert.equal(press("j").prevented, false, "j was taken in the horizontal strip");
});

test("nothing is taken with the module off, without a sidebar table, or while a menu or a walking panel is open", () => {
  for (const written of [state({ enabled: false }), state({ sidebar_keys: undefined }), state({ sidebar_keys: "junk" })]) {
    const { panel_doc, focus, press } = setup({ written });
    focus(panel_row(panel_doc));
    assert.equal(press("j").prevented, false, JSON.stringify(written));
  }
  const { panel_doc, main_doc, focus, press } = setup();
  focus(panel_row(panel_doc));
  const popups: Record<string, unknown>[] = [];
  main_doc.querySelectorAll = (selector: string) => (selector === "menupopup, panel" ? (popups as unknown as FakeNode[]) : main_doc.nodes);
  const popup = (localName: string, id: string, attributes: Record<string, string> = {}, multiview = false) => ({ localName, id, state: "open", hasAttribute: (name: string) => name in attributes, querySelector: () => (multiview ? {} : null) });
  popups.push(popup("menupopup", "ignores", { ignorekeys: "true" }), popup("panel", "identity-popup"));
  assert.ok(press("j").prevented, "a menu that ignores keys or a plain panel took the key away");
  for (const owner of [popup("menupopup", "contentAreaContextMenu"), popup("panel", "appMenu-popup", {}, true), popup("panel", "unified-extensions-panel", {}, true), popup("panel", "downloadsPanel")]) {
    popups.push(owner);
    assert.equal(press("j").prevented, false, `j was taken under ${owner.id}`);
    popups.pop();
  }
});

test("the sidebar takes no key while another feature holds the window's keys, and takes them again after the release", () => {
  const { firefox, win, panel_doc, focus, press } = setup();
  focus(panel_row(panel_doc));
  const core = firefox.Services.desertfox_browser_module as { hold_keys(win: unknown, owner: string): void; release_keys(win: unknown, owner: string): void };
  core.hold_keys(win, "chrome_hints");
  assert.equal(press("j").prevented, false, "j was taken while a hint session held the keys");
  core.release_keys(win, "chrome_hints");
  assert.ok(press("j").prevented, "j was not taken after the release");
});

test("gg needs both keys: a g then another key runs that key alone, and Escape, a focus move or a window blur drop the g", () => {
  const { panel_doc, focus, press, typed, run_timers, own } = setup();
  const row = panel_row(panel_doc);
  focus(row);
  assert.ok(press("g").prevented, "the first g was not held");
  press("j");
  run_timers();
  assert.deepEqual(typed, ["ArrowDown"]);
  press("g");
  assert.ok(press("Escape").prevented);
  assert.equal(press("g").prevented, true);
  focus(row);
  press("g");
  run_timers();
  assert.deepEqual(typed, ["ArrowDown"], "a g after a focus move ran gg");
  own.fire("blur", key_event("blur"));
  press("g");
  run_timers();
  assert.deepEqual(typed, ["ArrowDown"], "a g after a window blur ran gg");
  press("g");
  run_timers();
  assert.deepEqual(typed, ["ArrowDown", "Home"]);
});

test("d closes the open tabs row's tab, and is left alone in history and bookmarks", () => {
  const open_tabs = setup({ panel_url: OPEN_TABS_URL });
  const row_tab = { localName: "tab" };
  const row = panel_row(open_tabs.panel_doc, { tabElement: row_tab });
  const cell = make_node(open_tabs.panel_doc, "button", { parentElement: row });
  open_tabs.focus(cell);
  assert.ok(open_tabs.press("d").prevented);
  assert.deepEqual(open_tabs.removed, [row_tab]);
  for (const panel_url of [HISTORY_URL, BOOKMARKS_URL]) {
    const { panel_doc, focus, press, removed, typed, run_timers } = setup({ panel_url });
    focus(panel_row(panel_doc, { tabElement: row_tab }));
    assert.equal(press("d").prevented, false, panel_url);
    run_timers();
    assert.deepEqual([removed, typed], [[], []]);
  }
});

test("/ focuses the panel's search box", () => {
  const { panel_doc, focus, press } = setup();
  const box = make_node(panel_doc, "moz-input-search");
  focus(panel_row(panel_doc));
  assert.ok(press("/").prevented);
  assert.equal(box.focused, 1);
});

test("in the vertical strip j and k move the strip's focus, gg and G go to the ends, Enter selects, d closes and / opens the all tabs panel", () => {
  const { win, strip_tabs, label, tab_container, removed, all_tabs_panel, focus, press, typed } = setup({ vertical: true });
  win.gBrowser.selectedTab = strip_tabs[0];
  focus(strip_tabs[0]!);
  press("j");
  assert.equal(tab_container.ariaFocusedItem, label);
  press("j");
  press("j");
  press("j");
  assert.equal(tab_container.ariaFocusedItem, strip_tabs[2], "j went past the last item");
  press("k");
  assert.equal(tab_container.ariaFocusedItem, strip_tabs[1]);
  press("g");
  press("g");
  assert.equal(tab_container.ariaFocusedItem, strip_tabs[0]);
  press("G");
  assert.equal(tab_container.ariaFocusedItem, strip_tabs[2]);
  assert.ok(press("Enter").prevented);
  assert.equal(win.gBrowser.selectedTab, strip_tabs[2]);
  assert.ok(press("d").prevented);
  assert.deepEqual(removed, [strip_tabs[2]]);
  assert.ok(press("/").prevented);
  assert.deepEqual(all_tabs_panel, [1]);
  assert.deepEqual(typed, [], "the strip typed arrow keys");
});

test("in the vertical strip h folds the focused tab's group onto its label and l unfolds it", () => {
  const { strip_tabs, label, group, tab_container, focus, press } = setup({ vertical: true });
  focus(strip_tabs[1]!);
  tab_container.ariaFocusedItem = strip_tabs[1]!;
  press("h");
  assert.equal(group.collapsed, true);
  assert.equal(tab_container.ariaFocusedItem, label);
  press("l");
  assert.equal(group.collapsed, false);
  tab_container.ariaFocusedItem = strip_tabs[0]!;
  assert.equal(press("h").prevented, false, "h was taken on a tab in no group");
});

test("Escape goes back to the page region that had the focus, and to the shown page when that one is hidden", () => {
  const { win, fake, main_doc, page, tab, container_of, panel_doc, focus, press } = setup();
  const devtools = make_node(main_doc, "iframe", { className: "devtools-toolbox-bottom-iframe", parentElement: container_of(tab) });
  focus(devtools);
  focus(panel_row(panel_doc));
  assert.ok(press("Escape").prevented);
  assert.equal(devtools.focused, 1);
  // A second tab's page had the focus, then its tab went to the background.
  const other = fake.add_tab();
  const other_page = other.browser as unknown as FakeNode;
  Object.assign(other_page, { ownerDocument: main_doc, isConnected: true, focused: 0, focus: () => (other_page.focused as number)++ });
  focus(other_page);
  focus(panel_row(panel_doc));
  press("Escape");
  assert.equal(other_page.focused, 0);
  assert.equal(page.focused, 1);
  win.gBrowser.selectedTab = other.tab;
  focus(other_page);
  focus(panel_row(panel_doc));
  press("Escape");
  assert.equal(other_page.focused, 1);
});

test("Escape skips a docked DevTools whose tab went to the background", () => {
  const { win, fake, main_doc, tab, container_of, panel_doc, focus, press } = setup();
  const devtools = make_node(main_doc, "iframe", { className: "devtools-toolbox-bottom-iframe", parentElement: container_of(tab) });
  focus(devtools);
  const other = fake.add_tab();
  container_of(other);
  const other_page = other.browser as unknown as FakeNode;
  Object.assign(other_page, { ownerDocument: main_doc, isConnected: true, focused: 0, focus: () => (other_page.focused as number)++ });
  win.gBrowser.selectedTab = other.tab;
  win.gBrowser.selectedBrowser = other_page;
  focus(panel_row(panel_doc));
  assert.ok(press("Escape").prevented);
  assert.deepEqual([devtools.focused, other_page.focused], [0, 1]);
});

test("an action that meets a changed Firefox leaves the key to Firefox and logs one line", () => {
  const { win, firefox, strip_tabs, focus, press } = setup({ vertical: true });
  focus(strip_tabs[0]!);
  (win.gBrowser.tabContainer as Record<string, unknown>).ariaFocusableItems = undefined;
  assert.equal(press("j").prevented, false);
  win.gBrowser.tabContainer = { verticalMode: true, get ariaFocusableItems(): unknown {
    throw new Error("changed");
  }, ariaFocusedItem: null };
  assert.equal(press("j").prevented, false);
  press("j");
  assert.equal(firefox.errors.filter((line) => line.includes("in the sidebar keys")).length, 1);
});

test("a core without the sidebar surface leaves the feature off, and the module on", () => {
  const { firefox, panel_doc, focus, press } = setup({ core_patch: (source) => source.replace("      sidebar_row: (win, keys)", "      sidebar_row_gone: (win, keys)") });
  focus(panel_row(panel_doc));
  assert.equal(press("j").prevented, false);
  assert.ok(firefox.errors.some((line) => line.includes("no sidebar_row")));
  assert.equal(typeof firefox.Services.desertfox_browser_module, "object");
});

test("the module's shut down takes the feature's listeners away", () => {
  const { firefox, root, own, watchers } = setup();
  assert.ok(root.count() > 0 && watchers.size === 1);
  (firefox.Services.desertfox_browser_module as { shut_down(): void }).shut_down();
  assert.equal(root.count(), 0);
  assert.equal(own.count(), 0);
  assert.equal(watchers.size, 0);
});

test("the core's type_key types only the arrow keys, Home, End and Enter, and nothing from a field or DevTools", () => {
  // No sidebar table, so the typed keys reach no sidebar row.
  const { firefox, win, main_doc, panel_doc, focus, typed, run_timers } = setup({ written: state({ sidebar_keys: undefined }) });
  const core = firefox.Services.desertfox_browser_module as { type_key(win: unknown, key: string, still_holds: () => boolean): boolean };
  focus(panel_row(panel_doc));
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter"]) assert.equal(core.type_key(win, key, () => true), true, key);
  for (const key of ["a", "Delete", "Tab", "Escape", "F5"]) assert.equal(core.type_key(win, key, () => true), false, key);
  assert.equal(core.type_key(win, "ArrowDown", () => false), true);
  run_timers();
  assert.deepEqual(typed, ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter"]);

  focus(make_node(panel_doc, "textarea"));
  assert.equal(core.type_key(win, "ArrowDown", () => true), false, "typed into a field");
  focus(panel_row(panel_doc));
  (win.windowUtils as { IMEStatus: number }).IMEStatus = IME_ENABLED;
  assert.equal(core.type_key(win, "ArrowDown", () => true), false, "typed while a remote field had the focus");
  (win.windowUtils as { IMEStatus: number }).IMEStatus = 0;
  const toolbox_doc = make_document("about:devtools-toolbox");
  focus(make_node(toolbox_doc, "div"));
  assert.equal(core.type_key(win, "ArrowDown", () => true), false, "typed into DevTools");
  focus(make_node(main_doc, "toolbarbutton"));
  core.type_key(win, "ArrowDown", () => true);
  focus(make_node(panel_doc, "input"));
  run_timers();
  assert.equal(typed.length, 7, "typed after a field took the focus");
});

test("the core's sidebar table takes what sidebar_keys_of takes and nothing it refuses", () => {
  const tables: unknown[] = [
    SIDEBAR_KEYS,
    "j",
    Array.from({ length: 33 }, (_, index) => ({ keys: [`<F${index + 1}>`], id: "sidebar.down" })),
    [null],
    [{ keys: "j", id: "sidebar.down" }],
    [{ keys: [], id: "sidebar.down" }],
    [{ keys: ["g", "g", "g"], id: "sidebar.first" }],
    [{ keys: ["two words"], id: "sidebar.down" }],
    [{ keys: ["j"], id: "sidebar.down" }, { keys: ["j"], id: "sidebar.up" }],
    [{ keys: ["g"], id: "sidebar.last" }, { keys: ["g", "g"], id: "sidebar.first" }],
    [{ keys: ["g", "g"], id: "sidebar.first" }, { keys: ["g"], id: "sidebar.last" }],
  ];
  for (const table of tables) {
    const { firefox, win } = setup({ written: state({ sidebar_keys: table }) });
    const core = firefox.Services.desertfox_browser_module as { sidebar_row(win: unknown, keys: string[]): { id?: string; prefix?: true } | undefined };
    const rows = sidebar_keys_of(table);
    const probe = rows?.[0]?.keys ?? (Array.isArray(table) && Array.isArray((table[0] as { keys?: unknown })?.keys) ? ((table[0] as { keys: string[] }).keys) : ["j"]);
    assert.equal(core.sidebar_row(win, probe)?.id, rows?.[0]?.id, JSON.stringify(table));
  }
  const { firefox, win } = setup();
  const core = firefox.Services.desertfox_browser_module as { sidebar_row(win: unknown, keys: string[]): unknown };
  assert.deepEqual(JSON.parse(JSON.stringify(core.sidebar_row(win, ["g"]))), { prefix: true });
  assert.deepEqual(JSON.parse(JSON.stringify(core.sidebar_row(win, ["g", "g"]))), { id: "sidebar.first" });
  assert.equal(core.sidebar_row(win, ["x"]), undefined);
});

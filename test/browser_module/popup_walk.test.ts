import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_MODULE_PROTOCOL_VERSION } from "../../src/shared/browser_module_protocol.ts";
import { create_firefox, IME_ENABLED, key_event, source_of } from "./fake_firefox.ts";
import type { FakeEvent } from "./fake_firefox.ts";

const WALK_FILE = "desertfox-popup-walk.js";
const TIP = "@mozilla.org/text-input-processor;1";

type Listener = (event: FakeEvent) => void;
type Node = { localName: string; id?: string; [name: string]: unknown };

// An event target that keeps its listeners by type and capture flag, as Firefox does.
function make_target() {
  const listeners = new Map<string, Set<Listener>>();
  const once_of = new WeakMap<Listener, Listener>();
  const key = (type: string, options: unknown) => `${type}:${options === true || (typeof options === "object" && options !== null && (options as { capture?: boolean }).capture === true) ? "capture" : "bubble"}`;
  return {
    addEventListener(type: string, listener: Listener, options?: unknown) {
      const once = typeof options === "object" && options !== null && (options as { once?: boolean }).once === true;
      const set = listeners.get(key(type, options)) ?? new Set();
      listeners.set(key(type, options), set);
      if (!once) return void set.add(listener);
      const wrapped: Listener = (event) => {
        set.delete(wrapped);
        listener(event);
      };
      once_of.set(listener, wrapped);
      set.add(wrapped);
    },
    removeEventListener(type: string, listener: Listener, options?: unknown) {
      listeners.get(key(type, options))?.delete(once_of.get(listener) ?? listener);
    },
    fire(type: string, event: FakeEvent) {
      for (const phase of ["capture", "bubble"]) for (const listener of [...(listeners.get(`${type}:${phase}`) ?? [])]) listener(event);
    },
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

const popup = (localName: string, id = "", attributes: Record<string, string> = {}, holds_multiview = false): Node & { state: string } => ({
  localName,
  id,
  state: "open",
  getAttribute: (name: string) => attributes[name] ?? null,
  hasAttribute: (name: string) => name in attributes,
  querySelector: (selector: string) => (selector === "panelmultiview" && holds_multiview ? { localName: "panelmultiview" } : null),
});

function setup({ pref = true, state = { v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: [], tabs: {} } as unknown, start_extension = true, fail_watcher = false } = {}) {
  const firefox = create_firefox({ pref, extra_files: { [WALK_FILE]: source_of(WALK_FILE) } });
  const watchers = new Set<{ observe(subject: unknown, topic: string): void }>();
  const open_windows: { win: { closed: boolean } }[] = [];
  const typed: { window: string; key: string }[] = [];
  const timers: (() => void)[] = [];
  firefox.Services.ww = {
    registerNotification(observer: { observe(subject: unknown, topic: string): void }) {
      if (fail_watcher) throw new Error("ww changed");
      watchers.add(observer);
    },
    unregisterNotification: (observer: { observe(subject: unknown, topic: string): void }) => watchers.delete(observer),
  };
  firefox.Services.wm = { getEnumerator: () => open_windows.filter((each) => !each.win.closed).map((each) => each.win) };
  firefox.Components.interfaces.nsITextInputProcessor = {};
  let refuse_typing = false;
  firefox.Components.classes[TIP] = {
    createInstance: () => {
      let target: { type: string } | undefined;
      return {
        beginInputTransaction(win: { type: string }) {
          target = win;
          return !refuse_typing;
        },
        keydown: (event: { key: string }) => typed.push({ window: target!.type, key: event.key }),
        keyup: () => undefined,
      };
    },
  };

  // A chrome window of `type` with the parts the walk reads. A browser window also gets the fake's tabs and the loader.
  function chrome_window(type: string, { browser_window = undefined as ReturnType<typeof firefox.make_window> | undefined, loaded = true } = {}) {
    const base: object = browser_window?.win ?? {};
    const own = make_target();
    const root = make_target();
    let focused: Node | undefined;
    const elements = new Map<string, Node>();
    // The popups a test showed, which the core's menu check reads back from the document.
    const shown: Node[] = [];
    const win = Object.assign(base, {
      type,
      closed: false,
      location: { href: loaded ? `chrome://browser/content/${type}.xhtml` : "about:blank" },
      windowUtils: { IMEStatus: 0 },
      windowRoot: root,
      // The fake's own listeners are replaced: the core attaches through these, and a key reaches them after the window root.
      addEventListener: own.addEventListener,
      removeEventListener: own.removeEventListener,
      document: {
        readyState: loaded ? "complete" : "uninitialized",
        documentElement: { getAttribute: (name: string) => (name === "windowtype" && loaded ? type : null) },
        commandDispatcher: {
          get focusedElement() {
            return focused;
          },
        },
        querySelectorAll: (selector: string) => shown.filter((node) => selector.split(",").some((name) => name.trim() === node.localName)),
        getElementById: (id: string) => elements.get(id) ?? null,
      },
      setTimeout: (run: () => void) => timers.push(run),
      KeyboardEvent: class {
        key: string;
        constructor(_type: string, init: { key: string }) {
          this.key = init.key;
        }
      },
      close() {
        win.closed = true;
        own.fire("unload", key_event("unload"));
      },
    });
    const record = {
      win,
      root,
      own,
      elements,
      focus(node: Node | undefined) {
        focused = node;
      },
      finish_load() {
        win.location.href = `chrome://browser/content/${type}.xhtml`;
        win.document.readyState = "complete";
        win.document.documentElement.getAttribute = (name: string) => (name === "windowtype" ? type : null);
        own.fire("load", key_event("load"));
      },
      show(node: Node) {
        if (!shown.includes(node)) shown.push(node);
        own.fire("popupshown", key_event("popupshown", { originalTarget: node, target: node }));
      },
      hide(node: Node & { state: string }) {
        node.state = "closed";
        own.fire("popuphidden", key_event("popuphidden", { originalTarget: node, target: node }));
      },
      // The window root hears a key first, then the window's capture listeners (the core's).
      press(key: string, patch: Partial<FakeEvent> = {}) {
        const event = key_event(key, { target: focused, originalTarget: focused, ...patch });
        root.fire("keydown", event);
        if (!event.stopped) own.fire("keydown", event);
        return event;
      },
      listener_count: () => own.count() + root.count(),
    };
    open_windows.push(record);
    return record;
  }

  if (start_extension) firefox.start_extension();
  if (state !== null && start_extension) firefox.write_state(state);
  const fake_browser = firefox.make_window();
  const browser = chrome_window("navigator:browser", { browser_window: fake_browser });
  const tab = fake_browser.add_tab();
  // The first window loads the core and the feature files, as the loader does.
  fake_browser.load();
  const open = (type: string, { loaded = false } = {}) => {
    const record = chrome_window(type, { loaded });
    notify_open(record.win);
    return record;
  };
  const notify_open = (win: unknown) => [...watchers].forEach((watcher) => watcher.observe(win, "domwindowopened"));
  const notify_closed = (win: unknown) => [...watchers].forEach((watcher) => watcher.observe(win, "domwindowclosed"));
  const run_timers = () => timers.splice(0).forEach((run) => run());
  return {
    firefox,
    browser,
    tab,
    open,
    notify_open,
    notify_closed,
    typed,
    run_timers,
    watcher_count: () => watchers.size,
    refuse_typing: () => (refuse_typing = true),
  };
}

test("in an open menu j, k, h and l become the four arrow keys once the letter's event is over", () => {
  const { browser, typed, run_timers, tab } = setup();
  browser.focus(tab.browser as Node);
  const menu = popup("menupopup", "contentAreaContextMenu");
  browser.show(menu);
  for (const key of ["j", "k", "h", "l"]) {
    const event = browser.press(key);
    assert.ok(event.prevented && event.stopped, `${key} was not taken`);
  }
  assert.deepEqual(typed, [], "an arrow key went out inside the letter's event");
  run_timers();
  assert.deepEqual(
    typed.map(({ key }) => key),
    ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"],
  );
});

test("the walk takes the letter before the core, so a scroll key row does not scroll the page under a menu", () => {
  const { firefox, browser, tab, typed, run_timers } = setup({ state: { v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: [{ key: "j", id: "scroll.lines", args: { count: 1 } }], tabs: {} } });
  browser.focus(tab.browser as Node);
  browser.press("j");
  assert.equal(firefox.sent_to_frames.length, 1, "with no menu open the core scrolls");
  browser.show(popup("menupopup"));
  browser.press("j");
  run_timers();
  assert.equal(firefox.sent_to_frames.length, 1, "the core scrolled under the menu");
  assert.deepEqual(typed.map(({ key }) => key), ["ArrowDown"]);
});

test("the app menu and the downloads panel walk, a permission prompt and a plain panel do not", () => {
  const { browser, tab, typed, run_timers } = setup();
  browser.focus(tab.browser as Node);
  const prompt = popup("panel", "notification-popup");
  browser.show(prompt);
  assert.equal(browser.press("j").prevented, false, "j was taken under a permission prompt with the focus in the page");
  const plain = popup("panel", "identity-box-panel");
  browser.show(plain);
  assert.equal(browser.press("j").prevented, false, "j was taken in a panel with no multi-view");
  const downloads = popup("panel", "downloadsPanel");
  browser.show(downloads);
  assert.ok(browser.press("j").prevented);
  run_timers();
  browser.hide(downloads);
  const app_menu = popup("panel", "appMenu-popup", {}, true);
  browser.show(app_menu);
  assert.ok(browser.press("l").prevented);
  run_timers();
  browser.hide(app_menu);
  assert.equal(browser.press("j").prevented, false, "j was taken after the app menu closed");
  assert.deepEqual(typed.map(({ key }) => key), ["ArrowDown", "ArrowRight"]);
});

test("another extension's popup keeps its keys, but a menu open over it walks", () => {
  const { browser, typed, run_timers } = setup();
  const popup_browser = { localName: "browser", isRemoteBrowser: true, closest: (selector: string) => (selector === "panel" ? {} : null) };
  browser.focus(popup_browser);
  browser.show(popup("panel", "customizationui-widget-panel", {}, true));
  assert.equal(browser.press("j").prevented, false);
  browser.show(popup("menupopup"));
  assert.ok(browser.press("j").prevented);
  run_timers();
  assert.equal(typed.length, 1);
});

test("a field keeps its letters, unless a menu that takes keys is open over it", () => {
  const { browser, typed, run_timers } = setup();
  const field = { localName: "input", type: "text" };
  browser.focus(field);
  browser.show(popup("panel", "appMenu-popup", {}, true));
  assert.equal(browser.press("j").prevented, false, "j was taken from a field in a panel");
  const suggestions = popup("menupopup", "", { ignorekeys: "true" });
  browser.show(suggestions);
  assert.equal(browser.press("j").prevented, false, "j was taken through a menu that leaves keys to its field");
  browser.show(popup("menupopup", "menu_FilePopup"));
  assert.ok(browser.press("j").prevented, "a menu bar menu over the address bar did not walk");
  run_timers();
  assert.equal(typed.length, 1);
});

test("the core types from a field for menu_owns_keys only while it sees a menu that takes keys, at the call and when it types, and never into DevTools", () => {
  const { firefox, browser, typed, run_timers } = setup();
  type TypeKey = (win: unknown, key: string, still_holds: () => boolean, options?: { menu_owns_keys?: boolean }) => boolean;
  const type_key = (firefox.Services.desertfox_browser_module as { type_key: TypeKey }).type_key;
  const owns = { menu_owns_keys: true };
  browser.focus({ localName: "input", type: "text" });
  assert.equal(type_key(browser.win, "ArrowDown", () => true, owns), false, "the flag alone let a key into a field");
  browser.show(popup("menupopup", "", { ignorekeys: "true" }));
  assert.equal(type_key(browser.win, "ArrowDown", () => true, owns), false, "a menu that leaves keys to its field let a key in");
  const menu = popup("menupopup", "menu_FilePopup");
  browser.show(menu);
  assert.equal(type_key(browser.win, "ArrowDown", () => true), false, "an open menu let a key into a field without the flag");
  assert.equal(type_key(browser.win, "ArrowDown", () => true, owns), true);
  run_timers();
  assert.deepEqual(typed.map(({ key }) => key), ["ArrowDown"]);
  assert.equal(type_key(browser.win, "ArrowUp", () => true, owns), true);
  browser.hide(menu);
  run_timers();
  assert.deepEqual(typed.map(({ key }) => key), ["ArrowDown"], "the key went into the field after the menu closed");
  browser.show(menu);
  menu.state = "open";
  browser.focus({ localName: "input", type: "text", ownerDocument: { documentURI: "about:devtools-toolbox" } });
  assert.equal(type_key(browser.win, "ArrowDown", () => true, owns), false, "typed into DevTools under a menu");
});

const J_SCROLL_AND_J_HINTS = { v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: [{ key: "j", id: "scroll.lines", args: { count: 1 } }], tabs: {}, chrome_hint_keys: [["j", "B"]] };

test("with a hint binding that starts with j, an open panel the page's focus sits outside of still walks on j, and the page does not scroll", () => {
  const { firefox, browser, tab, typed, run_timers } = setup({ state: J_SCROLL_AND_J_HINTS });
  browser.focus(tab.browser as Node);
  for (const panel of [popup("panel", "downloadsPanel"), popup("panel", "appMenu-popup", {}, true)]) {
    browser.show(panel);
    assert.ok(browser.press("j").prevented, `${panel.id} did not walk`);
    run_timers();
    browser.hide(panel);
  }
  assert.equal(firefox.sent_to_frames.length, 0, "the core scrolled the page under a walking panel");
  assert.deepEqual(typed.map(({ key }) => key), ["ArrowDown", "ArrowDown"]);
});

test("a key that waits for chrome hints is not walked when the core took it meanwhile, as in a list of a dialog inside a page", () => {
  const { firefox, browser, tab, typed, run_timers } = setup({ state: J_SCROLL_AND_J_HINTS });
  const frame = { classList: { contains: (name: string) => name === "dialogFrame" } };
  const dialog_doc = { defaultView: { browsingContext: { isContent: true, top: { embedderElement: tab.browser }, embedderElement: frame } } };
  browser.focus({ localName: "richlistbox", ownerDocument: dialog_doc });
  browser.press("j");
  run_timers();
  assert.equal(firefox.sent_to_frames.length, 1, "the core did not take its row");
  assert.deepEqual(typed, [], "the walk typed an arrow key for a key the core took");
});

test("menu_owns_keys finds a menu open in a dialog's own document, where the focused field is", () => {
  const { firefox, browser, typed, run_timers } = setup();
  type TypeKey = (win: unknown, key: string, still_holds: () => boolean, options?: { menu_owns_keys?: boolean }) => boolean;
  const type_key = (firefox.Services.desertfox_browser_module as { type_key: TypeKey }).type_key;
  const dialog_menu = popup("menupopup");
  const dialog_doc = { querySelectorAll: (selector: string) => (selector === "menupopup" ? [dialog_menu] : []) };
  browser.focus({ localName: "input", type: "text", ownerDocument: dialog_doc });
  assert.equal(type_key(browser.win, "ArrowDown", () => true, { menu_owns_keys: true }), true, "a menu in the dialog's document was not seen");
  run_timers();
  assert.deepEqual(typed.map(({ key }) => key), ["ArrowDown"]);
});

test("only a plain trusted letter walks: no modifier, no capital, no composition, no untrusted or prevented key", () => {
  const { browser, typed } = setup();
  browser.show(popup("menupopup"));
  for (const patch of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isTrusted: false }, { isComposing: true }, { defaultPrevented: true }]) assert.equal(browser.press("j", patch).prevented, false, JSON.stringify(patch));
  assert.equal(browser.press("J").prevented, false);
  assert.equal(browser.press("x").prevented, false);
  assert.equal(typed.length, 0);
});

test("the walk follows the module's gates: the pref, DesertFox, the state and its switch, and private access", () => {
  for (const options of [{ pref: false }, { start_extension: false }, { state: null }, { state: { v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: false, keys: [], tabs: {} } }, { state: { v: BROWSER_MODULE_PROTOCOL_VERSION + 1, enabled: true, keys: [], tabs: {} } }]) {
    const { browser } = setup(options);
    browser.show(popup("menupopup"));
    assert.equal(browser.press("j").prevented, false, JSON.stringify(options));
  }
  const { firefox, browser } = setup();
  browser.show(popup("menupopup"));
  Object.assign(browser.win, { private_window: true });
  assert.equal(browser.press("j").prevented, false, "j walked in a private window without private access");
  firefox.extension!.privateBrowsingAllowed = true;
  assert.ok(browser.press("j").prevented);
});

test("the arrow key is dropped when the menu closed or the window closed before it went out", () => {
  const { browser, typed, run_timers } = setup();
  const menu = popup("menupopup");
  browser.show(menu);
  browser.press("j");
  browser.hide(menu);
  run_timers();
  assert.deepEqual(typed, [], "the arrow key went to whatever was under the closed menu");
});

test("a window that closes before the arrow key goes out gets none, and refused typing logs one line", () => {
  const walk = setup();
  const library = walk.open("Places:Organizer");
  library.finish_load();
  library.focus({ localName: "tree", id: "placesList" });
  assert.ok(library.press("j").prevented);
  library.win.close();
  walk.run_timers();
  assert.deepEqual(walk.typed, []);

  const refused = setup();
  refused.browser.show(popup("menupopup"));
  refused.refuse_typing();
  refused.browser.press("j");
  refused.browser.press("j");
  refused.run_timers();
  assert.equal(refused.firefox.errors.filter((line) => line.includes("refused to type")).length, 1);
});

test("the Library, Page Info and Picture-in-Picture walk with no popup open, attached once when they load", () => {
  const { open, typed, run_timers } = setup();
  for (const type of ["Places:Organizer", "Browser:page-info", "Toolkit:PictureInPicture"]) {
    const record = open(type);
    assert.equal(record.press("j").prevented, false, `${type} walked before its document loaded`);
    record.finish_load();
    record.focus({ localName: "tree" });
    assert.ok(record.press("j").prevented, type);
  }
  run_timers();
  assert.deepEqual(typed, [
    { window: "Places:Organizer", key: "ArrowDown" },
    { window: "Browser:page-info", key: "ArrowDown" },
    { window: "Toolkit:PictureInPicture", key: "ArrowDown" },
  ]);
  const other = open("Toolkit:dialog");
  other.finish_load();
  assert.equal(other.listener_count(), 0, "a window of another type got a listener");
});

test("a window already open at start is attached once, even when its open notice comes too", () => {
  const walk = setup();
  // The browser window was open when the feature started, so the enumerator gave it.
  const before = walk.browser.root.count();
  assert.equal(before, 1);
  walk.notify_open(walk.browser.win);
  assert.equal(walk.browser.root.count(), before);
  walk.browser.show(popup("menupopup"));
  walk.browser.press("j");
  walk.run_timers();
  assert.equal(walk.typed.length, 1, "a doubled listener typed two arrow keys");
});

test("Escape closes the Library from a tree with no search text, and not from the search box, with text or under a menu", () => {
  const walk = setup();
  const library = walk.open("Places:Organizer");
  library.finish_load();
  const search = { localName: "input", type: "search", value: "" };
  library.elements.set("searchFilter", search);
  library.focus(search);
  assert.equal(library.press("Escape").prevented, false, "Escape was taken in the search box");
  library.focus({ localName: "tree", id: "placesList" });
  search.value = "fox";
  assert.equal(library.press("Escape").prevented, false, "Escape closed the Library with search text");
  search.value = "";
  const menu = popup("menupopup", "placesContext");
  library.show(menu);
  assert.equal(library.press("Escape").prevented, false, "Escape closed the Library under its context menu");
  library.hide(menu);
  assert.equal(library.press("Escape", { shiftKey: true }).prevented, false);
  assert.ok(library.press("Escape").prevented);
  assert.equal(library.win.closed, false, "the Library closed inside the key's event");
  walk.run_timers();
  assert.equal(library.win.closed, true);
  assert.equal(walk.browser.press("Escape").prevented, false, "Escape was taken in a browser window");
});

test("a dialog list in the browser window walks, the browser window's own lists do not", () => {
  const { browser, typed, run_timers } = setup();
  const dialog_doc = { defaultView: { browsingContext: { embedderElement: { classList: { contains: (name: string) => name === "dialogFrame" } } } } };
  const list = { localName: "richlistbox", ownerDocument: dialog_doc };
  browser.focus(list);
  assert.ok(browser.press("j").prevented);
  run_timers();
  browser.focus({ localName: "richlistbox", ownerDocument: browser.win.document });
  assert.equal(browser.press("j").prevented, false);
  browser.focus(list);
  browser.press("k");
  browser.focus(undefined);
  run_timers();
  assert.deepEqual(typed.map(({ key }) => key), ["ArrowDown"], "the arrow key went out after the focus left the list");
});

test("closing a window takes its listeners, and the core turning off takes the whole walk down at once", () => {
  const walk = setup();
  const library = walk.open("Places:Organizer");
  library.finish_load();
  assert.ok(library.listener_count() > 0);
  library.win.close();
  assert.equal(library.listener_count(), 0, "a closed window kept a listener");
  const closed_early = walk.open("Browser:page-info");
  closed_early.win.close();
  walk.notify_closed(closed_early.win);
  assert.equal(closed_early.listener_count(), 0, "a window that closed before it loaded kept a listener");
  const pending = walk.open("Browser:page-info");
  const core = walk.firefox.Services.desertfox_browser_module as { shut_down(): void };
  walk.firefox.Services.desertfox_browser_module = "off";
  core.shut_down();
  assert.equal(walk.browser.listener_count(), 0, "the browser window kept a listener");
  assert.equal(walk.watcher_count(), 0, "the window watcher stayed");
  assert.equal(pending.listener_count(), 0, "a window still loading kept its load listener");
  pending.finish_load();
  assert.equal(pending.listener_count(), 0, "a window that loaded after the turn off got a listener");
});

test("a page field in another process keeps its letters under an open panel, as the window's input state says", () => {
  const { browser, tab, typed, run_timers } = setup();
  browser.focus(tab.browser as Node);
  Object.assign(browser.win, { windowUtils: { IMEStatus: IME_ENABLED } });
  browser.show(popup("panel", "downloadsPanel"));
  assert.equal(browser.press("j").prevented, false, "j was taken from a page field under the downloads panel");
  Object.assign(browser.win, { windowUtils: { IMEStatus: 0 } });
  assert.ok(browser.press("j").prevented);
  Object.assign(browser.win, { windowUtils: { IMEStatus: IME_ENABLED } });
  run_timers();
  assert.deepEqual(typed, [], "the arrow key went out after a page field took the focus");
});

test("a walk that fails to start logs one line and leaves the core and its keys running", () => {
  const { firefox, browser, tab } = setup({ fail_watcher: true, state: { v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: [{ key: "J", id: "tab.next", args: {} }], tabs: {} } });
  assert.ok(firefox.errors.some((line) => line.includes("popup walk is off")), firefox.errors.join("; "));
  const core = firefox.Services.desertfox_browser_module as { status(): { active: boolean } };
  assert.equal(typeof core, "object");
  assert.equal(core.status().active, true);
  browser.focus(tab.browser as Node);
  browser.show(popup("menupopup"));
  assert.equal(browser.root.count(), 0, "the failed walk left a listener");
  assert.ok(browser.press("J").prevented, "the core stopped taking its keys");
});

test("the focus is read through a frame of this process, and a frame with no focused element ends the search", () => {
  const { browser, typed, run_timers } = setup();
  const dialog_doc = { defaultView: { browsingContext: { embedderElement: { classList: { contains: (name: string) => name === "dialogFrame" } } } }, activeElement: undefined as unknown };
  const list = { localName: "radiogroup", ownerDocument: dialog_doc };
  dialog_doc.activeElement = list;
  const frame = { localName: "browser", isRemoteBrowser: false, contentDocument: dialog_doc };
  browser.focus(frame);
  assert.ok(browser.press("j").prevented, "a radio group in a dialog frame did not walk");
  run_timers();
  dialog_doc.activeElement = undefined;
  assert.equal(browser.press("j").prevented, false);
  assert.deepEqual(typed.map(({ key }) => key), ["ArrowDown"]);
});

test("the walk leaves a window's keys alone while another feature holds them in the core", () => {
  const { firefox, browser, tab, typed, run_timers } = setup();
  const core = firefox.Services.desertfox_browser_module as { hold_keys(win: unknown, owner: string): void; release_keys(win: unknown, owner: string): void };
  browser.focus(tab.browser as Node);
  browser.show(popup("menupopup"));
  core.hold_keys(browser.win, "chrome_hints");
  assert.equal(browser.press("j").prevented, false, "the walk took a key another feature holds");
  core.release_keys(browser.win, "popup_walk");
  assert.equal(browser.press("j").prevented, false, "another owner's release ended the hold");
  core.release_keys(browser.win, "chrome_hints");
  assert.ok(browser.press("j").prevented, "the walk stayed off after the hold ended");
  run_timers();
  assert.deepEqual(typed.map(({ key }) => key), ["ArrowDown"]);
});

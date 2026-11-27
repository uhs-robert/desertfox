// The chrome hints feature (browser_module/desertfox-chrome-hints.js) where no content script hears a key: a tab's prompt, a settings sub-dialog, the Library and Page Info.
// It drives the start from the user's own binding (the token's single use, expiry and window), what each place labels, and every end that must take the hold back.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { create_firefox, IME_ENABLED, key_event, source_of } from "./fake_firefox.ts";
import type { FakeEvent } from "./fake_firefox.ts";
import { Node } from "./chrome_dom.ts";
import type { Box } from "./chrome_dom.ts";

const FILE = "desertfox-chrome-hints.js";
const WALK_FILE = "desertfox-popup-walk.js";
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));
const box = (left: number, top: number, width = 60, height = 24): Box => ({ left, top, width, height });
const STATE = { v: 1, enabled: true, keys: [], tabs: {}, chrome_hint_keys: [["g", "B"]] };

type Firefox = ReturnType<typeof create_firefox>;

// A document of chrome: its elements hang under `root`, and the hit test finds the last element whose box holds the point.
function chrome_document(root: Node, view: unknown) {
  const holder = new Node("#root");
  holder.append(root);
  let focused: Node | undefined;
  const document = {
    readyState: "complete",
    documentElement: root,
    defaultView: view,
    commandDispatcher: {
      get focusedElement() {
        return focused;
      },
    },
    createElementNS: (_ns: string, name: string) => new Node(name),
    getElementById: (id: string) => holder.descendants().find((node) => node.id === id) ?? null,
    querySelectorAll: (selector: string) => holder.querySelectorAll(selector),
    elementFromPoint: (x: number, y: number) =>
      [...holder.descendants(), ...holder.descendants().flatMap((node) => node.openOrClosedShadowRoot?.descendants() ?? [])]
        .filter((node) => node.box.width > 0 && !node.attrs.has("covered") && x >= node.box.left && x <= node.box.left + node.box.width && y >= node.box.top && y <= node.box.top + node.box.height)
        .at(-1) ?? null,
  };
  const own = (node: Node) => {
    node.ownerDocument = document;
    node.children.forEach(own);
    if (node.openOrClosedShadowRoot) own(node.openOrClosedShadowRoot);
  };
  return { document, focus: (node: Node | undefined) => (focused = node), own: () => own(root) };
}

// A top-level chrome window of `type`. `build` fills its document element.
function chrome_window(firefox: Firefox, type: string, build: (root: Node) => void) {
  const root = new Node("window");
  root.setAttribute("windowtype", type);
  build(root);
  const timers: { run: () => void; live: boolean }[] = [];
  const window_root = new Node("#windowroot");
  const win = Object.assign(new Node("#window"), {
    innerWidth: 1200,
    innerHeight: 800,
    closed: false,
    windowRoot: window_root,
    windowUtils: { IMEStatus: 0 },
    location: { href: "chrome://test/content/window.xhtml" },
    gBrowser: type === "navigator:browser" ? { selectedTab: null } : undefined,
    setTimeout: (run: () => void) => timers.push({ run, live: true }) - 1,
    clearTimeout: (handle: number) => void (timers[handle] && (timers[handle]!.live = false)),
  });
  const doc = chrome_document(root, win);
  Object.assign(win, { document: doc.document });
  doc.own();
  const id = firefox.windows_by_id.size + 1;
  firefox.windows_by_id.set(id, win);
  const press = (key: string, patch: Partial<FakeEvent> = {}) => window_root.fire("keydown", key_event(key, patch));
  const layers = () => root.children.filter((child) => child.className === "desertfox-chrome-hints");
  const labels = () => layers().flatMap((host) => host.shadow!.children.find((child) => child.className === "desertfox-hints")!.children.map((node) => ({ text: node.textContent, left: node.style.left, top: node.style.top })));
  const fire_timers = () => timers.filter((timer) => timer.live).forEach((timer) => ((timer.live = false), timer.run()));
  return { id, win, root, window_root, press, layers, labels, fire_timers, timers, focus: doc.focus, own: doc.own };
}

const button = (id: string, left: number, top = 10, local_name = "toolbarbutton") => new Node(local_name, { id, box: box(left, top) });

function library(firefox: Firefox) {
  const back = button("back-button", 10);
  const organize = button("organize", 80, 10, "menu");
  const search = new Node("input", { id: "searchFilter", box: box(300, 10, 200) });
  const list = new Node("richlistbox", { id: "downloadsListBox", box: box(10, 100, 500, 300) });
  const retry = button("retry", 400, 120, "button");
  list.append(retry);
  const window = chrome_window(firefox, "Places:Organizer", (root) => root.append(back, organize, search, list));
  window.focus(new Node("tree", { id: "placeContent" }));
  return { ...window, back, organize, search, retry };
}

function page_info(firefox: Firefox) {
  const general = button("generalTab", 10, 10, "radio");
  const security = button("securityTab", 80, 10, "radio");
  const perms = new Node("vbox", { id: "permList", box: box(10, 100, 500, 300) });
  const allow = button("perm-allow", 20, 120, "radio");
  perms.append(allow);
  const window = chrome_window(firefox, "Browser:page-info", (root) => root.append(general, security, perms));
  window.focus(general);
  return { ...window, general, security, allow };
}

// A browser window with a dialog in a `dialogFrame`: a tab's prompt at the frame's place, or a settings sub-dialog inside about:preferences inside a tab.
function browser_with_dialog(firefox: Firefox, { nested = false } = {}) {
  const window = chrome_window(firefox, "navigator:browser", (root) => root.append(button("reload-button", 10)));
  const outer = nested ? new Node("browser", { box: box(0, 80, 1200, 700) }) : undefined;
  const frame = Object.assign(new Node("browser", { box: box(300, 200, 400, 200) }), { classList: { contains: (name: string) => name === "dialogFrame" }, clientLeft: 0, clientTop: 0 });
  const dialog_view = Object.assign(new Node("#dialogwindow"), { browsingContext: { embedderElement: frame } });
  const dialog_root = new Node("window");
  const field = new Node("input", { id: "loginTextbox", box: box(20, 60, 200) });
  const dialog = new Node("dialog", { box: box(0, 0, 400, 200) });
  const shadow = new Node("#shadow");
  const accept = button("accept", 200, 150, "button");
  const cancel = button("cancel", 300, 150, "button");
  shadow.append(accept, cancel);
  dialog.openOrClosedShadowRoot = shadow;
  shadow.host = dialog;
  dialog_root.append(field, dialog);
  const dialog_doc = chrome_document(dialog_root, dialog_view);
  dialog_doc.own();
  if (outer) {
    const prefs_view = { browsingContext: { embedderElement: outer } };
    const prefs_root = new Node("html");
    prefs_root.append(frame);
    const prefs_doc = chrome_document(prefs_root, prefs_view);
    prefs_doc.own();
    window.root.append(outer);
  } else window.root.append(frame);
  window.own();
  window.focus(accept);
  return { ...window, frame, dialog_view, field, accept, cancel, dialog_doc };
}

function started(make: (firefox: Firefox) => ReturnType<typeof chrome_window> & Record<string, unknown>, { walk = false, state = STATE as unknown } = {}) {
  const extra_files: Record<string, string> = { [FILE]: source_of(FILE) };
  if (walk) extra_files[WALK_FILE] = source_of(WALK_FILE);
  const firefox = create_firefox({ extra_files });
  const extension = firefox.start_extension();
  Object.assign(extension, { baseURI: { resolve: (path: string) => `moz-extension://uuid/${path}` } });
  firefox.write_state(state);
  const typed: string[] = [];
  firefox.Components.interfaces.nsITextInputProcessor = {};
  firefox.Components.classes["@mozilla.org/text-input-processor;1"] = {
    createInstance: () => ({ beginInputTransaction: () => true, keydown: (event: { key: string }) => typed.push(event.key), keyup: () => undefined }),
  };
  const chrome = make(firefox);
  Object.assign(chrome.win, { KeyboardEvent: class { key: string; constructor(_type: string, init: { key: string }) { this.key = init.key; } } });
  const windows: unknown[] = [chrome.win];
  const watchers: { observe(subject: unknown, topic: string): void }[] = [];
  Object.assign(firefox.Services, {
    ww: { registerNotification: (watcher: never) => watchers.unshift(watcher), unregisterNotification: (watcher: never) => watchers.splice(watchers.indexOf(watcher), 1) },
    wm: { getEnumerator: () => windows },
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
  const tokens = () => pushes("chrome_hints.want").map((args) => args.start as number);
  const target_rows = (): number[][] => pushes("chrome_hints.targets").flatMap((args) => JSON.parse(args.targets as string) as number[][]);
  const collect_here = async (session: number, start = tokens().at(-1)!) => {
    const id = send("chrome_hints.collect_here", { session, start, colors: "" });
    await settle();
    return reply(id);
  };
  const draw = async (session: number, rows: [number, string][], gen = 1) => {
    send("chrome_hints.draw", { session, gen, part: 0, parts: 1, typed: "", labels: JSON.stringify(rows) });
    await settle();
  };
  const pick = async (session: number, id: number) => {
    const request = send("chrome_hints.pick", { session, id });
    await settle();
    return reply(request);
  };
  const held = (win: unknown = chrome.win) => (firefox.Services.desertfox_browser_module as { keys_held_by(win: unknown): unknown }).keys_held_by(win);
  const type_binding = () => [chrome.press("g"), chrome.press("B")];
  // Another window the watcher hears of, as Firefox opens one.
  const open_window = (other: ReturnType<typeof chrome_window>) => {
    for (const watcher of [...watchers]) watcher.observe(other.win, "domwindowopened");
  };
  return { firefox, chrome, send, from_module, reply, pushes, tokens, target_rows, collect_here, draw, pick, held, type_binding, typed, open_window };
}

test("the binding typed in the Library holds the keys from its first key, asks the extension once with a token, and the controls there get labels", async () => {
  const run = started(library);
  const first = run.chrome.press("g");
  assert.ok(first.prevented, "the binding's first key went on to the tree");
  assert.equal(run.held(), "chrome_hints.prefix");
  assert.ok(run.chrome.press("B").prevented);
  assert.equal(run.held(), "chrome_hints");
  assert.equal(run.tokens().length, 1);
  assert.ok(protocol.validate_message_list(run.from_module(), protocol.MODULE_TO_EXTENSION_KINDS, Date.now()).ok);
  assert.deepEqual(await run.collect_here(5), { v: 1, reply_to: "r0", ok: true });
  const rows = run.target_rows();
  assert.deepEqual(rows.map((row) => row.slice(1)), [[10, 10, 60, 24], [80, 10, 60, 24]], "the search field or a download row got a label");
  assert.equal(run.chrome.layers().length, 1);
  await run.draw(5, [[rows[0]![0]!, "a"], [rows[1]![0]!, "s"]]);
  assert.deepEqual(run.chrome.labels(), [{ text: "a", left: "10px", top: "10px" }, { text: "s", left: "80px", top: "10px" }]);
  assert.equal((await run.pick(5, rows[1]![0]!))?.ok, true);
  assert.equal((run.chrome as unknown as { organize: Node }).organize.open, true, "a menu pick did not open the menu");
  assert.equal(run.held(), undefined, "a pick left the keys held");
});

test("a start token works once: a second collect_here with it is refused and starts nothing", async () => {
  const run = started(library);
  run.type_binding();
  const token = run.tokens()[0]!;
  assert.equal((await run.collect_here(5, token))?.ok, true);
  assert.equal((await run.collect_here(6, token))?.error, "The hint key is stale");
  assert.equal(run.pushes("chrome_hints.end").length, 0, "the refused reuse ended the live session");
  assert.equal(run.chrome.layers().length, 1);
  assert.equal((await run.collect_here(7, token + 1))?.error, "The hint key is stale", "a token the module never made opened a session");
});

test("a start token expires: its timer releases the hold, and a late collect_here is refused", async () => {
  const run = started(library);
  run.type_binding();
  run.chrome.fire_timers();
  assert.equal(run.held(), undefined, "an unanswered start kept the window's keys");
  assert.ok(!run.chrome.press("j").prevented, "a key after the start expired was taken");
  assert.equal((await run.collect_here(5))?.error, "The hint key is stale");
  assert.equal(run.chrome.layers().length, 0);
});

test("a token is bound to its window: with another window in front it opens nothing there, and it is spent", async () => {
  const run = started(library);
  run.type_binding();
  const token = run.tokens()[0]!;
  const other = page_info(run.firefox);
  (run.firefox.Services.focus as { activeWindow: unknown }).activeWindow = other.win;
  assert.equal((await run.collect_here(5, token))?.error, "The window is not in front");
  assert.equal(other.layers().length + run.chrome.layers().length, 0);
  assert.equal(run.held(other.win), undefined);
  assert.equal(run.held(), undefined, "a refused start kept the keys of its window");
  (run.firefox.Services.focus as { activeWindow: unknown }).activeWindow = run.chrome.win;
  assert.equal((await run.collect_here(6, token))?.error, "The hint key is stale", "a token refused once opened a session later");
});

test("a binding typed in a field, in a page, with no binding listed or past the toolbar switch is left alone", async () => {
  const field = started(library);
  field.chrome.focus((field.chrome as unknown as { search: Node }).search);
  assert.ok(!field.type_binding().some((event) => event.prevented), "a key typed in the search field was taken");
  assert.deepEqual(field.tokens(), []);

  const remote = started(library);
  remote.chrome.win.windowUtils.IMEStatus = IME_ENABLED;
  assert.ok(!remote.type_binding().some((event) => event.prevented));

  const page = started((firefox) => {
    const window = chrome_window(firefox, "navigator:browser", (root) => root.append(button("reload-button", 10)));
    window.focus(new Node("browser", { isRemoteBrowser: true } as never));
    return window;
  });
  assert.ok(!page.type_binding().some((event) => event.prevented), "a key for the page's content script was taken");

  const unbound = started(library, { state: { ...STATE, chrome_hint_keys: undefined } });
  assert.ok(!unbound.type_binding().some((event) => event.prevented));

  const off = started(library, { state: { ...STATE, enabled: false } });
  assert.ok(!off.type_binding().some((event) => event.prevented));
  assert.deepEqual([...field.tokens(), ...remote.tokens(), ...page.tokens(), ...unbound.tokens(), ...off.tokens()], []);
});

test("a key off the binding drops the held first key and is tried alone, and Escape drops it without reaching the window", () => {
  const run = started(library);
  run.chrome.press("g");
  assert.ok(!run.chrome.press("x").prevented, "a key off the binding was taken");
  assert.equal(run.held(), undefined);
  run.chrome.press("g");
  assert.ok(run.chrome.press("Escape").prevented);
  assert.equal(run.held(), undefined);
  run.chrome.press("g");
  run.chrome.win.fire("deactivate");
  assert.equal(run.held(), undefined, "half a binding kept the keys after the window left the front");
  assert.deepEqual(run.tokens(), []);
});

test("Escape, a click, the window leaving the front and the pref off each end a start and release the hold", async () => {
  for (const end of ["Escape", "mousedown", "deactivate", "pref"]) {
    const run = started(library);
    run.type_binding();
    if (end === "Escape") assert.ok(run.chrome.press("Escape").prevented);
    else if (end === "pref") run.firefox.set_pref(false);
    else run.chrome.win.fire(end);
    assert.equal(run.held(), undefined, end);
    assert.notEqual((await run.collect_here(5))?.ok, true, end);
  }
});

test("keys typed while the extension answers wait for the labels, and the popup walk leaves them alone", async () => {
  const run = started(library, { walk: true });
  run.chrome.press("j");
  run.chrome.fire_timers();
  assert.deepEqual(run.typed, ["ArrowDown"], "the walk is not attached to the Library, so the test proves nothing");
  run.type_binding();
  // No timer runs here: the start's own timer would expire it. A walk key would wait in a timer too, which the end of the test runs.
  const early = run.chrome.press("j");
  assert.ok(early.prevented);
  assert.equal((await run.collect_here(5))?.error, undefined);
  assert.deepEqual(run.pushes("chrome_hints.key"), []);
  const rows = run.target_rows();
  await run.draw(5, [[rows[0]![0]!, "j"], [rows[1]![0]!, "k"]]);
  run.chrome.press("k");
  run.chrome.fire_timers();
  assert.deepEqual(run.pushes("chrome_hints.key").map((args) => args.key), ["j", "k"]);
  assert.deepEqual(run.typed, ["ArrowDown"], "the walk moved the tree on a key meant for the labels");
});

test("in a tab's prompt the buttons in the dialog's shadow root get labels at their place in the window, the prompt's field gets none, and a pick clicks", async () => {
  const run = started(browser_with_dialog);
  run.type_binding();
  assert.equal((await run.collect_here(5))?.ok, true);
  const rows = run.target_rows();
  assert.deepEqual(rows.map((row) => row.slice(1)), [[500, 350, 60, 24], [600, 350, 60, 24]]);
  await run.draw(5, [[rows[0]![0]!, "a"], [rows[1]![0]!, "s"]]);
  assert.deepEqual(run.chrome.labels().map((label) => [label.left, label.top]), [["500px", "350px"], ["600px", "350px"]]);
  assert.equal((await run.pick(5, rows[1]![0]!))?.ok, true);
  const chrome = run.chrome as unknown as { cancel: Node; accept: Node; field: Node };
  assert.deepEqual([chrome.cancel.clicks, chrome.accept.clicks], [1, 0]);
});

test("a binding typed in the prompt's field starts nothing, so it types there", () => {
  const run = started(browser_with_dialog);
  run.chrome.focus((run.chrome as unknown as { field: Node }).field);
  assert.ok(!run.type_binding().some((event) => event.prevented));
  assert.deepEqual(run.tokens(), []);
});

test("a settings sub-dialog inside about:preferences adds each frame's place to its buttons' boxes", async () => {
  const run = started((firefox) => browser_with_dialog(firefox, { nested: true }));
  run.type_binding();
  assert.equal((await run.collect_here(5))?.ok, true);
  assert.deepEqual(run.target_rows().map((row) => row.slice(1, 3)), [[500, 430], [600, 430]]);
});

test("a prompt that closes mid-session, or a switch to another tab, ends the session and releases the hold", async () => {
  for (const end of ["unload", "TabSelect", "dialog click"]) {
    const run = started(browser_with_dialog);
    run.type_binding();
    await run.collect_here(5);
    const chrome = run.chrome as unknown as { dialog_view: Node };
    if (end === "unload") chrome.dialog_view.fire("unload");
    else if (end === "dialog click") chrome.dialog_view.fire("mousedown");
    else run.chrome.win.fire("TabSelect");
    assert.deepEqual(run.pushes("chrome_hints.end"), [{ session: 5 }], end);
    assert.equal(run.chrome.layers().length, 0, end);
    assert.equal(run.held(), undefined, end);
    assert.equal(chrome.dialog_view.listener_total(), 0, `${end}: a listener stayed on the dialog`);
    assert.ok(!run.chrome.press("a").prevented, end);
  }
});

test("a pick in a prompt the page replaced is refused, so a page cannot slip another button under a label", async () => {
  const run = started(browser_with_dialog);
  run.type_binding();
  await run.collect_here(5);
  const rows = run.target_rows();
  await run.draw(5, [[rows[0]![0]!, "a"], [rows[1]![0]!, "s"]]);
  const chrome = run.chrome as unknown as { accept: Node };
  chrome.accept.remove();
  assert.equal((await run.pick(5, rows[0]![0]!))?.error, "The hint's target is gone");
  assert.equal(chrome.accept.clicks, 0);
});

test("Page Info labels its sections but not its permission rows, which grant at once", async () => {
  const run = started(page_info);
  run.type_binding();
  assert.equal((await run.collect_here(5))?.ok, true);
  assert.deepEqual(run.target_rows().map((row) => row.slice(1, 3)), [[10, 10], [80, 10]]);
});

test("a session in the Library ends when a newly opened window takes the front, and the new window takes the binding too", async () => {
  const run = started(library);
  run.type_binding();
  await run.collect_here(5);
  const other = page_info(run.firefox);
  run.open_window(other);
  run.chrome.win.fire("deactivate");
  (run.firefox.Services.focus as { activeWindow: unknown }).activeWindow = other.win;
  assert.deepEqual(run.pushes("chrome_hints.end"), [{ session: 5 }]);
  assert.equal(run.held(), undefined);
  other.press("g");
  other.press("B");
  assert.equal(run.tokens().length, 2, "the new window does not take the binding");
  assert.equal(run.held(other.win), "chrome_hints");
  assert.equal((await run.collect_here(6))?.ok, true);
  assert.equal(other.layers().length, 1);
});

test("the module shutting down mid-start releases the hold and leaves no listener", () => {
  const run = started(library);
  run.type_binding();
  (run.firefox.Services.desertfox_browser_module as { shut_down(): void }).shut_down();
  assert.equal(run.held(), undefined);
  assert.equal(run.chrome.window_root.listener_total(), 0);
  assert.equal(run.chrome.win.listener_total(), 0);
});

// Stand-ins for the chrome windows the chrome hints feature labels with the focus in chrome: a browser window with a dialog in a `dialogFrame`, the Library and Page Info.
// `started` loads the feature into a fake Firefox with one such window in front, and gives the steps a test takes: type the binding, answer with collect_here, draw, pick.
import { BROWSER_MODULE_FROM_EXTENSION_STORAGE_KEY, BROWSER_MODULE_FROM_MODULE_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { create_firefox, key_event, source_of } from "./fake_firefox.ts";
import type { FakeEvent } from "./fake_firefox.ts";
import { Node } from "./chrome_dom.ts";
import type { Box } from "./chrome_dom.ts";

const FILE = "desertfox-chrome-hints.js";
const WALK_FILE = "desertfox-popup-walk.js";
export const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
export const settle = () => new Promise((resolve) => setImmediate(resolve));
export const box = (left: number, top: number, width = 60, height = 24): Box => ({ left, top, width, height });
export const STATE = { v: 1, enabled: true, keys: [], tabs: {}, chrome_hint_keys: [["g", "B"]] };

export type Firefox = ReturnType<typeof create_firefox>;

// A document of chrome: its elements hang under `root`, and the hit test finds the last element whose box holds the point.
export function chrome_document(root: Node, view: unknown, url = "chrome://test/content/window.xhtml") {
  const holder = new Node("#root");
  holder.append(root);
  let focused: Node | undefined;
  const document = {
    readyState: "complete",
    documentURI: url,
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

// Where each window's `performance` clock starts, in ms since the epoch. A dialog frame's window loads later than the browser window, so its clock reads less at the same moment.
export const WINDOW_ORIGIN = 1_700_000_000_000;
export const DIALOG_LOADED_MS = 60_000;

// A top-level chrome window of `type`. `build` fills its document element.
export function chrome_window(firefox: Firefox, type: string, build: (root: Node) => void) {
  const root = new Node("window");
  root.setAttribute("windowtype", type);
  build(root);
  const timers: { run: () => void; live: boolean }[] = [];
  const window_root = new Node("#windowroot");
  const clock = { now: 1000 };
  // Each observer the feature makes, with what it watches. `mutate` tells those that watch the attribute.
  const observers: { callback: () => void; watched: { target: Node; filter: string[] }[]; live: boolean }[] = [];
  class MutationObserver {
    record: (typeof observers)[number];
    constructor(callback: () => void) {
      this.record = { callback, watched: [], live: true };
      observers.push(this.record);
    }
    observe(target: Node, options: { attributeFilter: string[] }) {
      this.record.watched.push({ target, filter: options.attributeFilter });
    }
    disconnect() {
      this.record.live = false;
    }
  }
  const mutate = (target: Node, name: string, value: string | null) => {
    if (value === null) target.attrs.delete(name);
    else target.setAttribute(name, value);
    for (const record of observers) if (record.live && record.watched.some((one) => one.target === target && one.filter.includes(name))) record.callback();
  };
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
    performance: { timeOrigin: WINDOW_ORIGIN, now: () => clock.now },
    MutationObserver,
  });
  const doc = chrome_document(root, win);
  Object.assign(win, { document: doc.document });
  doc.own();
  const id = firefox.windows_by_id.size + 1;
  firefox.windows_by_id.set(id, win);
  const press = (key: string, patch: Partial<FakeEvent> = {}) => window_root.fire("keydown", key_event(key, { timeStamp: clock.now, ...patch }));
  const layers = () => root.children.filter((child) => child.className === "desertfox-chrome-hints");
  const labels = () => layers().flatMap((host) => host.shadow!.children.find((child) => child.className === "desertfox-hints")!.children.map((node) => ({ text: node.textContent, left: node.style.left, top: node.style.top })));
  const fire_timers = () => timers.filter((timer) => timer.live).forEach((timer) => ((timer.live = false), timer.run()));
  const live_observers = () => observers.filter((record) => record.live).length;
  return { id, win, root, window_root, press, layers, labels, fire_timers, timers, focus: doc.focus, own: doc.own, clock, mutate, live_observers };
}

export const button = (id: string, left: number, top = 10, local_name = "toolbarbutton") => new Node(local_name, { id, box: box(left, top) });

export function library(firefox: Firefox) {
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

export function page_info(firefox: Firefox) {
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
export const PROMPT_URL = "chrome://global/content/commonDialog.xhtml";

export function browser_with_dialog(firefox: Firefox, { nested = false, url = PROMPT_URL, extra = [] as Node[], prompt_type = "confirm" } = {}) {
  const window = chrome_window(firefox, "navigator:browser", (root) => root.append(button("reload-button", 10)));
  const outer = nested ? new Node("browser", { box: box(0, 80, 1200, 700) }) : undefined;
  const frame = Object.assign(new Node("browser", { box: box(300, 200, 400, 200) }), { classList: { contains: (name: string) => name === "dialogFrame" }, clientLeft: 0, clientTop: 0 });
  const dialog_view = Object.assign(new Node("#dialogwindow"), { browsingContext: { embedderElement: frame }, performance: { timeOrigin: WINDOW_ORIGIN + DIALOG_LOADED_MS, now: () => window.clock.now - DIALOG_LOADED_MS } });
  const dialog_root = new Node("window");
  const field = new Node("input", { id: "loginTextbox", box: box(20, 60, 200) });
  const dialog = new Node("dialog", { id: "commonDialog", box: box(0, 0, 400, 200) });
  // Firefox marks a tab prompt's kind on its dialog element once the prompt has loaded.
  if (prompt_type) dialog.setAttribute("windowtype", `prompt:${prompt_type}`);
  const shadow = new Node("#shadow");
  const accept = button("accept", 200, 150, "button");
  const cancel = button("cancel", 300, 150, "button");
  shadow.append(accept, cancel);
  dialog.openOrClosedShadowRoot = shadow;
  shadow.host = dialog;
  dialog_root.append(field, dialog, ...extra);
  const dialog_doc = chrome_document(dialog_root, dialog_view, url);
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
  // A key typed in the dialog has a target there, so its time is on the dialog's clock.
  const press = (key: string, patch: Partial<FakeEvent> = {}) => window.press(key, { originalTarget: accept, timeStamp: dialog_view.performance.now(), ...patch });
  return { ...window, press, frame, dialog_view, field, accept, cancel, dialog_doc };
}

export function started(make: (firefox: Firefox) => ReturnType<typeof chrome_window> & Record<string, unknown>, { walk = false, state = STATE as unknown } = {}) {
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

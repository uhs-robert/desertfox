// A browser window with a small DOM, so the status bar runs as it does in Firefox: the module's files load into it, the bar draws on a frame, and a test reads the bar's text.
import { create_firefox, source_of } from "./fake_firefox.ts";

export const STATUSBAR_FILE = "desertfox-statusbar.js";
const STATE_KEY = "desertfox_browser_module_state";

export class FakeNode {
  children: FakeNode[] = [];
  parent: FakeNode | undefined;
  attributes = new Map<string, string>();
  style_values = new Map<string, string>();
  id = "";
  className = "";
  text = "";
  tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  style = {
    setProperty: (name: string, value: string) => void this.style_values.set(name, value),
    removeProperty: (name: string) => void this.style_values.delete(name),
  };
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute = (name: string) => this.attributes.get(name) ?? null;
  hasAttribute = (name: string) => this.attributes.has(name);
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  append(...nodes: FakeNode[]) {
    for (const node of nodes) (node.parent = this), this.children.push(node);
  }
  replaceChildren(...nodes: FakeNode[]) {
    this.children = [];
    this.append(...nodes);
  }
  after(node: FakeNode) {
    const siblings = this.parent!.children;
    node.parent = this.parent;
    siblings.splice(siblings.indexOf(this) + 1, 0, node);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = undefined;
  }
  get textContent(): string {
    return this.children.length > 0 ? this.children.map((child) => child.textContent).join("") : this.text;
  }
  set textContent(value: string) {
    this.children = [];
    this.text = value;
  }
  find(predicate: (node: FakeNode) => boolean): FakeNode | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return undefined;
  }
  all(): FakeNode[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

export type BarOptions = { private_window?: boolean; scheme_dark?: boolean; root_style?: Record<string, string>; tab_count?: number };

export function create_bar_fixture(options: BarOptions = {}) {
  const firefox = create_firefox({ extra_files: { [STATUSBAR_FILE]: source_of(STATUSBAR_FILE) } });
  const window = firefox.make_window({ private_window: options.private_window });
  const win = window.win as Record<string, unknown>;
  const root = new FakeNode("html");
  const browser_box = new FakeNode("hbox");
  browser_box.id = "browser";
  const nav_bar = new FakeNode("toolbar");
  nav_bar.id = "nav-bar";
  root.append(nav_bar, browser_box);
  const nodes_by_id = (id: string) => root.find((node) => node.id === id) ?? null;

  const frames: (() => void)[] = [];
  let frame_requests = 0;
  const sheets = new Set<string>();
  const resize_observers: { callback: (entries: unknown[]) => void; observing: unknown; disconnected: boolean }[] = [];
  const listener_counts = new Map<string, number>();
  const scheme = { matches: options.scheme_dark ?? true, listeners: new Set<() => void>() };
  const tabs = Array.from({ length: options.tab_count ?? 1 }, () => window.add_tab());
  let selected = 0;
  const progress_listeners = new Set<unknown>();
  const gBrowser = win.gBrowser as Record<string, unknown>;
  const urls = new Map<unknown, string>();
  Object.defineProperties(gBrowser, Object.getOwnPropertyDescriptors({
    tabContainer: {
      addEventListener: (type: string) => listener_counts.set(type, (listener_counts.get(type) ?? 0) + 1),
      removeEventListener: (type: string) => listener_counts.set(type, (listener_counts.get(type) ?? 0) - 1),
    },
    get selectedTab() {
      return tabs[selected]!.tab;
    },
    get selectedBrowser() {
      const browser = tabs[selected]!.browser as Record<string, unknown>;
      browser.currentURI = { spec: urls.get(browser) ?? "about:blank" };
      return browser;
    },
    get visibleTabs() {
      return tabs.map((each) => each.tab);
    },
    addProgressListener: (listener: unknown) => progress_listeners.add(listener),
    removeProgressListener: (listener: unknown) => progress_listeners.delete(listener),
  }));
  Object.assign(win, {
    document: { documentElement: root, getElementById: nodes_by_id, createElementNS: (_ns: string, tag: string) => new FakeNode(tag) },
    windowUtils: Object.assign(win.windowUtils as object, {
      AUTHOR_SHEET: 2,
      loadSheetUsingURIString: (uri: string) => sheets.add(uri),
      removeSheetUsingURIString: (uri: string) => sheets.delete(uri),
    }),
    requestAnimationFrame: (callback: () => void) => {
      frame_requests++;
      frames.push(callback);
    },
    ResizeObserver: class {
      entry: (typeof resize_observers)[number];
      constructor(callback: (entries: unknown[]) => void) {
        this.entry = { callback, observing: undefined, disconnected: false };
        resize_observers.push(this.entry);
      }
      observe(node: unknown) {
        this.entry.observing = node;
      }
      disconnect() {
        this.entry.disconnected = true;
      }
    },
    getComputedStyle: (node: FakeNode, pseudo?: string) => ({
      marginTop: node.tag === "div" ? "0px" : "",
      marginBottom: "0px",
      paddingLeft: "8px",
      paddingRight: "8px",
      content: pseudo === "::after" ? (options.root_style?.["nav-after"] ?? "none") : "",
      backgroundSize: "12px 12px",
      getPropertyValue: (name: string) => options.root_style?.[name] ?? "",
    }),
    matchMedia: () => ({
      get matches() {
        return scheme.matches;
      },
      addEventListener: (_type: string, listener: () => void) => scheme.listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => scheme.listeners.delete(listener),
    }),
    URL,
  });
  const frame_listeners = () => frames.length;

  const load = () => window.load();
  return {
    firefox,
    window,
    root,
    tabs,
    sheets,
    resize_observers,
    listener_counts,
    progress_listeners,
    scheme,
    frame_requests: () => frame_requests,
    frame_listeners,
    load,
    select: (index: number) => void (selected = index),
    navigate: (index: number, spec: string) => void urls.set(tabs[index]!.browser, spec),
    bar: () => nodes_by_id("desertfox-statusbar"),
    // Runs the frames the bar asked for.
    run_frames: () => {
      const waiting = frames.splice(0);
      waiting.forEach((callback) => callback());
      return waiting.length;
    },
    // What a user sees: the text of each side, one string per widget.
    widgets: (side: "left" | "right") => {
      const bar = nodes_by_id("desertfox-statusbar");
      const holder = bar?.find((node) => node.className === `dfx-side dfx-${side}`);
      return holder?.children.map((child) => child.textContent) ?? [];
    },
    // The size the observer reports for the bar, as Firefox would.
    resize: (width: number, height = 28, char_width = 8) => {
      const bar = nodes_by_id("desertfox-statusbar")!;
      const probe = bar.find((node) => node.className === "dfx-probe")!;
      (probe as unknown as { getBoundingClientRect: () => { width: number } }).getBoundingClientRect = () => ({ width: char_width * 10 });
      (bar as unknown as { getBoundingClientRect: () => { width: number } }).getBoundingClientRect = () => ({ width });
      for (const observer of resize_observers.filter((each) => !each.disconnected)) observer.callback([{ borderBoxSize: [{ blockSize: height }], contentRect: { width } }]);
    },
    state_key: STATE_KEY,
  };
}

export const BAR_CONFIG = { left: ["mode", "pending", "recording"], right: ["container", "scroll", "tabs"], border: "square" };
export const BAR_COLORS = { bg_core: "#0c0e13", mode_normal: "#7fa3c9", mode_insert: "#ffa0a0", mode_ignore: "#717a84", mode_caret: "#f0e68c", mode_visual: "#ffba75", mode_item: "#c695ff", mode_media: "#a3e39a" };

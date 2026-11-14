import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { render_new_tab, run_ticker } from "../src/newtab/render.ts";
import { effective_settings } from "../src/shared/config.ts";
import { CONFIG_STATUS_STORAGE_KEY, FILES_CONFIG_STORAGE_KEY, follow_settings } from "../src/shared/storage_watch.ts";

// Its own file: follow_settings registers a listener on the fake storage, and each test installs a fresh browser.
type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

class FakeNode {
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  className = "";
  textContent = "";
  style: Record<string, string> = {};
  classList = { add: () => {}, remove: () => {} };
  focused = 0;
  tag: string;
  attributes: Record<string, string>;
  constructor(tag: string, attributes: Record<string, string> = {}) {
    this.tag = tag;
    this.attributes = attributes;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  append(...nodes: FakeNode[]) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  appendChild(node: FakeNode) {
    this.append(node);
    return node;
  }
  prepend(node: FakeNode) {
    node.parent = this;
    this.children.unshift(node);
  }
  replaceWith(node: FakeNode) {
    const parent = this.parent!;
    parent.children[parent.children.indexOf(this)] = node;
    node.parent = parent;
    this.parent = null;
  }
  listeners: Record<string, ((event: { preventDefault(): void }) => void)[]> = {};
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  querySelector(_selector: string): FakeNode | null {
    return null;
  }
  replaceChildren(...nodes: FakeNode[]) {
    this.children = [];
    this.append(...nodes);
  }
  getBoundingClientRect() {}
  focus() {
    this.focused++;
  }
}

function install_fakes() {
  const storage_listeners: Listener[] = [];
  const page_listeners = new Map<string, Set<() => void>>();
  const body = new FakeNode("body");
  const scrolls: [number, number][] = [];
  const dom = {
    activeElement: body as FakeNode | null,
    body,
    hidden: false,
    createElement: (tag: string) => new FakeNode(tag),
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
    addEventListener: (type: string, listener: () => void) => void (page_listeners.get(type) ?? page_listeners.set(type, new Set()).get(type)!).add(listener),
    removeEventListener: (type: string, listener: () => void) => void page_listeners.get(type)?.delete(listener),
    querySelector: (_selector: string): FakeNode | null => null,
  };
  Object.assign(globalThis, {
    browser: { storage: { onChanged: { addListener: (listener: Listener) => void storage_listeners.push(listener) } } },
    document: dom,
    window: { scrollX: 0, scrollY: 0, scrollTo: (x: number, y: number) => void scrolls.push([x, y]) },
    CSS: { escape: (text: string) => text },
  });
  const fire = (changes: Record<string, { newValue?: unknown }>, area = "local") => storage_listeners.forEach((listener) => listener(changes, area));
  return { fire, dom, body, scrolls, page_listeners, window: (globalThis as unknown as { window: { scrollX: number; scrollY: number } }).window };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const status_change = { [CONFIG_STATUS_STORAGE_KEY]: { newValue: {} } };

test("follow_settings draws once at start, then once per settings change, and ignores other storage changes", async () => {
  const { fire } = install_fakes();
  const draws: boolean[] = [];
  follow_settings((first) => void draws.push(first));
  await settled();
  fire({ other: { newValue: 1 } });
  fire(status_change, "session");
  fire({ desertfox_theme: { newValue: {} } });
  await settled();
  assert.deepEqual(draws, [true]);
  fire(status_change);
  await settled();
  assert.deepEqual(draws, [true, false]);
});

test("a redraw puts the scroll position and the focused element back, and the first draw does not", async () => {
  const { fire, dom, scrolls, window } = install_fakes();
  const link = new FakeNode("a", { href: "#/commands" });
  dom.activeElement = link;
  const found = new FakeNode("a", { href: "#/commands" });
  const queries: string[] = [];
  dom.querySelector = (selector) => (queries.push(selector), found);
  window.scrollY = 420;
  follow_settings((first) => {
    if (first) return;
    // The redraw loses the place: the page is rebuilt and the browser resets focus and scroll.
    dom.activeElement = dom.body;
    window.scrollY = 0;
  });
  await settled();
  assert.deepEqual(scrolls, []);
  fire(status_change);
  await settled();
  assert.deepEqual(scrolls, [[0, 420]]);
  assert.deepEqual(queries, ['[href="#/commands"]']);
  assert.equal(found.focused, 1);
});

test("a settings change during a draw runs one more draw after it, and never two at once", async () => {
  const { fire } = install_fakes();
  let active = 0;
  let most_active = 0;
  let draws = 0;
  follow_settings(async () => {
    draws++;
    most_active = Math.max(most_active, ++active);
    await settled();
    active--;
  });
  await settled();
  fire(status_change);
  fire(status_change);
  fire(status_change);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(draws, 3);
  assert.equal(most_active, 1);
});

test("run_ticker ticks each second, and stopping it removes the timer and the page listener", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const { page_listeners } = install_fakes();
    let ticks = 0;
    const stop = run_ticker(() => void ticks++);
    assert.equal(page_listeners.get("visibilitychange")?.size, 1);
    mock.timers.tick(3000);
    assert.equal(ticks, 4);
    stop();
    mock.timers.tick(3000);
    assert.equal(ticks, 4);
    assert.equal(page_listeners.get("visibilitychange")?.size, 0);
  } finally {
    mock.timers.reset();
  }
});

test("redrawing the new tab page swaps the page and keeps one clock timer and one listener", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const { body, page_listeners } = install_fakes();
    const readers = { query_tabs: async () => [], bookmark_tree: async () => [], page_is_private: async () => false, closed_sessions: async () => [], visits: async () => [], cached_icons: async () => new Map() };
    const settings = effective_settings({ newtab_clock: true, newtab_links: [{ name: "Docs", url: "https://docs.example/" }] } as never);
    const body_node = body as unknown as HTMLElement;
    await render_new_tab(body_node, settings, readers);
    const first_page = body.children[0]!;
    await render_new_tab(body_node, settings, readers);
    await render_new_tab(body_node, settings, readers);
    assert.equal(body.children.length, 1);
    assert.notEqual(body.children[0], first_page);
    assert.equal(page_listeners.get("visibilitychange")?.size, 1);
    // One interval ticks the date: three draws would write it three times a second.
    const date = body.children[0]!.children[0]!.children[0]!.children.at(-1)!;
    let writes = 0;
    let text = date.textContent;
    Object.defineProperty(date, "textContent", { get: () => text, set: (value: string) => ((text = value), writes++) });
    mock.timers.tick(1000);
    assert.equal(writes, 1);
  } finally {
    mock.timers.reset();
  }
});

test("with newtab_command_hint off the page has no hint button, and a closed tab card restores its session", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const { body } = install_fakes();
    const restored: string[] = [];
    Object.assign((globalThis as unknown as { browser: object }).browser, { sessions: { restore: async (id: string) => void restored.push(id) } });
    // A fresh copy of the module, because it remembers the page of the earlier tests.
    const fresh_module = "../src/newtab/render.ts?hint_off";
    const { render_new_tab } = (await import(fresh_module)) as typeof import("../src/newtab/render.ts");
    const readers = { query_tabs: async () => [], bookmark_tree: async () => [], page_is_private: async () => false, closed_sessions: async () => [{ tab: { sessionId: "7", title: "Gone", url: "https://gone.example/" } }], visits: async () => [], cached_icons: async () => new Map() };
    const find_all = (node: FakeNode, class_name: string): FakeNode[] => [...(node.className.split(" ").includes(class_name) ? [node] : []), ...node.children.flatMap((child) => find_all(child, class_name))];
    await render_new_tab(body as unknown as HTMLElement, effective_settings({ newtab_command_hint: false } as never), readers);
    assert.equal(find_all(body, "command-hint").length, 0);
    const [card] = find_all(body, "tile");
    let prevented = 0;
    card!.listeners["click"]![0]!({ preventDefault: () => void prevented++ });
    assert.deepEqual(restored, ["7"]);
    assert.equal(prevented, 1);
    // A session that is gone falls back to opening the address.
    const opened: string[] = [];
    Object.assign((globalThis as unknown as { browser: object }).browser, { sessions: { restore: async () => Promise.reject(new Error("gone")) }, tabs: { create: async (details: { url: string }) => void opened.push(details.url) } });
    card!.listeners["click"]![0]!({ preventDefault() {} });
    await settled();
    assert.deepEqual(opened, ["https://gone.example/"]);
  } finally {
    mock.timers.reset();
  }
});

test("a reload redraws again at its last write, the files config, because the status key lands before it", async () => {
  const { fire } = install_fakes();
  const draws: boolean[] = [];
  follow_settings((first) => void draws.push(first));
  await settled();
  fire({ [FILES_CONFIG_STORAGE_KEY]: { newValue: {} } });
  await settled();
  assert.deepEqual(draws, [true, false]);
});

test("a failed read during a redraw keeps the old page and its one clock, and stops the new clock", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const { body, page_listeners } = install_fakes();
    // A fresh copy of the module, because it remembers the page of the earlier tests.
    const fresh_module = "../src/newtab/render.ts?failed_read";
    const { render_new_tab } = (await import(fresh_module)) as typeof import("../src/newtab/render.ts");
    const good = { query_tabs: async () => [], bookmark_tree: async () => [], page_is_private: async () => false, closed_sessions: async () => [], visits: async () => [], cached_icons: async () => new Map() };
    const settings = effective_settings({ newtab_clock: true, newtab_recent_tabs: true } as never);
    const body_node = body as unknown as HTMLElement;
    await render_new_tab(body_node, settings, good);
    const old_page = body.children[0]!;
    // read_sections swallows a reader error, so the failure comes from the read as a whole.
    const broken = {
      ...good,
      query_tabs: () => {
        throw new Error("no tabs");
      },
    };
    await assert.rejects(render_new_tab(body_node, settings, broken));
    assert.equal(body.children[0], old_page);
    assert.equal(page_listeners.get("visibilitychange")?.size, 1);
    await render_new_tab(body_node, settings, good);
    assert.notEqual(body.children[0], old_page);
    assert.equal(page_listeners.get("visibilitychange")?.size, 1);
  } finally {
    mock.timers.reset();
  }
});

const find_by_class = (node: FakeNode, class_name: string): FakeNode[] => [...(node.className === class_name ? [node] : []), ...node.children.flatMap((child) => find_by_class(child, class_name))];

test("the IP info line adds a slot only while its setting is on, forgets its answer while off, and a redraw stops the old run", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const real_fetch = globalThis.fetch;
  try {
    const { body } = install_fakes();
    const store: Record<string, unknown> = {};
    const removed: string[] = [];
    let release_first: () => void = () => {};
    const first_gate = new Promise<void>((resolve) => (release_first = resolve));
    let first_started: () => void = () => {};
    const first_request = new Promise<void>((resolve) => (first_started = resolve));
    let requests = 0;
    Object.assign((globalThis as unknown as { browser: object }).browser, {
      windows: { getCurrent: async () => ({ incognito: false }) },
      storage: { onChanged: { addListener: () => {} }, local: { get: async (key: string) => ({ [key]: store[key] }), set: async (items: Record<string, unknown>) => void Object.assign(store, items), remove: async (key: string) => void removed.push(key) } },
    });
    globalThis.fetch = (async () => {
      requests++;
      if (requests === 1) {
        first_started();
        await first_gate;
        return new Response("ip=203.0.113.7\nloc=NO");
      }
      return new Response("ip=198.51.100.9\nloc=SE");
    }) as typeof fetch;
    const fresh_module = "../src/newtab/render.ts?ip_info";
    const { render_new_tab } = (await import(fresh_module)) as typeof import("../src/newtab/render.ts");
    const readers = { query_tabs: async () => [], bookmark_tree: async () => [], page_is_private: async () => false, closed_sessions: async () => [], visits: async () => [], cached_icons: async () => new Map() };
    const body_node = body as unknown as HTMLElement;
    const off = effective_settings({ newtab_clock: true, newtab_ip_info: false } as never);
    await render_new_tab(body_node, off, readers);
    await settled();
    assert.deepEqual(find_by_class(body.children[0]!, "ip-info"), []);
    assert.equal(requests, 0);
    assert.deepEqual([...removed].sort(), ["newtab_net_cache_air", "newtab_net_cache_ip", "newtab_net_cache_weather"], "each card that is off deletes its own answer");

    const on = effective_settings({ newtab_clock: true, newtab_ip_info: true } as never);
    await render_new_tab(body_node, on, readers);
    const [first_slot] = find_by_class(body.children[0]!, "ip-info");
    assert.ok(first_slot);
    await first_request;
    // The redraw swaps the page, which must stop the first run while its request is out.
    await render_new_tab(body_node, on, readers);
    await settled();
    const [second_slot] = find_by_class(body.children[0]!, "ip-info");
    assert.notEqual(second_slot, first_slot);
    release_first();
    await settled();
    assert.equal(first_slot.textContent, "", "the stopped run drew nothing");
    assert.equal(second_slot!.textContent, "198.51.100.9, Sweden");
    assert.equal((store["newtab_net_cache_ip"] as { value: { ip: string } }).value.ip, "198.51.100.9", "the stopped run wrote no cache");
    assert.deepEqual(removed.filter((key) => key === "newtab_net_cache_ip"), ["newtab_net_cache_ip"], "the setting on never forgets");
    const weather_on = effective_settings({ newtab_clock: true, newtab_weather: true, newtab_ip_info: true } as never);
    const removed_before = removed.length;
    await render_new_tab(body_node, weather_on, readers);
    await settled();
    assert.equal(removed.slice(removed_before).includes("newtab_net_cache_weather"), false, "the weather setting on never forgets its answer");
  } finally {
    globalThis.fetch = real_fetch;
    mock.timers.reset();
  }
});

// Last in the file: importing main.ts starts its page followers once.
test("only the first draw of the new tab page follows the new_tab_page redirect", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const listeners: Listener[] = [];
    const saved: Record<string, unknown> = { new_tab_page: "https://start.example/" };
    const replaced: string[] = [];
    const node = (): Record<string, unknown> => ({ style: {}, classList: { add() {}, remove() {} }, append() {}, appendChild: (child: unknown) => child, prepend() {}, setAttribute() {}, getBoundingClientRect() {} });
    Object.assign(globalThis, {
      browser: {
        runtime: { onMessage: { addListener() {} } },
        storage: {
          local: { get: async (key: string) => (key === "desertfox_saved_settings" ? { [key]: saved } : {}), set: async () => {} },
          session: { get: async () => ({}) },
          onChanged: { addListener: (listener: Listener) => void listeners.push(listener) },
        },
      },
      document: { ...node(), head: node(), body: node(), documentElement: node(), hidden: false, createElement: node, createElementNS: node, addEventListener() {}, removeEventListener() {} },
      location: { search: "", replace: (url: string) => void replaced.push(url) },
      window: { scrollX: 0, scrollY: 0, scrollTo() {} },
      CSS: { escape: (text: string) => text },
    });
    await import("../src/newtab/main.ts");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(replaced, ["https://start.example/"]);
    saved.new_tab_page = "https://other.example/";
    listeners.forEach((listener) => listener({ [CONFIG_STATUS_STORAGE_KEY]: { newValue: {} } }, "local"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(replaced, ["https://start.example/"]);
  } finally {
    mock.timers.reset();
  }
});

test("a throw while keeping the view is logged and does not stop later redraws", async () => {
  const { fire, dom } = install_fakes();
  const logged = mock.method(console, "error", () => {});
  try {
    const draws: boolean[] = [];
    Object.defineProperty(dom, "activeElement", { configurable: true, get: () => { throw new Error("no focus"); } });
    follow_settings((first) => void draws.push(first));
    await settled();
    Object.defineProperty(dom, "activeElement", { configurable: true, value: dom.body });
    fire(status_change);
    await settled();
    assert.deepEqual(draws, [false]);
    assert.equal(logged.mock.callCount(), 1);
  } finally {
    logged.mock.restore();
  }
});

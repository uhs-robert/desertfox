import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { render_new_tab, run_ticker } from "../src/newtab/render.ts";
import { effective_settings } from "../src/shared/config.ts";
import { CONFIG_STATUS_STORAGE_KEY, follow_settings } from "../src/shared/storage_watch.ts";

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
    const readers = { query_tabs: async () => [], bookmark_tree: async () => [], page_is_private: async () => false };
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

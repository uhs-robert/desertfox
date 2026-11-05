import assert from "node:assert/strict";
import { test } from "node:test";
import { render_help } from "../src/help/render.ts";
import { parse_route } from "../src/help/route.ts";
import type { Route } from "../src/help/route.ts";
import type { Block } from "../src/help/blocks.ts";

// Just enough DOM for render_help: elements with a class, an id, children, attributes and listeners.
class FakeNode {
  className = "";
  tabIndex = 0;
  hidden = false;
  id = "";
  children: (FakeNode | string)[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  tag: string;
  textContent = "";
  constructor(tag: string) { this.tag = tag; }
  append(...nodes: (FakeNode | string)[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: (FakeNode | string)[]) { this.children = nodes; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, listener: () => void) { this.listeners[name] = listener; }
  find_all(test: (node: FakeNode) => boolean): FakeNode[] {
    const below = this.children.flatMap((child) => (typeof child === "string" ? [] : child.find_all(test)));
    return test(this) ? [this, ...below] : below;
  }
}

const by_class = (name: string) => (node: FakeNode): boolean => node.className === name;

const QUICK_START: Block[] = [
  { kind: "paragraph", inlines: [{ kind: "text", text: "intro" }] },
  { kind: "heading", level: 2, text: "Click with hints" },
  { kind: "heading", level: 2, text: "Which-key" },
  { kind: "heading", level: 2, text: "Which key" },
];

function render(route: Route): FakeNode {
  (globalThis as { document?: unknown }).document = { createElement: (tag: string) => new FakeNode(tag) };
  const root = new FakeNode("body");
  render_help(root as never, { quick_start: QUICK_START, groups: [], warnings: [], settings: [], engines: [] } as never, route, []);
  return root;
}

const parts = (root: FakeNode) => ({
  toggle: root.find_all(by_class("oasisfox-help-sections-toggle"))[0]!,
  list: root.find_all(by_class("oasisfox-help-sections"))[0]!,
});

test("every page lists the Quick Start sections, collapsed behind a button", () => {
  for (const page of ["home", "commands", "quick-start"] as const) {
    const { toggle, list } = parts(render({ page }));
    assert.equal(toggle.tag, "button");
    assert.equal(toggle.attributes["aria-expanded"], "false");
    assert.equal(toggle.attributes["aria-controls"], list.id);
    assert.equal(list.hidden, true);
    assert.equal(toggle.children[0], "▸");
  }
});

test("the toggle expands and collapses the list and flips its glyph", () => {
  const { toggle, list } = parts(render({ page: "quick-start" }));
  toggle.listeners["click"]!();
  assert.equal(list.hidden, false);
  assert.equal(toggle.attributes["aria-expanded"], "true");
  assert.equal(toggle.textContent, "▾");
  toggle.listeners["click"]!();
  assert.equal(list.hidden, true);
  assert.equal(toggle.textContent, "▸");
});

test("heading ids are unique, focusable and match the section links", () => {
  const root = render({ page: "quick-start" });
  const ids = root.find_all((node) => node.tag === "h2").map((node) => node.id);
  assert.deepEqual(ids, ["quick-start-click-with-hints", "quick-start-which-key", "quick-start-which-key-2"]);
  assert.ok(root.find_all((node) => node.tag === "h2").every((node) => node.tabIndex === -1));
  const hrefs = parts(root).list.children.map((link) => (link as FakeNode).attributes["href"]);
  assert.deepEqual(hrefs, ["#section=click-with-hints", "#section=which-key", "#section=which-key-2"]);
});

test("each section link round-trips through the router to its heading", () => {
  const root = render({ page: "home" });
  for (const link of parts(root).list.children as FakeNode[]) {
    const route = parse_route(link.attributes["href"]!);
    assert.equal(route.page, "quick-start");
    const target = render(route).find_all((node) => node.id === `quick-start-${route.section}`);
    assert.equal(target.length, 1);
  }
});

test("a section route opens the list", () => {
  assert.equal(parts(render({ page: "quick-start", section: "which-key" })).list.hidden, false);
});

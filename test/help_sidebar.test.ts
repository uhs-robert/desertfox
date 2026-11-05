import assert from "node:assert/strict";
import { test } from "node:test";
import { render_help, reset_group_state, section_hash } from "../src/help/render.ts";
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

const GROUPS = [{ name: "scroll", commands: [] }, { name: "tab", commands: [] }];

function render(route: Route, keep_state = false): FakeNode {
  (globalThis as { document?: unknown }).document = { createElement: (tag: string) => new FakeNode(tag) };
  if (!keep_state) reset_group_state();
  const root = new FakeNode("body");
  render_help(root as never, { quick_start: QUICK_START, groups: GROUPS, warnings: [], settings: [], engines: [], tip: { kind: "tip", inlines: [] } } as never, route, []);
  return root;
}

const group_nodes = (root: FakeNode) => root.find_all(by_class("oasisfox-help-nav-group")).map((group) => ({
  page: (group.find_all((node) => node.tag === "a")[0]!.children[0]) as string,
  toggle: group.find_all(by_class("oasisfox-help-sections-toggle"))[0]!,
  list: group.find_all(by_class("oasisfox-help-sections"))[0]!,
}));

const links = (list: FakeNode) => (list.children as FakeNode[]).map((link) => link.attributes["href"]);

test("Home, Quick Start, Commands and Styling have a group, Search Engines does not", () => {
  assert.deepEqual(group_nodes(render({ page: "home" })).map((group) => group.page), ["Home", "Quick Start", "Commands", "Styling"]);
});

test("the current page's group is open and the others are closed", () => {
  for (const [page, title] of [["home", "Home"], ["quick-start", "Quick Start"], ["commands", "Commands"], ["styling", "Styling"]] as const) {
    for (const group of group_nodes(render({ page }))) {
      const open = group.page === title;
      assert.equal(group.list.hidden, !open);
      assert.equal(group.toggle.attributes["aria-expanded"], String(open));
      assert.equal(group.toggle.children[0], open ? "▾" : "▸");
      assert.equal(group.toggle.attributes["aria-controls"], group.list.id);
    }
  }
  for (const group of group_nodes(render({ page: "search-engines" }))) assert.equal(group.list.hidden, true);
});

test("each toggle works alone and flips its glyph", () => {
  const groups = group_nodes(render({ page: "quick-start" }));
  const [home, quick_start] = [groups[0]!, groups[1]!];
  home.toggle.listeners["click"]!();
  assert.equal(home.list.hidden, false);
  assert.equal(home.toggle.textContent, "▾");
  assert.equal(quick_start.list.hidden, false);
  quick_start.toggle.listeners["click"]!();
  assert.equal(quick_start.list.hidden, true);
  assert.equal(quick_start.toggle.textContent, "▸");
  assert.equal(home.list.hidden, false);
});

test("each group lists its page's sections", () => {
  const by_page = Object.fromEntries(group_nodes(render({ page: "home" })).map((group) => [group.page, links(group.list)]));
  assert.deepEqual(by_page["Home"], ["#section=home/warnings", "#section=home/settings"]);
  assert.deepEqual(by_page["Styling"], ["#section=styling/variables", "#section=styling/classes"]);
  assert.deepEqual(by_page["Commands"], ["#section=commands/scroll", "#section=commands/tab"]);
  assert.deepEqual(by_page["Quick Start"], ["#section=quick-start/click-with-hints", "#section=quick-start/which-key", "#section=quick-start/which-key-2"]);
});

test("heading ids are unique, focusable and match the section links", () => {
  const root = render({ page: "quick-start" });
  const headings = root.find_all((node) => node.tag === "h2");
  assert.deepEqual(headings.map((node) => node.id), ["quick-start-click-with-hints", "quick-start-which-key", "quick-start-which-key-2"]);
  assert.ok(headings.every((node) => node.tabIndex === -1));
});

test("each section link round-trips through the router to a heading on its page", () => {
  const groups = group_nodes(render({ page: "home" }));
  for (const group of groups) {
    for (const hash of links(group.list) as string[]) {
      const route = parse_route(hash);
      const target = render(route).find_all((node) => node.tag === "h2" && node.id === `${route.page}-${route.section}`);
      assert.equal(target.length, 1, hash);
    }
  }
});

test("a section route opens its page's group", () => {
  const groups = group_nodes(render({ page: "commands", section: "tab" }));
  assert.deepEqual(groups.map((group) => !group.list.hidden), [false, false, true, false]);
});

test("section routes parse for every page and reject an unknown page", () => {
  assert.deepEqual(parse_route(section_hash("styling", "classes")), { page: "styling", section: "classes" });
  assert.deepEqual(parse_route("#section=nowhere/x"), { page: "home" });
  assert.deepEqual(parse_route("#section=quick-start"), { page: "home" });
});

test("a toggle persists across renders, auto-opening does not, and a menu click reopens a closed group", () => {
  render({ page: "home" });
  group_nodes(render({ page: "home" }, true))[2]!.toggle.listeners["click"]!();
  assert.deepEqual(group_nodes(render({ page: "home" }, true)).map((group) => !group.list.hidden), [true, false, true, false]);
  assert.deepEqual(group_nodes(render({ page: "styling" }, true)).map((group) => !group.list.hidden), [false, false, true, true]);
  // Home and Styling were only open by default, so they close, and the toggled Commands group stays open.
  const on_commands = group_nodes(render({ page: "commands" }, true)).map((group) => !group.list.hidden);
  assert.deepEqual(on_commands, [false, false, true, false]);
});

test("automatic opening piles nothing up", () => {
  render({ page: "home" });
  assert.deepEqual(group_nodes(render({ page: "commands" }, true)).map((group) => !group.list.hidden), [false, false, true, false]);
  const closed = group_nodes(render({ page: "commands" }, true))[2]!;
  closed.toggle.listeners["click"]!();
  assert.equal(group_nodes(render({ page: "commands" }, true))[2]!.list.hidden, true);
  render({ page: "home" }, true);
  assert.equal(group_nodes(render({ page: "commands" }, true))[2]!.list.hidden, false);
});

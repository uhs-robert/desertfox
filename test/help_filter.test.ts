import assert from "node:assert/strict";
import { test } from "node:test";
import { command_matches, count_line } from "../src/help/filter.ts";
import { render_help } from "../src/help/render.ts";
import type { CommandRow, HelpModel } from "../src/help/model.ts";

function row(id: string, name: string, intent: string, keys: string[] = []): CommandRow {
  return { id, name, label: id, intent, usage: name, params: [], keys: keys.map((sequence) => ({ mode: "normal", keys: sequence, args: "" })) };
}

const TAB_NEW = row("tab.new", "tabnew", "Open a blank tab", ["gt"]);

test("the filter matches name, id, description and key, ignoring case", () => {
  assert.ok(command_matches(TAB_NEW, "TABNEW"));
  assert.ok(command_matches(TAB_NEW, "tab.n"));
  assert.ok(command_matches(TAB_NEW, "blank"));
  assert.ok(command_matches(TAB_NEW, "gt"));
  assert.ok(!command_matches(TAB_NEW, "scroll"));
  assert.ok(command_matches(TAB_NEW, "  "));
});

test("the count line reads shown of total", () => {
  assert.equal(count_line(4, 120), "4 of 120 commands");
});

class FakeNode {
  className = "";
  hidden = false;
  value = "";
  textContent: string | null = null;
  children: (FakeNode | string)[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, (event: unknown) => void> = {};
  scrolled = false;
  tabIndex = 0;
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  append(...nodes: (FakeNode | string)[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: (FakeNode | string)[]) { this.children = nodes; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, listener: (event: unknown) => void) { this.listeners[name] = listener; }
  scrollIntoView() { this.scrolled = true; }
  classList = {
    add: (name: string) => { if (!this.has(name)) this.className += ` ${name}`; },
    remove: (name: string) => { this.className = this.className.split(" ").filter((part) => part !== name).join(" "); },
  };
  has(name: string) { return this.className.split(" ").includes(name); }
  find_all(class_name: string): FakeNode[] {
    const own = this.has(class_name) ? [this] : [];
    return [...own, ...this.children.flatMap((child) => (typeof child === "string" ? [] : child.find_all(class_name)))];
  }
}

const MODEL = {
  engines: [],
  groups: [
    { name: "tab", commands: [TAB_NEW, row("tab.close", "tabclose", "Close the tab")] },
    { name: "scroll", commands: [row("scroll.down", "down", "Scroll down", ["j"])] },
  ],
} as unknown as HelpModel;

function render(): FakeNode {
  (globalThis as { document?: unknown }).document = { createElement: (tag: string) => new FakeNode(tag) };
  const root = new FakeNode("body");
  render_help(root as never, MODEL, { page: "commands" }, []);
  return root;
}

function type(root: FakeNode, text: string): FakeNode {
  const input = root.find_all("oasisfox-help-filter")[0]!;
  input.value = text;
  input.listeners["input"]!({});
  return input;
}

const shown_cards = (root: FakeNode) => root.find_all("oasisfox-help-command").filter((card) => !card.hidden).length;
const count_text = (root: FakeNode) => root.find_all("oasisfox-help-filter-count")[0]!.textContent;

test("a clear box shows every command and the full count", () => {
  const root = render();
  assert.equal(shown_cards(root), 3);
  assert.equal(count_text(root), "3 of 3 commands");
});

test("typing hides non-matching rows and updates the count", () => {
  const root = render();
  type(root, "scroll");
  assert.equal(shown_cards(root), 1);
  assert.equal(count_text(root), "1 of 3 commands");
  type(root, "");
});

test("a group with no match hides its heading", () => {
  const root = render();
  type(root, "scroll");
  const page = root.find_all("oasisfox-help-page")[0]!;
  const h2 = page.children.filter((child): child is FakeNode => child instanceof FakeNode && child.tag === "h2");
  assert.deepEqual(h2.map((heading) => heading.hidden), [true, false]);
  type(root, "");
});

test("Enter highlights and scrolls to the first match", () => {
  const root = render();
  const input = type(root, "tab");
  let prevented = false;
  input.listeners["keydown"]!({ key: "Enter", preventDefault: () => { prevented = true; } });
  const [current] = root.find_all("oasisfox-help-current");
  assert.ok(prevented);
  assert.ok(current!.scrolled);
  assert.match(JSON.stringify(current!.children), /tab\.new/);
  type(root, "");
});

test("the filter text survives a re-render", () => {
  const first = render();
  type(first, "scroll");
  const second = render();
  assert.equal(second.find_all("oasisfox-help-filter")[0]!.value, "scroll");
  assert.equal(shown_cards(second), 1);
  assert.equal(count_text(second), "1 of 3 commands");
  type(second, "");
});

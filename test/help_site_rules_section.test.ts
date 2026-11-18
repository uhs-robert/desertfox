import assert from "node:assert/strict";
import { test } from "node:test";
import { fill_site_rules } from "../src/help/settings_page.ts";
import type { Field } from "../src/help/settings_model.ts";

// Just enough DOM for the site rules box: elements with a class, children, attributes and click listeners.
class FakeNode {
  className = "";
  children: (FakeNode | string)[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  title = "";
  type = "";
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  append(...nodes: (FakeNode | string)[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: (FakeNode | string)[]) { this.children = []; this.append(...nodes); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, listener: () => void) { this.listeners[name] = listener; }
  find_all(test: (node: FakeNode) => boolean): FakeNode[] {
    const below = this.children.flatMap((child) => (typeof child === "string" ? [] : child.find_all(test)));
    return test(this) ? [this, ...below] : below;
  }
  get text(): string { return this.children.map((child) => (typeof child === "string" ? child : child.text)).join(""); }
}

(globalThis as { document?: unknown }).document = { createElement: (tag: string) => new FakeNode(tag) };

const field = (value: unknown, top_layer: string): Field => ({ row: { name: "site_rules", value, top_layer } }) as never;
const fill = (value: unknown, top_layer: string, reset = () => undefined): FakeNode => {
  const box = new FakeNode("div");
  fill_site_rules(box as never, field(value, top_layer), reset);
  return box;
};
const tag = (box: FakeNode, name: string) => box.find_all((node) => node.tag === name);

test("a file rule list draws one table row per rule, with its site and effect, and no Reset", () => {
  const box = fill([{ site: "*://a.test/*", pass: "j k l" }, { site: "*://b.test/*", off: true }], "settings.toml");
  const rows = tag(box, "tr").slice(1);
  assert.equal(rows.length, 2);
  assert.match(rows[0]!.text, /\*:\/\/a\.test\/\*Pass 3 keys: j k l/);
  assert.match(rows[1]!.text, /Off/);
  assert.equal(box.attributes["data-changed"], "true");
  assert.equal(tag(box, "button").length, 0);
  assert.doesNotMatch(box.text, /Saved here/);
});

test("with no rules the box says so", () => {
  const box = fill([], "default");
  assert.equal(tag(box, "table").length, 0);
  assert.match(box.text, /You have no site rules of your own/);
});

test("saved rules are marked, say the file does not apply, and Reset clears them", () => {
  let resets = 0;
  const box = fill([{ site: "*://a.test/*" }], "saved", () => { resets += 1; });
  assert.equal(box.attributes["data-changed"], "true");
  assert.match(box.text, /Saved here/);
  assert.match(box.text, /do not apply until you reset/);
  const [button] = tag(box, "button");
  button!.listeners["click"]!();
  assert.equal(resets, 1);
});

test("saved rules with an empty list still offer Reset", () => {
  assert.equal(tag(fill([], "saved"), "button").length, 1);
});

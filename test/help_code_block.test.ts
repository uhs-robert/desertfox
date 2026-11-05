import assert from "node:assert/strict";
import { test } from "node:test";
import { copy_code_and_confirm, render_help } from "../src/help/render.ts";
import type { Block } from "../src/help/blocks.ts";

// Just enough DOM for render_help: elements with a class, children, text and listeners.
class FakeNode {
  className = "";
  tabIndex = 0;
  children: (FakeNode | string)[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  append(...nodes: (FakeNode | string)[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: (FakeNode | string)[]) { this.children = nodes; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, listener: () => void) { this.listeners[name] = listener; }
  get text(): string { return this.children.map((child) => (typeof child === "string" ? child : child.text)).join(""); }
  find_all(class_name: string): FakeNode[] {
    const own: FakeNode[] = this.className === class_name ? [this] : [];
    const below = this.children.flatMap((child) => (typeof child === "string" ? [] : child.find_all(class_name)));
    return [...own, ...below];
  }
}

function render_guide(guide: Block[]): FakeNode {
  (globalThis as { document?: unknown }).document = { createElement: (tag: string) => new FakeNode(tag) };
  const root = new FakeNode("body");
  const model = { engines: [], quick_start: [], groups: [] } as never;
  render_help(root as never, model, { page: "search-engines" }, guide);
  return root;
}

test("a block with a language gets a label, a Copy button and the code text", () => {
  const root = render_guide([{ kind: "code_block", text: "a = 1\n  b = 2", language: "toml" }]);
  assert.equal(root.find_all("oasisfox-help-code-lang")[0]!.text, "toml");
  const [button] = root.find_all("oasisfox-help-code-copy");
  assert.equal(button!.tag, "button");
  assert.equal(button!.attributes["type"], "button");
  assert.equal(button!.text, "Copy");
  assert.equal(root.find_all("oasisfox-help-code-body")[0]!.text, "a = 1\n  b = 2");
});

test("a block without a language shows no label but still has the button", () => {
  const root = render_guide([{ kind: "code_block", text: "x" }]);
  assert.equal(root.find_all("oasisfox-help-code-lang").length, 0);
  assert.equal(root.find_all("oasisfox-help-code-copy").length, 1);
});

test("the copy handler copies the exact text, shows Copied, then restores Copy", async () => {
  const written: string[] = [];
  const button = { textContent: "Copy" as string | null };
  const timers: (() => void)[] = [];
  const text = "a = 1\n\n  b = \"x\"\n";
  await copy_code_and_confirm({ writeText: async (value) => void written.push(value) }, text, button, (restore) => void timers.push(restore));
  assert.deepEqual(written, [text]);
  assert.equal(button.textContent, "Copied");
  timers[0]!();
  assert.equal(button.textContent, "Copy");
});

test("a refused copy leaves the button label alone", async () => {
  const button = { textContent: "Copy" as string | null };
  await copy_code_and_confirm({ writeText: () => Promise.reject(new Error("denied")) }, "x", button, () => assert.fail("no timer"));
  assert.equal(button.textContent, "Copy");
});

test("a second click cancels the first restore timer so Copied lasts a full period", async () => {
  const button = { textContent: "Copy" as string | null };
  const cancelled: unknown[] = [];
  let next_handle = 0;
  const clipboard = { writeText: async () => {} };
  const later = () => ++next_handle;
  await copy_code_and_confirm(clipboard, "x", button, later, (handle) => void cancelled.push(handle));
  assert.deepEqual(cancelled, []);
  await copy_code_and_confirm(clipboard, "x", button, later, (handle) => void cancelled.push(handle));
  assert.deepEqual(cancelled, [1]);
});

test("inline code runs render as code elements with the inline class, other text stays plain", () => {
  const root = render_guide([
    { kind: "paragraph", inlines: [{ kind: "text", text: "Run " }, { kind: "code", text: "just build-config" }, { kind: "text", text: " now" }] },
    { kind: "list", items: [[{ kind: "code", text: "<b>x</b>" }]] },
  ]);
  const [first, second] = root.find_all("oasisfox-help-inline-code");
  assert.equal(root.find_all("oasisfox-help-inline-code").length, 2);
  assert.equal(first!.tag, "code");
  assert.equal(first!.text, "just build-config");
  assert.equal(second!.text, "<b>x</b>");
});

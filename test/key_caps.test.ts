import assert from "node:assert/strict";
import { test } from "node:test";
import { key_caps } from "../src/shared/key_caps.ts";

class FakeElement {
  className = "";
  textContent = "";
  children: FakeElement[] = [];
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  append(...nodes: FakeElement[]) { this.children.push(...nodes); }
}
(globalThis as unknown as { document: unknown }).document = { createElement: (tag: string) => new FakeElement(tag) };

const caps_of = (text: string): string[] => (key_caps(text) as unknown as FakeElement).children.map((cap) => cap.textContent);

test("a plain sequence gives one cap per key", () => {
  assert.deepEqual(caps_of("gt"), ["g", "t"]);
});

test("spaces separate words and a chord stays one cap", () => {
  assert.deepEqual(caps_of("<Space> g t"), ["<Space>", "g", "t"]);
  assert.deepEqual(caps_of("<C-x>"), ["<C-x>"]);
  assert.deepEqual(caps_of("<C-x>y"), ["<C-x>", "y"]);
});

test("empty text gives no caps", () => {
  assert.deepEqual(caps_of(""), []);
  assert.deepEqual(caps_of("  "), []);
});

test("angle brackets that are no chord stay literal", () => {
  assert.deepEqual(caps_of("a<b"), ["a", "<", "b"]);
  assert.deepEqual(caps_of("<S-1>"), ["<S-1>"]);
});

test("the caps sit in one keycaps row of kbd elements", () => {
  const row = key_caps("g") as unknown as FakeElement;
  assert.equal(row.className, "desertfox-keycaps");
  assert.equal(row.children[0]!.tag, "kbd");
  assert.equal(row.children[0]!.className, "desertfox-keycap");
});

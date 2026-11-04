import assert from "node:assert/strict";
import { test } from "node:test";
import { first_index_from, in_other_tree } from "../src/content/caret/start_point.ts";
import type { TextModel } from "../src/content/caret/text_model.ts";

// Nodes in document order: a heading text, an image, a field, a paragraph text, and a nested span text inside a link.
const ORDER = ["heading_text", "image", "field", "paragraph_text", "link", "link_text"];
const CONTAINS: Record<string, string[]> = { link: ["link_text"] };

class FakeNode {
  nodeType = 3;
  childNodes: FakeNode[] = [];
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  compareDocumentPosition(other_node: unknown): number {
    const other = other_node as FakeNode;
    if (other === this) return 0;
    if (CONTAINS[this.name]?.includes(other.name)) return 16 | 4;
    return ORDER.indexOf(other.name) > ORDER.indexOf(this.name) ? 4 : 2;
  }
}
const nodes = Object.fromEntries(ORDER.map((name) => [name, new FakeNode(name)]));

// "Title\nBody text\nLink" with each line in the text node of its own.
const model: TextModel = {
  text: "Title\nBody text\nLink",
  point_at: (index) => ({ node: (index < 6 ? nodes.heading_text : index < 16 ? nodes.paragraph_text : nodes.link_text) as unknown as Node, offset: 0 }),
  index_of: () => undefined,
};

test("an element with text starts at its own first character", () => {
  assert.equal(first_index_from(model, nodes.paragraph_text! as never), 6);
});

test("an element that holds text starts at the first character inside it", () => {
  assert.equal(first_index_from(model, nodes.link! as never), 16);
});

test("an image or a text field has no text, so it takes the next text after it", () => {
  assert.equal(first_index_from(model, nodes.image! as never), 6);
  assert.equal(first_index_from(model, nodes.field! as never), 6);
});

test("no text at or after the element gives undefined", () => {
  assert.equal(first_index_from(model, nodes.link_text! as never), 16);
  assert.equal(first_index_from({ ...model, text: "" }, nodes.image! as never), undefined);
  const before_all = { ...model, point_at: () => ({ node: nodes.heading_text as unknown as Node, offset: 0 }) };
  assert.equal(first_index_from(before_all, nodes.link! as never), undefined);
});

test("an element in another document or in a shadow root is out of reach of the page's text model", () => {
  const top = {};
  assert.equal(in_other_tree({ ownerDocument: top, getRootNode: () => top }, top), false);
  assert.equal(in_other_tree({ ownerDocument: {}, getRootNode: () => top }, top), true);
  assert.equal(in_other_tree({ ownerDocument: top, getRootNode: () => ({}) }, top), true);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { page_selection_cursor } from "../src/content/caret/page_selection.ts";

// One text node, so a node and an offset map straight to an index.
const text_node = { nodeType: 3 };
const model = { index_of_: (node: unknown, offset: number) => (node === text_node ? offset : undefined) } as never;

// A drag from `from` to `to` in the node, in the forms a Selection takes: the range is always ordered, the anchor and focus are not.
function drag(from: number, to: number) {
  const [start, end] = from <= to ? [from, to] : [to, from];
  const range = { startContainer: text_node, startOffset: start, endContainer: text_node, endOffset: end, collapsed: start === end };
  return { rangeCount: 1, isCollapsed: start === end, getRangeAt: () => range, anchorNode: text_node, anchorOffset: from, focusNode: text_node, focusOffset: to } as never;
}

test("a forward drag anchors at its start and puts the caret on its last character", () => {
  assert.deepEqual(page_selection_cursor(model, drag(2, 7)), { anchor: 2, caret: 6 });
});

test("a backward drag anchors at its last character and puts the caret at its start", () => {
  assert.deepEqual(page_selection_cursor(model, drag(7, 2)), { anchor: 6, caret: 2 });
});

test("a click has no span to carry", () => {
  assert.equal(page_selection_cursor(model, drag(4, 4)), undefined);
});

test("no range, or a range outside the model, gives nothing", () => {
  assert.equal(page_selection_cursor(model, { rangeCount: 0, isCollapsed: true } as never), undefined);
  const other = { nodeType: 3 };
  const range = { startContainer: other, startOffset: 0, endContainer: other, endOffset: 3, collapsed: false };
  assert.equal(page_selection_cursor(model, { rangeCount: 1, isCollapsed: false, getRangeAt: () => range, anchorNode: other, anchorOffset: 0, focusNode: other, focusOffset: 3 } as never), undefined);
});

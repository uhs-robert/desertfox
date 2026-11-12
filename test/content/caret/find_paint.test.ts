import assert from "node:assert/strict";
import { test } from "node:test";
import { CARET_NAMES, create_painter, paint_indexes } from "../../../src/content/caret/find_paint.ts";
import type { TextModel } from "../../../src/content/caret/text_model.ts";

test("under the cap, every match is painted", () => {
  assert.deepEqual([...paint_indexes(1, 4, 10)].sort(), [0, 1, 2, 3]);
});

test("past the cap, matches on both sides of the current one are painted", () => {
  const indexes = paint_indexes(50, 100, 10);
  assert.equal(indexes.length, 10);
  assert.ok(indexes.includes(50));
  assert.ok(indexes.includes(46) && indexes.includes(54));
});

test("the window wraps at both ends of the page", () => {
  assert.deepEqual(paint_indexes(0, 100, 4), [98, 99, 0, 1]);
  assert.ok(paint_indexes(99, 100, 4).includes(0));
});

// The caret cell takes its colors from the selection sheet, which follows the mode, so its painter must not adopt one of its own.
test("a painter given no colors registers its highlights and adopts no sheet", () => {
  const registry = new Map<string, { ranges: unknown[] }>();
  class FakeHighlight {
    ranges: unknown[];
    constructor(...ranges: unknown[]) {
      this.ranges = ranges;
    }
  }
  const text = { nodeType: 3 };
  const owner = { nodeType: 9, adoptedStyleSheets: [] as unknown[], createRange: () => ({ startContainer: text, setStart() {}, setEnd() {} }) };
  Object.assign(text, { ownerDocument: owner });
  Object.assign(globalThis, { document: owner, window: { CSS: { highlights: registry }, Highlight: FakeHighlight }, Node: { TEXT_NODE: 3 } });
  const model = { text: "ab", trees: [owner], tree_runs_: () => [{ tree: owner, from: 0, to: 1 }], point_at_: () => ({ node: text, offset: 0 }) } as unknown as TextModel;
  const painter = create_painter(CARET_NAMES);
  painter.paint(model, { from: [0], width: 1 }, 0, undefined, [0]);
  assert.equal(registry.get(CARET_NAMES.current)?.ranges.length, 1);
  assert.equal(owner.adoptedStyleSheets.length, 0);
  painter.clear();
  assert.equal(registry.has(CARET_NAMES.current), false);
});

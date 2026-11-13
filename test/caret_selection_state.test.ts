import assert from "node:assert/strict";
import { test } from "node:test";
import { is_visual, line_span, selected_text } from "../src/content/caret/selection_state.ts";

// Screen lines of ten characters each, as a wrapped paragraph lays them out.
const rows_of_ten = { start_of_: (index: number) => index - (index % 10), end_of: (index: number) => index - (index % 10) + 9 };

test("a line span runs from the earlier end's line start to the later end's line end", () => {
  assert.deepEqual(line_span({ anchor: 13, caret: 27 }, rows_of_ten), { from: 10, to: 30 });
  assert.deepEqual(line_span({ anchor: 27, caret: 13 }, rows_of_ten), { from: 10, to: 30 });
});

test("a line span of one end covers its whole line", () => {
  assert.deepEqual(line_span({ anchor: 4, caret: 4 }, rows_of_ten), { from: 0, to: 10 });
  assert.equal(selected_text("first row second row", line_span({ anchor: 12, caret: 12 }, rows_of_ten)), "second row");
});

test("a line bound on the wrong side of its end leaves that end", () => {
  assert.deepEqual(line_span({ anchor: 5, caret: 8 }, { start_of_: (index) => index + 1, end_of: (index) => index - 1 }), { from: 5, to: 9 });
});

test("only caret mode is not visual", () => {
  assert.deepEqual((["caret", "visual", "visual_line"] as const).map(is_visual), [false, true, true]);
});

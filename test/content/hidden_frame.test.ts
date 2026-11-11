import assert from "node:assert/strict";
import { test } from "node:test";
import { is_too_small_to_show } from "../../src/content/hidden_frame.ts";

test("the Google Docs text frame is too small to show", () => {
  // Measured on a real document: 625 by 1.
  assert.equal(is_too_small_to_show({ width: 625, height: 1 }), true);
  assert.equal(is_too_small_to_show({ width: 1, height: 1 }), true);
  assert.equal(is_too_small_to_show({ width: 3, height: 200 }), true);
  assert.equal(is_too_small_to_show({ width: 0, height: 0 }), true);
});

test("a frame of a usable size is not hidden, wherever it sits", () => {
  assert.equal(is_too_small_to_show({ width: 300, height: 200 }), false);
  assert.equal(is_too_small_to_show({ width: 4, height: 4 }), false, "the smallest side that still counts as shown");
});

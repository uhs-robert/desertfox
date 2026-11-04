import assert from "node:assert/strict";
import { test } from "node:test";
import { paint_indexes } from "../../../src/content/caret/find_paint.ts";

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

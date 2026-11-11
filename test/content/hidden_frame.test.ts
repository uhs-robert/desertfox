import assert from "node:assert/strict";
import { test } from "node:test";
import { is_out_of_sight } from "../../src/content/hidden_frame.ts";

const VIEW_WIDTH = 1878;
const VIEW_HEIGHT = 953;
const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
const out_of_sight = (left: number, top: number, width: number, height: number) => is_out_of_sight(box(left, top, width, height), VIEW_WIDTH, VIEW_HEIGHT);

test("the Google Docs text frame is out of sight by its size and by its place", () => {
  // The box measured on a real document: left 0, top -10000, 625 by 1.
  assert.equal(out_of_sight(0, -10000, 625, 1), true);
  assert.equal(out_of_sight(0, 100, 625, 1), true, "a 1 px high frame in the viewport");
  assert.equal(out_of_sight(0, -10000, 625, 300), true, "a full-size frame above the viewport");
});

test("a frame on any side outside the viewport is out of sight", () => {
  assert.equal(out_of_sight(-400, 100, 300, 200), true, "left of the viewport");
  assert.equal(out_of_sight(VIEW_WIDTH + 1, 100, 300, 200), true, "right of the viewport");
  assert.equal(out_of_sight(0, VIEW_HEIGHT + 1, 300, 200), true, "below the viewport");
});

test("a frame the user can see is not out of sight", () => {
  assert.equal(out_of_sight(0, 0, 300, 200), false);
  assert.equal(out_of_sight(-100, -100, 300, 200), false, "partly in the viewport");
  assert.equal(out_of_sight(100, 100, 4, 4), false, "the smallest side that still counts as shown");
  assert.equal(out_of_sight(100, 100, 300, 3), true);
  assert.equal(out_of_sight(100, 100, 3, 200), true);
});

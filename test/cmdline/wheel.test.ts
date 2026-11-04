import assert from "node:assert/strict";
import { test } from "node:test";
import { wheel_rows } from "../../src/cmdline/wheel.ts";

const ROW = 20;
const fresh = () => ({ remainder_px: 0 });

test("a line-mode notch of 3 lines moves 3 rows, up or down", () => {
  assert.equal(wheel_rows(fresh(), 3, 1, ROW), 3);
  assert.equal(wheel_rows(fresh(), -3, 1, ROW), -3);
});

test("a page-mode notch moves ten rows per page", () => {
  assert.equal(wheel_rows(fresh(), 1, 2, ROW), 10);
});

test("pixel mode: many small deltas add up to whole rows and keep the remainder", () => {
  const state = fresh();
  const moved = Array.from({ length: 10 }, () => wheel_rows(state, 6, 0, ROW));
  assert.deepEqual(moved, [0, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  assert.equal(state.remainder_px, 0);
  assert.equal(wheel_rows(state, 7, 0, ROW), 0);
  assert.equal(state.remainder_px, 7);
});

test("a pixel notch of 60 px moves 3 rows", () => {
  assert.equal(wheel_rows(fresh(), 60, 0, ROW), 3);
});

test("a change of direction first spends the remainder", () => {
  const state = fresh();
  assert.equal(wheel_rows(state, 15, 0, ROW), 0);
  assert.equal(wheel_rows(state, -10, 0, ROW), 0);
  assert.equal(state.remainder_px, 5);
  assert.equal(wheel_rows(state, -30, 0, ROW), -1);
  assert.equal(state.remainder_px, -5);
});

test("a zero or horizontal-only delta moves nothing", () => {
  assert.equal(wheel_rows(fresh(), 0, 0, ROW), 0);
});

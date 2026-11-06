import assert from "node:assert/strict";
import { test } from "node:test";
import { indexes_in_range, pad_range } from "../../../src/content/caret/visible_range.ts";

test("the range widens by its own length on each side and stops at the ends", () => {
  assert.deepEqual(pad_range(40, 60, 1000), { first: 20, last: 80 });
  assert.deepEqual(pad_range(5, 60, 100), { first: 0, last: 99 });
  assert.deepEqual(pad_range(0, 0, 0), { first: 0, last: -1 });
});

test("the matches inside the range are chosen, ends included", () => {
  const positions = [2, 10, 11, 20, 30, 45];
  assert.deepEqual(indexes_in_range(positions, 10, 30, 0), [1, 2, 3, 4]);
  assert.deepEqual(indexes_in_range(positions, 11, 29, 0), [2, 3]);
  assert.deepEqual(indexes_in_range(positions, 46, 90, 0), []);
  assert.deepEqual(indexes_in_range([], 0, 90, 0), []);
});

test("past the cap, a run around the center stays and the run stays inside the range", () => {
  const positions = Array.from({ length: 100 }, (_, at) => at * 2);
  assert.deepEqual(indexes_in_range(positions, 0, 199, 50, 4), [48, 49, 50, 51]);
  assert.deepEqual(indexes_in_range(positions, 20, 60, 0, 4), [10, 11, 12, 13]);
  assert.deepEqual(indexes_in_range(positions, 20, 60, 99, 4), [27, 28, 29, 30]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { child_of, parent_of, sibling_of } from "../src/content/tree/walk.ts";
import type { TreeRow } from "../src/content/tree/walk.ts";

const thread = (depths: number[]): TreeRow<string>[] => depths.map((depth, index) => ({ item: `c${index}`, depth }));
//   c0 0
//     c1 1
//       c2 2
//     c3 1
//   c4 0
//     c5 1
const rows = thread([0, 1, 2, 1, 0, 1]);

test("parent is the nearest earlier item with a lower depth", () => {
  assert.equal(parent_of(rows, 2), 1);
  assert.equal(parent_of(rows, 3), 0);
  assert.equal(parent_of(rows, 5), 4);
  assert.equal(parent_of(rows, 0), undefined);
  assert.equal(parent_of(rows, 4), undefined);
});

test("child is the next item only when it is one level deeper", () => {
  assert.equal(child_of(rows, 0), 1);
  assert.equal(child_of(rows, 1), 2);
  assert.equal(child_of(rows, 2), undefined);
  assert.equal(child_of(rows, 5), undefined);
  assert.equal(child_of(thread([0, 2]), 0), undefined);
});

test("next sibling skips the replies of the item and stops at the end of its level", () => {
  assert.equal(sibling_of(rows, 1, 1), 3);
  assert.equal(sibling_of(rows, 0, 1), 4);
  assert.equal(sibling_of(rows, 3, 1), undefined);
  assert.equal(sibling_of(rows, 2, 1), undefined);
  assert.equal(sibling_of(rows, 5, 1), undefined);
});

test("previous sibling does not leave the parent", () => {
  assert.equal(sibling_of(rows, 3, -1), 1);
  assert.equal(sibling_of(rows, 4, -1), 0);
  assert.equal(sibling_of(rows, 1, -1), undefined);
  assert.equal(sibling_of(rows, 5, -1), undefined);
});

test("a folded item hides its replies, so the walk sees the next comment as the sibling", () => {
  const folded = thread([0, 0, 1]);
  assert.equal(child_of(folded, 0), undefined);
  assert.equal(sibling_of(folded, 0, 1), 1);
});

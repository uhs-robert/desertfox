import assert from "node:assert/strict";
import { test } from "node:test";
import { clean_letters, DEFAULT_HINT_LETTERS, make_labels, narrow, overlap_groups, rotate } from "../../src/content/hints/labels.ts";

const HOME_ROW = [...DEFAULT_HINT_LETTERS];

const prefix_pairs = (labels: string[]) => labels.flatMap((first, i) => labels.filter((second, j) => i !== j && second.startsWith(first)).map((second) => [first, second]));

test("labels are prefix-free, unique and home-row for every count up to 2000", () => {
  for (const count of [0, 1, 2, 8, 9, 10, 17, 81, 82, 200, 729, 730, 2000]) {
    const labels = make_labels(count, HOME_ROW);
    assert.equal(labels.length, count);
    assert.equal(new Set(labels).size, count);
    assert.deepEqual(prefix_pairs(labels), [], `count ${count}`);
    for (const label of labels) assert.match(label, /^[asdfghjkl]+$/);
  }
});

test("few targets get one letter each, in alphabet order", () => {
  assert.deepEqual(make_labels(3, HOME_ROW), ["a", "s", "d"]);
  assert.deepEqual(make_labels(9, HOME_ROW), HOME_ROW);
});

test("more targets than letters split the shortest labels first, so labels stay short", () => {
  const labels = make_labels(12, HOME_ROW);
  assert.equal(Math.max(...labels.map((label) => label.length)), 2);
  assert.equal(labels.filter((label) => label.length === 1).length, 8);
});

test("a custom alphabet is honored and two letters still work", () => {
  const labels = make_labels(5, ["x", "y"]);
  assert.deepEqual(prefix_pairs(labels), []);
  for (const label of labels) assert.match(label, /^[xy]+$/);
});

test("the letters setting is cleaned, and an unusable one falls back to the home row", () => {
  assert.deepEqual(clean_letters("ASDa d"), ["a", "s", "d"]);
  assert.deepEqual(clean_letters("a/b"), ["a", "b"]);
  assert.deepEqual(clean_letters("a/"), HOME_ROW);
  assert.deepEqual(clean_letters("a"), HOME_ROW);
  assert.deepEqual(clean_letters(""), HOME_ROW);
  assert.deepEqual(clean_letters(undefined), HOME_ROW);
});

test("narrow lists labels that still fit and reports a complete one", () => {
  const labels = ["a", "sa", "ss", "sd"];
  assert.deepEqual(narrow(labels, ""), { still_possible_: [0, 1, 2, 3], complete: undefined });
  assert.deepEqual(narrow(labels, "s"), { still_possible_: [1, 2, 3], complete: undefined });
  assert.deepEqual(narrow(labels, "sd"), { still_possible_: [3], complete: 3 });
  assert.deepEqual(narrow(labels, "x"), { still_possible_: [], complete: undefined });
});

const box = (left: number, top: number, size = 10) => ({ left, top, right: left + size, bottom: top + size });

test("overlap_groups joins boxes that cover each other, also through a chain, and ignores touching and lone boxes", () => {
  const boxes = [box(0, 0), box(5, 5), box(10, 10), box(100, 100), box(110, 0)];
  assert.deepEqual(overlap_groups(boxes), [[0, 1, 2]]);
  assert.deepEqual(overlap_groups([box(0, 0), box(10, 0)]), []);
  assert.deepEqual(overlap_groups([]), []);
});

test("overlap_groups lists each group in the order given", () => {
  assert.deepEqual(overlap_groups([box(0, 0), box(50, 50), box(2, 2), box(52, 52)]), [[0, 2], [1, 3]]);
});

test("rotate sends the top to the bottom, and leaves short stacks alone", () => {
  assert.deepEqual(rotate(["a", "b", "c"]), ["c", "a", "b"]);
  assert.deepEqual(rotate(["a", "b"]), ["b", "a"]);
  assert.deepEqual(rotate(["a"]), ["a"]);
  assert.deepEqual(rotate([]), []);
});

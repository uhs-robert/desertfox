import assert from "node:assert/strict";
import { test } from "node:test";
import { clean_letters, DEFAULT_HINT_LETTERS, make_labels, narrow } from "../../src/content/hints/labels.ts";

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
  assert.deepEqual(clean_letters("a"), HOME_ROW);
  assert.deepEqual(clean_letters(""), HOME_ROW);
  assert.deepEqual(clean_letters(undefined), HOME_ROW);
});

test("narrow lists labels that still fit and reports a complete one", () => {
  const labels = ["a", "sa", "ss", "sd"];
  assert.deepEqual(narrow(labels, ""), { still_possible: [0, 1, 2, 3], complete: undefined });
  assert.deepEqual(narrow(labels, "s"), { still_possible: [1, 2, 3], complete: undefined });
  assert.deepEqual(narrow(labels, "sd"), { still_possible: [3], complete: 3 });
  assert.deepEqual(narrow(labels, "x"), { still_possible: [], complete: undefined });
});

import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error The rig is plain JavaScript without types.
import { match_labels } from "../tools/measure/rivals/match_labels.mjs";

const target = (name: string, top: number) => ({ name, visible: true, rect: { left: 20, top, right: 180, bottom: top + 30, width: 160, height: 30 } });
const label_at = (left: number, top: number) => ({ left, top, width: 12, height: 16 });
const three_targets = [target("a", 100), target("b", 160), target("c", 220)];

test("one label on each target labels each target and reports nothing else", () => {
  const result = match_labels([label_at(20, 100), label_at(20, 160), label_at(20, 220)], three_targets);
  assert.deepEqual(result.labelled.sort(), ["a", "b", "c"]);
  assert.equal(result.duplicates, 0);
  assert.equal(result.stray, 0);
});

test("a second label on one target is a duplicate", () => {
  const result = match_labels([label_at(20, 100), label_at(120, 108)], three_targets);
  assert.deepEqual(result.labelled, ["a"]);
  assert.equal(result.duplicates, 1);
});

test("a label 31 px left of an unlabelled target is stray and does not credit it", () => {
  const result = match_labels([label_at(20, 100), label_at(-17, 160)], three_targets);
  assert.deepEqual(result.labelled, ["a"]);
  assert.equal(result.stray, 1);
});

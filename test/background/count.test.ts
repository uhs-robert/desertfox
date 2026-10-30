import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_count } from "../../src/background/count.ts";

test("no count runs once", () => {
  assert.deepEqual(apply_count({ count: "repeat" }, { id: "a.b" }), { args: undefined, times: 1 });
});
test("repeat runs count times", () => {
  assert.equal(apply_count({ count: "repeat" }, { id: "a.b", count: 3 }).times, 3);
});
test("ignore drops the count, and so does an absent rule", () => {
  assert.equal(apply_count({ count: "ignore" }, { id: "a.b", count: 3 }).times, 1);
  assert.equal(apply_count({}, { id: "a.b", count: 3 }).times, 1);
});
test("param rule fills the named arg", () => {
  assert.deepEqual(apply_count({ count: { param: "steps" } }, { id: "a.b", args: { x: 1 }, count: 4 }), {
    args: { x: 1, steps: 4 },
    times: 1,
  });
});

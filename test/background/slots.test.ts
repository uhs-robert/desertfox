import assert from "node:assert/strict";
import { test } from "node:test";
import { apply_slot_plan, plan_slots, slot_table } from "../../src/background/slots.ts";
import type { TreeBranch, TreeNode } from "../../src/shared/prefix_tree.ts";

function leaf(id: string): TreeNode {
  return { kind: "leaf", steps: [{ invocation: { id }, runs_in: "background", count_rule: "ignore" }] };
}
const root = (children: Record<string, TreeNode>): TreeBranch => ({ kind: "branch", children });

test("chords take slots in order and the rest are reset", () => {
  const plan = plan_slots(root({ "<A-j>": leaf("tab.next"), "<A-k>": leaf("tab.prev") }));
  assert.deepEqual(plan.assignments.map((a) => [a.slot_name, a.shortcut]), [["slot_1", "Alt+J"], ["slot_2", "Alt+K"]]);
  assert.equal(plan.unused_slot_names.length, 8);
  assert.deepEqual(slot_table(plan).slot_2, [{ id: "tab.prev" }]);
});

test("more than the slot count warns and drops the extras", () => {
  const children: Record<string, TreeNode> = {};
  for (const key of "abcdefghijkl") children[`<A-${key}>`] = leaf("x.y");
  const plan = plan_slots(root(children));
  assert.equal(plan.assignments.length, 10);
  assert.match(plan.warnings.join("\n"), /2 chord\(s\) skipped/);
});

test("sequences and bare keys warn", () => {
  const plan = plan_slots(root({ g: { kind: "branch", children: { a: leaf("x.y") } }, j: leaf("x.y") }));
  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.warnings.length, 2);
});

test("no browser section resets every slot", () => {
  assert.equal(plan_slots(undefined).unused_slot_names.length, 10);
});

test("apply updates used slots, resets the rest and reports refusals", async () => {
  const calls: string[] = [];
  const plan = plan_slots(root({ "<A-j>": leaf("a.b"), "<A-k>": leaf("a.b") }), 3);
  const warnings = await apply_slot_plan(plan, {
    update: async ({ name, shortcut }) => {
      calls.push(`update ${name} ${shortcut}`);
      if (shortcut === "Alt+K") throw new Error("taken");
    },
    reset: async (name) => void calls.push(`reset ${name}`),
  });
  assert.deepEqual(calls, ["reset slot_3", "update slot_1 Alt+J", "update slot_2 Alt+K"]);
  assert.equal(warnings.length, 1);
});

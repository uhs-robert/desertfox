import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { item_select_keys, with_item_select } from "../../src/background/item_select.ts";
import type { LeafStep, TreeBranch, TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const keys = item_select_keys((id) => registry.get(id), {})!;
const item_step = (direction: string, selector = ".row", jump = false): LeafStep => ({ invocation: { id: "page.item", args: { selector, direction } }, runs_in: "content", count_rule: { param: "times" }, bundle: "item", ...(jump && { jump: true as const }) });
const leaf_of = (...steps: LeafStep[]): TreeLeaf => ({ kind: "leaf", steps });
const tree_of = (leaf: TreeLeaf): TreeBranch => ({ kind: "branch", children: { x: leaf } });
const rewritten = (...steps: LeafStep[]): LeafStep[] => ((with_item_select(tree_of(leaf_of(...steps)), keys).children["x"]) as TreeLeaf).steps;
const shape = (steps: LeafStep[]) => steps.map((step) => (step.invocation.id === "page.item" ? `item:${step.invocation.args?.["direction"]}` : String(step.invocation.args?.["key"])));

test("the arrow steps come from the registry with its side, bundle and count rule", () => {
  const command = registry.get("page.send_key")!;
  for (const [direction, key, key_code] of [["down", "ArrowDown", 40], ["up", "ArrowUp", 38], ["left", "ArrowLeft", 37], ["right", "ArrowRight", 39]] as const) {
    const step = keys[direction];
    assert.deepEqual([step.invocation.id, step.invocation.args?.["key"], step.invocation.args?.["key_code"], step.invocation.args?.["times"]], ["page.send_key", key, key_code, 1]);
    assert.deepEqual([step.runs_in, step.bundle, step.count_rule], [command.runs_in, command.bundle, command.count]);
  }
  assert.equal(item_select_keys(() => undefined, {}), undefined);
});

test("a move focuses the current item and then sends the arrow, which keeps the count rule of the key", () => {
  for (const [direction, arrow] of [["down", "ArrowDown"], ["up", "ArrowUp"], ["left", "ArrowLeft"], ["right", "ArrowRight"]] as const) {
    const steps = rewritten(item_step(direction));
    assert.deepEqual(shape(steps), ["item:current", arrow], direction);
    assert.equal(steps[0]?.invocation.args?.["selector"], ".row");
    assert.equal(steps[0]?.count_rule, "ignore");
    assert.deepEqual(steps[1]?.count_rule, { param: "times" });
  }
});

test("a move with its own times sends the arrow that many times, and one without keeps the default", () => {
  const counted = item_step("down");
  const [, arrow] = rewritten({ ...counted, invocation: { ...counted.invocation, args: { ...counted.invocation.args, times: 3 } } });
  assert.equal(arrow?.invocation.args?.["times"], 3);
  assert.equal(arrow?.invocation.args?.["key"], "ArrowDown");
  assert.equal(rewritten(item_step("down"))[1]?.invocation.args?.["times"], 1);
  assert.equal(keys.down.invocation.args?.["times"], 1);
});

test("the ends keep their scroll and jump, then come back to the end item with an arrow pair that ignores the count", () => {
  for (const [direction, expected] of [["last", ["item:last", "item:current", "ArrowUp", "ArrowDown"]], ["first", ["item:first", "item:current", "ArrowDown", "ArrowUp"]]] as const) {
    const steps = rewritten(item_step(direction, ".row", true));
    assert.deepEqual(shape(steps), expected, direction);
    assert.deepEqual(steps.map((step) => step.jump), [true, undefined, undefined, undefined], direction);
    assert.deepEqual(steps.slice(1).map((step) => step.count_rule), ["ignore", "ignore", "ignore"], direction);
  }
});

test("current and the section jumps keep themselves and send no arrows", () => {
  for (const direction of ["current", "next_section", "prev_section"]) assert.deepEqual(shape(rewritten(item_step(direction))), [`item:${direction}`], direction);
});

test("a step with no selector and any other command stay as they are", () => {
  const finder = item_step("down", "");
  const other: LeafStep = { invocation: { id: "scroll.lines", args: { count: 10 } }, runs_in: "content", count_rule: "ignore" };
  assert.deepEqual(rewritten(finder, other), [finder, other]);
});

test("a choice list is rewritten at every choice, and the input tree is not changed", () => {
  const tree: TreeBranch = { kind: "branch", children: { g: { kind: "branch", children: { g: { ...leaf_of(item_step("first")), otherwise: { ...leaf_of(item_step("down", ".other")), otherwise: leaf_of(item_step("down", "")) } } } } } };
  const before = structuredClone(tree);
  const result = with_item_select(tree, keys);
  assert.deepEqual(tree, before);
  const first = (result.children["g"] as TreeBranch).children["g"] as TreeLeaf;
  assert.deepEqual(shape(first.steps), ["item:first", "item:current", "ArrowDown", "ArrowUp"]);
  assert.deepEqual(shape(first.otherwise!.steps), ["item:current", "ArrowDown"]);
  assert.deepEqual(shape(first.otherwise!.otherwise!.steps), ["item:down"]);
});

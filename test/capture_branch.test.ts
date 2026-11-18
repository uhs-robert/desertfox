import assert from "node:assert/strict";
import test from "node:test";
import { ANY_KEY, capture_branch, type TreeLeaf } from "../src/shared/prefix_tree.ts";

const leaf: TreeLeaf = { kind: "leaf", label: "Set a mark", steps: [] };

test("capture_branch puts the leaf under the any-key child and keeps its label", () => {
  assert.deepEqual(capture_branch(leaf), { kind: "branch", label: "Set a mark", children: { [ANY_KEY]: leaf } });
});

test("capture_branch adds the extra children and leaves out a missing label", () => {
  const bare: TreeLeaf = { kind: "leaf", steps: [] };
  const branch = capture_branch(bare, { live: leaf });
  assert.deepEqual([Object.keys(branch.children), "label" in branch], [[ANY_KEY, "live"], false]);
});

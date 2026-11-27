// The rewrite half of the `item_select` setting set to `arrows`: a site that keeps its own selection (a file list where Enter opens the selected file) moves it with its own arrow keys. Shared, so the locked page shim resolves the same trees the background does. The arrow steps come from the registry in `background/item_select.ts`, which needs the validator that this file leaves out.

import type { ItemSelectKeys, LeafStep, TreeBranch, TreeLeaf, TreeNode } from "../prefix_tree.ts";

const MOVES = ["down", "up", "left", "right"];

// The validator fills a missing selector with an empty string, so the finder keys read as empty here.
const names_selector = (step: LeafStep): boolean => step.invocation.id === "page.item" && typeof step.invocation.args?.["selector"] === "string" && step.invocation.args["selector"] !== "";
const direction_of = (step: LeafStep): unknown => step.invocation.args?.["direction"];

// The added step ignores the count: a counted move runs the arrow `times` times, not the refocus.
const current_step = (step: LeafStep): LeafStep => {
  const { jump: _jump, ...rest } = step;
  return { ...rest, invocation: { ...step.invocation, args: { ...step.invocation.args, direction: "current" } }, count_rule: "ignore" };
};

// A move of `times` items sends the arrow that many times. A typed count still replaces it at run time.
const with_times_of = (move: LeafStep, arrow: LeafStep): LeafStep => {
  const times = move.invocation.args?.["times"];
  return typeof times === "number" ? { ...arrow, invocation: { ...arrow.invocation, args: { ...arrow.invocation.args, times } } } : arrow;
};

// A move becomes "focus the current item, then send the site's arrow", so the site moves its own selection. The `current` step first puts the focus back on the item when the site redrew it, or the arrow would go to the body.
const steps_after_rewrite = (step: LeafStep, keys: ItemSelectKeys): LeafStep[] => {
  // The arrows cannot walk a list the row does not name, so its picker offers the row's list alone.
  if (step.invocation.id === "hint.run" && step.invocation.args?.["items"]) return [{ ...step, invocation: { ...step.invocation, args: { ...step.invocation.args, row_only: true } } }];
  if (!names_selector(step)) return [step];
  const direction = direction_of(step) as string;
  if (MOVES.includes(direction)) return [current_step(step), with_times_of(step, keys[direction as keyof ItemSelectKeys])];
  // The end keys (gg, G), `current` (the picker's landing) and the section jumps send no arrows: Drive drops an arrow that follows another within about 100 ms. In Drive, gg and G move Desert Fox's focus but not Drive's selection.
  return [step];
};

const rewrite_leaf = (leaf: TreeLeaf, keys: ItemSelectKeys): TreeLeaf => ({ ...leaf, steps: leaf.steps.flatMap((step) => steps_after_rewrite(step, keys)), ...(leaf.otherwise && { otherwise: rewrite_leaf(leaf.otherwise, keys) }) });
const rewrite_node = (node: TreeNode, keys: ItemSelectKeys): TreeNode =>
  node.kind === "leaf" ? rewrite_leaf(node, keys) : { ...node, children: Object.fromEntries(Object.entries(node.children).map(([token, child]) => [token, rewrite_node(child, keys)])) };

// Returns a copy: the stored keymap is cached in memory and shared between pages.
export const with_item_select = (tree: TreeBranch, keys: ItemSelectKeys): TreeBranch => rewrite_node(tree, keys) as TreeBranch;

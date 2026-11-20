// The `item_select` setting set to `arrows`: a site that keeps its own selection (a file list where Enter opens the selected file) moves it with its own arrow keys. The page's item tree is rewritten when the page asks for its keymap, so item.js and content.js carry nothing for it.

import type { CommandDef } from "../shared/command.ts";
import type { ItemSelectKeys, LeafStep, TreeBranch, TreeLeaf, TreeNode } from "../shared/prefix_tree.ts";
import { check_args } from "../shared/registry/check_args.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";

const ARROWS = { down: { key: "ArrowDown", key_code: 40 }, up: { key: "ArrowUp", key_code: 38 }, left: { key: "ArrowLeft", key_code: 37 }, right: { key: "ArrowRight", key_code: 39 } } as const;

// The arrow steps come from the registry through the one validator, so their defaults, side and bundle are never copied by hand. A count sends the arrow that many times, as `page.send_key` says.
export function item_select_keys(get_command: (id: string) => Pick<CommandDef, "id" | "params" | "runs_in" | "count" | "bundle"> | undefined, enum_sources: EnumSources): ItemSelectKeys | undefined {
  const command = get_command("page.send_key");
  if (!command) return undefined;
  const steps = (Object.keys(ARROWS) as (keyof typeof ARROWS)[]).map((direction) => {
    const result = check_args(command, ARROWS[direction], enum_sources);
    const step: LeafStep = { invocation: { id: "page.send_key", args: result.ok ? result.args : {} }, runs_in: command.runs_in, count_rule: command.count ?? "ignore", ...(command.bundle && { bundle: command.bundle }) };
    return result.ok ? ([direction, step] as const) : undefined;
  });
  return steps.every((entry) => entry !== undefined) ? (Object.fromEntries(steps) as ItemSelectKeys) : undefined;
}

type End = "first" | "last";
const MOVES = ["down", "up", "left", "right"];

// The validator fills a missing selector with an empty string, so the finder keys read as empty here.
const names_selector = (step: LeafStep): boolean => step.invocation.id === "page.item" && typeof step.invocation.args?.["selector"] === "string" && step.invocation.args["selector"] !== "";
const direction_of = (step: LeafStep): unknown => step.invocation.args?.["direction"];

// Added steps ignore the count: the end steps go to one place, and a count would send the arrow pair that many times (or fail past the key limit).
const current_step = (step: LeafStep): LeafStep => {
  const { jump: _jump, ...rest } = step;
  return { ...rest, invocation: { ...step.invocation, args: { ...step.invocation.args, direction: "current" } }, count_rule: "ignore" };
};
const ignoring_count = (step: LeafStep): LeafStep => ({ ...step, count_rule: "ignore" });

// A move of `times` items sends the arrow that many times. A typed count still replaces it at run time.
const with_times_of = (move: LeafStep, arrow: LeafStep): LeafStep => {
  const times = move.invocation.args?.["times"];
  return typeof times === "number" ? { ...arrow, invocation: { ...arrow.invocation, args: { ...arrow.invocation.args, times } } } : arrow;
};

// A move becomes "focus the current item, then send the site's arrow", so the site moves its own selection. The end keys keep their scroll and follow, then come back to the end item with an arrow pair. Up then Down at the last item: a Down on the last row can make the site load more rows and leave its selection on a new one. The `current` step first puts the focus back on the end item when the site redrew it during the follow, or the arrows would go to the body.
const steps_after_rewrite = (step: LeafStep, keys: ItemSelectKeys): LeafStep[] => {
  // The arrows cannot walk a list the row does not name, so its picker offers the row's list alone.
  if (step.invocation.id === "hint.run" && step.invocation.args?.["items"]) return [{ ...step, invocation: { ...step.invocation, args: { ...step.invocation.args, row_only: true } } }];
  if (!names_selector(step)) return [step];
  const direction = direction_of(step) as string;
  if (MOVES.includes(direction)) return [current_step(step), with_times_of(step, keys[direction as keyof ItemSelectKeys])];
  if (direction === "first" || direction === "last") {
    const pair = (direction as End) === "last" ? [keys.up, keys.down] : [keys.down, keys.up];
    return [step, current_step(step), ...pair.map(ignoring_count)];
  }
  // `current` is the picker's landing, and a section jump lands on an item the same way. They select through a Down and Up, as the first end does. A jump that lands nowhere answers failed, which stops the sequence before the arrows.
  if (direction === "current" || direction === "next_section" || direction === "prev_section") return [step, ...[keys.down, keys.up].map(ignoring_count)];
  return [step];
};

const rewrite_leaf = (leaf: TreeLeaf, keys: ItemSelectKeys): TreeLeaf => ({ ...leaf, steps: leaf.steps.flatMap((step) => steps_after_rewrite(step, keys)), ...(leaf.otherwise && { otherwise: rewrite_leaf(leaf.otherwise, keys) }) });
const rewrite_node = (node: TreeNode, keys: ItemSelectKeys): TreeNode =>
  node.kind === "leaf" ? rewrite_leaf(node, keys) : { ...node, children: Object.fromEntries(Object.entries(node.children).map(([token, child]) => [token, rewrite_node(child, keys)])) };

// Returns a copy: the stored keymap is cached in memory and shared between pages.
export const with_item_select = (tree: TreeBranch, keys: ItemSelectKeys): TreeBranch => rewrite_node(tree, keys) as TreeBranch;

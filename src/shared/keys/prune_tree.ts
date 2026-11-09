// Prunes a copy of a mode's tree for a site rule. Only the compiler imports it, so the content script carries none of this.

import type { TreeBranch, TreeNode } from "../prefix_tree.ts";

type Sequences = readonly (readonly string[])[];

// A listed sequence covers its whole subtree: passing `g` frees every `g` binding, passing `gg` frees that binding alone.
// A branch left with no child goes too, so no prefix waits for a key that binds nothing.
function without(node: TreeNode, sequences: Sequences): TreeNode | undefined {
  if (node.kind === "leaf") return node;
  const children: Record<string, TreeNode> = {};
  for (const [token, child] of Object.entries(node.children)) {
    const below = sequences.filter((sequence) => sequence[0] === token).map((sequence) => sequence.slice(1));
    if (below.some((rest) => rest.length === 0)) continue;
    const kept = without(child, below);
    if (kept !== undefined) children[token] = kept;
  }
  return Object.keys(children).length === 0 ? undefined : { ...node, children };
}

function only(node: TreeNode, sequences: Sequences): TreeNode | undefined {
  if (sequences.some((sequence) => sequence.length === 0)) return node;
  if (node.kind === "leaf") return undefined;
  const children: Record<string, TreeNode> = {};
  for (const [token, child] of Object.entries(node.children)) {
    const below = sequences.filter((sequence) => sequence[0] === token).map((sequence) => sequence.slice(1));
    const kept = below.length === 0 ? undefined : only(child, below);
    if (kept !== undefined) children[token] = kept;
  }
  return Object.keys(children).length === 0 ? undefined : { ...node, children };
}

const EMPTY_ROOT: TreeBranch = { kind: "branch", children: {} };

// Shares unchanged subtrees with the input and never mutates it. The result is empty when nothing is left.
export function prune_tree(root: TreeBranch, rule: { pass: Sequences } | { only: Sequences }): TreeBranch {
  const pruned = "pass" in rule ? without(root, rule.pass) : only(root, rule.only);
  return pruned?.kind === "branch" ? pruned : EMPTY_ROOT;
}

export const is_empty_tree = (branch: TreeBranch): boolean => Object.keys(branch.children).length === 0;

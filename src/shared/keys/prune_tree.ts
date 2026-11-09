// Prunes a copy of a mode's tree for a site rule. The compiler runs it to learn whether a rule leaves any key, the content script to get the page's tree, and which-key to list only the keys that still run.

import type { TreeBranch, TreeNode } from "../prefix_tree.ts";

type Sequences = readonly (readonly string[])[];

// A listed sequence covers its whole subtree: passing `g` frees every `g` binding, passing `gg` frees that binding alone.
// A subtree no listed sequence names is shared with the input. A branch left with no child goes, so no prefix waits for a key that binds nothing.
function without(node: TreeNode, sequences: Sequences): TreeNode | undefined {
  if (node.kind === "leaf") return node;
  const children: Record<string, TreeNode> = {};
  for (const [token, child] of Object.entries(node.children)) {
    const below = sequences.filter((sequence) => sequence[0] === token).map((sequence) => sequence.slice(1));
    if (below.some((rest) => rest.length === 0)) continue;
    if (below.length === 0) {
      children[token] = child;
      continue;
    }
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

export type KeyRule = { pass: Sequences } | { only: Sequences };

// `only` keeps these even when unlisted: the one-shot pass and the way into ignore mode. Escape is not kept, so a normal-mode Escape reaches the page. Insert mode has its own tree and still leaves on Escape.
const ESCAPE_KEYS: Sequences = [["<C-v>"], ["<S-Escape>"]];

const EMPTY_ROOT: TreeBranch = { kind: "branch", children: {} };

// Shares unchanged subtrees with the input and never mutates it. The result is empty when nothing is left.
export function prune_tree(root: TreeBranch | undefined, rule: KeyRule): TreeBranch {
  const pruned = root && ("pass" in rule ? without(root, rule.pass) : only(root, [...rule.only, ...ESCAPE_KEYS]));
  return pruned?.kind === "branch" ? pruned : EMPTY_ROOT;
}

export const is_empty_tree = (branch: TreeBranch): boolean => Object.keys(branch.children).length === 0;

// Whether the rule hands this single key to the page even where the tree never binds it: `/`, `'` and the digits, which the key flow would otherwise cancel or take as a count.
// Under `only` every key but the first key of a listed sequence goes to the page.
export const rule_frees = (rule: KeyRule, token: string): boolean =>
  "pass" in rule ? rule.pass.some((sequence) => sequence.length === 1 && sequence[0] === token) : ![...rule.only, ...ESCAPE_KEYS].some((sequence) => sequence[0] === token);

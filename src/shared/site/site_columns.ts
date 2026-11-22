// The page's site table columns and the normal tree under them: the pure half of `page_keymap.ts`, shared with the help page's Site Rules view and the popup.

import type { CompiledKeymap, PageFrees, SiteBind, SiteRule, TreeBranch, TreeLeaf, TreeNode } from "../prefix_tree.ts";
import { frees_of, is_empty_tree, prune_tree, type KeyRule } from "../keys/prune_tree.ts";
import { matches_any_address, resolve_site_columns, type ResolvedSiteColumns } from "../match_pattern.ts";

export type PageSiteColumns = ResolvedSiteColumns<KeyRule, SiteBind>;

// The page's columns of the site table, for the page's key handling and for which-key alike.
export const site_columns_for = (keymap: CompiledKeymap | undefined, addresses: readonly (string | undefined)[]): PageSiteColumns => resolve_site_columns(site_rules_matching(keymap, addresses));

// The rows that fit the page, in table order.
export const site_rules_matching = (keymap: CompiledKeymap | undefined, addresses: readonly (string | undefined)[]): SiteRule[] => (keymap?.site_rules ?? []).filter(({ regex }) => matches_any_address(regex, addresses));

// The bind among `all` whose keys are a proper prefix of this bind's keys. It is a complete binding, so it hides this bind.
export const hiding_bind = (all: readonly SiteBind[], { tokens }: SiteBind): SiteBind | undefined => all.find((other) => other.tokens.length < tokens.length && other.tokens.every((token, index) => tokens[index] === token));

// A guarded bind keeps the leaf it replaces at the end of its chain of choices, so the key falls through to it when every guard fails. A choice with no guard ends the chain. A bind with `otherwise = "page"` keeps nothing: a failed guard leaves no leaf, and the content script hands the real key to the page. A replaced branch is not kept: falling through to it means waiting for more keys after the key already ran.
const is_guarded = (leaf: TreeLeaf): boolean => leaf.when_focus !== undefined || leaf.when_present !== undefined;
const with_otherwise = (leaf: TreeLeaf, replaced: TreeNode | undefined): TreeLeaf =>
  !is_guarded(leaf) || replaced?.kind !== "leaf" || leaf.otherwise_page ? leaf : { ...leaf, otherwise: leaf.otherwise ? with_otherwise(leaf.otherwise, replaced) : replaced };

// A bound key replaces whatever the tree holds at that key. A key under a leaf of the tree turns the leaf into a branch, and a bind that is a prefix of tree keys replaces the whole subtree. Copies the path and never mutates the input.
export function graft_binds(root: TreeBranch | undefined, binds: Readonly<Record<string, SiteBind>>): TreeBranch {
  const grafted: TreeBranch = root ?? { kind: "branch", children: {} };
  const put = (branch: TreeBranch, tokens: readonly string[], leaf: TreeLeaf): TreeBranch => {
    const [token, ...rest] = tokens as [string, ...string[]];
    const below = branch.children[token];
    const child: TreeNode = rest.length === 0 ? with_otherwise(leaf, below) : put(below?.kind === "branch" ? below : { kind: "branch", children: {} }, rest, leaf);
    return { ...branch, children: { ...branch.children, [token]: child } };
  };
  // A bind that sits under another bind is dropped, as a complete binding hides the keys under it in a keymap. The compiler warns about the pair for rows of one site. Under a leaf of the tree itself a bind wins and the leaf becomes a branch.
  const all = Object.values(binds);
  return all.filter((bind) => hiding_bind(all, bind) === undefined).reduce((tree, { tokens, leaf }) => put(tree, tokens, leaf), grafted);
}

// The normal tree under the page's columns. `off` wins over all of it. Binds go onto the tree first, then the key rule prunes, so `pass` frees a bound key and `only` keeps it. A page whose key rule leaves no normal binding is all off and keeps the whole tree, so `,i` can leave ignore mode.
export function normal_tree_for(normal: TreeBranch | undefined, columns: PageSiteColumns): { tree: TreeBranch | undefined; all_off: boolean } | { tree: TreeBranch; all_off: false; frees: PageFrees } {
  if (columns.off === true) return { tree: normal, all_off: true };
  const bound = columns.bind === undefined ? normal : graft_binds(normal, columns.bind);
  if (columns.keys === undefined) return { tree: bound, all_off: false };
  const pruned = prune_tree(bound, columns.keys);
  return is_empty_tree(pruned) ? { tree: normal, all_off: true } : { tree: pruned, all_off: false, frees: frees_of(columns.keys) };
}

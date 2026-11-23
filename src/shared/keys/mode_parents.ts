// Gives a child mode the keys of its parent mode (`mode_parents` in the default keymap). The stored keymap holds each mode's own tree, so every reader of a child's tree resolves it here, after the page's row grafts and key rules. The content script never imports this file: it gets resolved trees.

import type { CompiledKeymap, CompiledModeParent, LeafStep, TreeBranch, TreeLeaf, TreeNode } from "../prefix_tree.ts";
import type { KeymapMode } from "../keymap.ts";

type Modes = CompiledKeymap["modes"];

// `runs` holds the commands that run in the mode the taken keys run in, from the registry's `modes` at compile time.
const leaf_may_run = (leaf: TreeLeaf, runs: ReadonlySet<string>): boolean => leaf.steps.every((step) => runs.has(step.invocation.id)) && (leaf.otherwise === undefined || leaf_may_run(leaf.otherwise, runs));

// Every choice of a guard chain leaves, since any of them can be the one that runs.
const with_leave = (leaf: TreeLeaf, leave: LeafStep): TreeLeaf => ({ ...leaf, steps: [leave, ...leaf.steps], ...(leaf.otherwise && { otherwise: with_leave(leaf.otherwise, leave) }) });

// The parent's keys the child may take: those whose commands all run in the mode the key runs in. A group left with no key goes.
function inheritable(node: TreeNode, runs: ReadonlySet<string>, leave: LeafStep | undefined): TreeNode | undefined {
  if (node.kind === "leaf") return !leaf_may_run(node, runs) ? undefined : leave ? with_leave(node, leave) : node;
  const children = Object.entries(node.children).flatMap(([token, child]) => {
    const kept = inheritable(child, runs, leave);
    return kept ? [[token, kept] as const] : [];
  });
  return children.length === 0 ? undefined : { ...node, children: Object.fromEntries(children) };
}

// A blocked key goes with everything under it, so a blocked prefix drops its whole group. A group left with no key goes too.
function without_path(branch: TreeBranch, tokens: readonly string[]): TreeBranch | undefined {
  const [token, ...rest] = tokens;
  const child = token === undefined ? undefined : branch.children[token];
  if (child === undefined || (child.kind === "leaf" && rest.length > 0)) return branch;
  const { [token!]: _removed, ...others } = branch.children;
  const kept = rest.length === 0 || child.kind === "leaf" ? undefined : without_path(child, rest);
  const children = kept ? { ...others, [token!]: kept } : others;
  return Object.keys(children).length === 0 ? undefined : { ...branch, children };
}

// The child's own keys win at every node: an own leaf hides a parent group, an own group hides a parent leaf, and two groups merge.
function overlay(own: TreeBranch, under: TreeBranch): TreeBranch {
  const children: Record<string, TreeNode> = { ...under.children };
  for (const [token, child] of Object.entries(own.children)) {
    const below = under.children[token];
    children[token] = child.kind === "branch" && below?.kind === "branch" ? overlay(child, below) : child;
  }
  const label = own.label ?? under.label;
  return { kind: "branch", ...(label !== undefined && { label }), children };
}

function child_tree(own: TreeBranch | undefined, parent: TreeBranch | undefined, link: CompiledModeParent): TreeBranch | undefined {
  let taken = parent && (inheritable(parent, new Set(link.runs), link.leave) as TreeBranch | undefined);
  for (const tokens of link.blocked ?? []) taken = taken && without_path(taken, tokens);
  if (!taken) return own;
  return own ? overlay(own, taken) : taken;
}

// `modes` are one page's trees, or the stored ones. A parent resolves before its child, so a grandchild gets the keys its parent took. A loop of links stops at the mode it started from.
export function resolve_mode_parents(modes: Modes, parents: CompiledKeymap["mode_parents"]): Modes {
  if (!parents) return modes;
  const resolved: Modes = { ...modes };
  const done = new Set<KeymapMode>();
  const resolve = (mode: KeymapMode, visiting: ReadonlySet<KeymapMode>): TreeBranch | undefined => {
    const link = parents[mode];
    if (!link || done.has(mode) || visiting.has(mode)) return resolved[mode];
    const parent = resolve(link.parent, new Set([...visiting, mode]));
    const tree = child_tree(modes[mode], parent, link);
    if (tree) resolved[mode] = tree;
    done.add(mode);
    return tree;
  };
  for (const mode of Object.keys(parents) as KeymapMode[]) resolve(mode, new Set());
  return resolved;
}

// The steps a key listing shows: the leave step is how the key runs, not what it does.
export const shown_steps = (leaf: TreeLeaf): LeafStep[] => leaf.steps.filter((step) => !step.leave);

// The stored keymap with every child tree resolved, for a reader that has no page.
export const with_resolved_modes = (keymap: CompiledKeymap): CompiledKeymap => (keymap.mode_parents ? { ...keymap, modes: resolve_mode_parents(keymap.modes, keymap.mode_parents) } : keymap);

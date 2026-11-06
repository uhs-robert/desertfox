// Answers which-key: the keys that can follow a typed prefix, read from the compiled keymap the content script also uses.

import type { CommandMeta } from "../shared/command.ts";
import type { PageInfo } from "../shared/engines/index.ts";
import type { BoundInvocation } from "../shared/invocation.ts";
import type { WhichKeyBorder } from "../shared/config.ts";
import type { ListKeys, WhichKeyPanel, WhichKeyRow } from "../shared/messages.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch, TreeNode } from "../shared/prefix_tree.ts";

import { is_available } from "./availability.ts";

type KeymapStorage = Pick<typeof browser.storage.local, "get">;

function row_of(token: string, node: TreeNode, find_command: (id: string) => CommandMeta | undefined): WhichKeyRow {
  if (node.kind === "branch") return { keys: token, command: `+${node.label ?? token}`, description: "", more: true };
  const first = node.steps[0];
  const command = first && find_command(first.invocation.id);
  return { keys: token, command: node.label ?? command?.label ?? first?.invocation.id ?? "", description: command?.intent ?? "", more: false };
}

// Display order: letters (case-blind, so `t` before `T`), other plain keys, keys with a modifier, groups, Escape last.
// Within a class the order is by key, in code point order. Groups sort by name, case-blind, without the `+`.
function display_rank(row: WhichKeyRow): number {
  if (row.keys === "<Escape>") return 4;
  if (row.more) return 3;
  if (/^<[SACM]+-/.test(row.keys)) return 2;
  return /^[a-zA-Z]$/.test(row.keys) ? 0 : 1;
}

const compare_code_points = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function compare_rows(left: WhichKeyRow, right: WhichKeyRow): number {
  const by_class = display_rank(left) - display_rank(right);
  if (by_class !== 0) return by_class;
  if (left.more) return compare_code_points(left.command.slice(1).toLowerCase(), right.command.slice(1).toLowerCase());
  if (display_rank(left) !== 0) return compare_code_points(left.keys, right.keys);
  return compare_code_points(left.keys.toLowerCase(), right.keys.toLowerCase()) || compare_code_points(right.keys, left.keys);
}

// A prefix that no longer leads anywhere gives no rows. The title is the chain of groups, each part like the group's own row:
// `["+Go", "+Close tabs"]`. A group without a name shows its key. The panel joins the chain.
export function panel_after_prefix(root: TreeBranch | undefined, prefix: string[], find_command: (id: string) => CommandMeta | undefined, border: WhichKeyBorder = "square"): WhichKeyPanel {
  let node: TreeNode | undefined = root;
  const chain: string[] = [];
  for (const token of prefix) {
    node = node?.kind === "branch" ? node.children[token] : undefined;
    if (node?.kind === "branch") chain.push(`+${node.label ?? token}`);
  }
  if (node?.kind !== "branch") return { title: [], rows: [], border };
  const rows = Object.entries(node.children)
    .map(([token, child]) => row_of(token, child, find_command))
    .sort(compare_rows);
  return { title: chain.length === 0 ? ["keys"] : chain, rows, border };
}

// What the active page can run. Keys whose command needs slots the page cannot fill are left out, and so are groups left empty.
// `has_site_engine` answers for a `site_keys` key: whether one of its engines fits the page. Without it such a key stays.
export type PageAvailability = { page: PageInfo | undefined; requirement_of: (invocation: BoundInvocation) => string[]; has_site_engine?: (invocation: BoundInvocation) => boolean };

const fits_page = (invocation: BoundInvocation, availability: PageAvailability): boolean =>
  is_available(availability.requirement_of(invocation), availability.page) && (invocation.site_engines === undefined || availability.has_site_engine?.(invocation) !== false);

export function without_unavailable(node: TreeBranch, availability: PageAvailability): TreeBranch | undefined {
  const children: Record<string, TreeNode> = {};
  for (const [token, child] of Object.entries(node.children)) {
    if (child.kind === "branch") {
      const kept = without_unavailable(child, availability);
      if (kept) children[token] = kept;
    } else if (child.steps.every((step) => fits_page(step.invocation, availability))) {
      children[token] = child;
    }
  }
  return Object.keys(children).length === 0 ? undefined : { ...node, children };
}

export async function list_keys(
  storage: KeymapStorage,
  find_command: (id: string) => CommandMeta | undefined,
  request: Pick<ListKeys, "mode" | "prefix">,
  availability?: PageAvailability,
): Promise<WhichKeyPanel> {
  const stored = await storage.get(COMPILED_KEYMAP_STORAGE_KEY);
  const keymap = stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined;
  const root = keymap?.modes[request.mode as keyof CompiledKeymap["modes"]];
  const shown = root && availability ? without_unavailable(root, availability) : root;
  return panel_after_prefix(shown, request.prefix, find_command, keymap?.which_key_border);
}

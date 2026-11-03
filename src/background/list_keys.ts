// Answers which-key: the keys that can follow a typed prefix, read from the compiled keymap the content script also uses.

import type { CommandMeta } from "../shared/command.ts";
import type { ListKeys, WhichKeyRow } from "../shared/messages.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch, TreeNode } from "../shared/prefix_tree.ts";

type KeymapStorage = Pick<typeof browser.storage.local, "get">;

function count_leaves(node: TreeNode): number {
  return node.kind === "leaf" ? 1 : Object.values(node.children).reduce((total, child) => total + count_leaves(child), 0);
}

function row_of(token: string, node: TreeNode, find_command: (id: string) => CommandMeta | undefined): WhichKeyRow {
  if (node.kind === "branch") return { keys: token, command: `${count_leaves(node)} keys`, description: "", more: true };
  const first = node.steps[0];
  const command = first && find_command(first.invocation.id);
  return { keys: token, command: node.label ?? command?.label ?? first?.invocation.id ?? "", description: command?.intent ?? "", more: false };
}

// A prefix that no longer leads anywhere gives no rows.
export function rows_after_prefix(root: TreeBranch | undefined, prefix: string[], find_command: (id: string) => CommandMeta | undefined): WhichKeyRow[] {
  let node: TreeNode | undefined = root;
  for (const token of prefix) node = node?.kind === "branch" ? node.children[token] : undefined;
  if (node?.kind !== "branch") return [];
  return Object.entries(node.children)
    .map(([token, child]) => row_of(token, child, find_command))
    .sort((left, right) => left.keys.localeCompare(right.keys));
}

export async function list_keys(storage: KeymapStorage, find_command: (id: string) => CommandMeta | undefined, request: Pick<ListKeys, "mode" | "prefix">): Promise<WhichKeyRow[]> {
  const stored = await storage.get(COMPILED_KEYMAP_STORAGE_KEY);
  const keymap = stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined;
  return rows_after_prefix(keymap?.modes[request.mode as keyof CompiledKeymap["modes"]], request.prefix, find_command);
}

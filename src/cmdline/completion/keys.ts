// The keys column: for each command, the keys that run it bare, read once from the compiled keymap. The stored tree
// is already the merge of the defaults and the user's keymap, and its tokens are the which-key notation.

import type { CommandMeta } from "../../shared/command.ts";
import type { KeymapMode } from "../../shared/keymap.ts";
import type { CompiledKeymap, TreeNode } from "../../shared/prefix_tree.ts";
import { flag_params } from "../../shared/registry/params.ts";

// Keys shown before the rest fold into `+N`.
const SHOWN_KEYS = 2;

const by_length_then_code_point = (left: string, right: string) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);

// A binding runs the bare command when it has no args or only flags, and no prompt asking for the subject.
// `sg` (a search engine) and `o` with a prompt belong to the rows of their values, not to the command row.
function runs_bare(command: CommandMeta, args: Record<string, unknown> | undefined, prompted: boolean): boolean {
  const flags = new Set(flag_params(command).map((param) => param.name));
  return !prompted && Object.keys(args ?? {}).every((name) => flags.has(name));
}

function collect(node: TreeNode, path: string, commands: ReadonlyMap<string, CommandMeta>, into: Map<string, Set<string>>): void {
  if (node.kind === "branch") {
    for (const [token, child] of Object.entries(node.children)) collect(child, path + token, commands, into);
    return;
  }
  for (const { invocation } of node.steps) {
    const command = commands.get(invocation.id);
    if (!command || !runs_bare(command, invocation.args, invocation.prompt !== undefined)) continue;
    into.set(invocation.id, (into.get(invocation.id) ?? new Set()).add(path));
  }
}

// Only the line's own mode counts, plus `browser`, whose keys work in every mode.
export function key_labels(keymap: CompiledKeymap | undefined, commands: readonly CommandMeta[], line_mode: string): Map<string, string> {
  const by_id = new Map(commands.map((command) => [command.id, command]));
  const sequences = new Map<string, Set<string>>();
  for (const mode of [line_mode as KeymapMode, "browser" as const]) {
    const root = keymap?.modes[mode];
    if (root) collect(root, "", by_id, sequences);
  }
  const labels = new Map<string, string>();
  for (const [id, found] of sequences) {
    const sorted = [...found].sort(by_length_then_code_point);
    const rest = sorted.length - SHOWN_KEYS;
    labels.set(id, [...sorted.slice(0, SHOWN_KEYS), ...(rest > 0 ? [`+${rest}`] : [])].join(" "));
  }
  return labels;
}

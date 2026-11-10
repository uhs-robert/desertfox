// The keys column: for each command, the keys that run it bare, read once from the compiled keymap. The stored tree
// is already the merge of the defaults and the user's keymap, and its tokens are the which-key notation.

import type { CommandMeta } from "../../shared/command.ts";
import type { KeymapMode } from "../../shared/keymap.ts";
import { token_label } from "../../shared/prefix_tree.ts";
import type { CompiledKeymap, TreeNode } from "../../shared/prefix_tree.ts";
import { default_of, flag_params } from "../../shared/registry/params.ts";

// Keys shown before the rest fold into `+N`.
const SHOWN_KEYS = 2;

// Lowercase letters sort before uppercase ones once the case is swapped.
const swap_case = (text: string) => [...text].map((char) => (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase())).join("");

const by_length_lowercase_first = (left: string, right: string) => {
  const [swapped_left, swapped_right] = [swap_case(left), swap_case(right)];
  return left.length - right.length || (swapped_left < swapped_right ? -1 : swapped_left > swapped_right ? 1 : 0);
};

// The compiled tree fills defaults into `args`, so an arg set to its default says nothing. Only a value that differs from
// the default marks the binding.
// `none` runs the command with nothing typed after it, `flags` only with flags. Any other binding gives a value
// (`sg` for the google engine) and belongs to the row of that value.
function bareness(command: CommandMeta, args: Record<string, unknown> | undefined, prompted: boolean): "none" | "flags" | undefined {
  if (prompted) return undefined;
  const flags = new Set(flag_params(command).map((param) => param.name));
  let kind: "none" | "flags" = "none";
  for (const param of command.params ?? []) {
    const given = args?.[param.name];
    if (given === undefined) {
      if (default_of(command, param, args ?? {}) === undefined && param.type !== "bool" && !param.when) return undefined;
      continue;
    }
    if (JSON.stringify(given) === JSON.stringify(default_of(command, param, args ?? {}))) continue;
    if (!flags.has(param.name)) return undefined;
    kind = "flags";
  }
  return kind;
}

type Sequences = { none: Set<string>; flags: Set<string> };

function collect(node: TreeNode, path: string, commands: ReadonlyMap<string, CommandMeta>, into: Map<string, Sequences>): void {
  if (node.kind === "branch") {
    for (const [token, child] of Object.entries(node.children)) collect(child, path + token_label(token), commands, into);
    return;
  }
  for (const { invocation } of node.steps) {
    const command = commands.get(invocation.id);
    const kind = command && bareness(command, invocation.args, invocation.prompt !== undefined);
    if (!kind) continue;
    const found = into.get(invocation.id) ?? { none: new Set(), flags: new Set() };
    found[kind].add(path);
    into.set(invocation.id, found);
  }
}

// Only the line's own mode counts, plus `browser`, whose keys work in every mode.
export function key_labels(keymap: CompiledKeymap | undefined, commands: readonly CommandMeta[], line_mode: string): Map<string, string> {
  const by_id = new Map(commands.map((command) => [command.id, command]));
  const sequences = new Map<string, Sequences>();
  for (const mode of [line_mode as KeymapMode, "browser" as const]) {
    const root = keymap?.modes[mode];
    if (root) collect(root, "", by_id, sequences);
  }
  const labels = new Map<string, string>();
  for (const [id, found] of sequences) {
    // Keys that run the command alone come before the ones that set a flag.
    const sorted = [...[...found.none].sort(by_length_lowercase_first), ...[...found.flags].sort(by_length_lowercase_first)];
    const rest = sorted.length - SHOWN_KEYS;
    labels.set(id, [...sorted.slice(0, SHOWN_KEYS), ...(rest > 0 ? [`+${rest}`] : [])].join(" "));
  }
  return labels;
}

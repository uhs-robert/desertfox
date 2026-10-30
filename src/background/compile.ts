// Turns the default keymap plus the loaded config into the compiled tree.
// Each binding's args go through the one validator here, so a bad entry is
// skipped with a warning and the content script never sees it.

import type { CommandDef } from "../shared/command.ts";
import type { MergedConfig } from "../shared/config.ts";
import type { KeymapConfig } from "../shared/keymap.ts";
import type { CompiledKeymap, TreeBranch, TreeNode } from "../shared/prefix_tree.ts";
import { check_args } from "../shared/registry/check_args.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";
import { compile_keymap } from "../shared/keys/compiler.ts";
import { merge_keymaps } from "./keymap_merge.ts";

export type CompileInput = {
  config: MergedConfig;
  default_keymap: KeymapConfig;
  get_command: (command_id: string) => Pick<CommandDef, "id" | "label" | "params" | "runs_in" | "count"> | undefined;
  enum_sources: EnumSources;
};

export type CompileOutput = { compiled: CompiledKeymap; warnings: string[] };

export function compile_config(input: CompileInput): CompileOutput {
  const keymap = merge_keymaps(input.default_keymap, input.config.keymap);
  const { compiled, warnings } = compile_keymap(keymap, input.config.settings, (command_id) => {
    const command = input.get_command(command_id);
    return command && { runs_in: command.runs_in, label: command.label, count: command.count ?? "ignore" };
  });

  for (const [mode, root] of Object.entries(compiled.modes) as [string, TreeBranch][]) {
    check_branch(root, [], mode, input, warnings);
    if (Object.keys(root.children).length === 0) delete compiled.modes[mode as keyof CompiledKeymap["modes"]];
  }
  return { compiled, warnings };
}

// Checks and prunes in place.
function check_branch(branch: TreeBranch, path: string[], mode: string, input: CompileInput, warnings: string[]): void {
  for (const [token, node] of Object.entries(branch.children)) {
    if (keep_node(node, [...path, token], mode, input, warnings)) continue;
    delete branch.children[token];
  }
}

function keep_node(node: TreeNode, path: string[], mode: string, input: CompileInput, warnings: string[]): boolean {
  if (node.kind === "branch") {
    check_branch(node, path, mode, input, warnings);
    return Object.keys(node.children).length > 0;
  }
  for (const step of node.steps) {
    const command = input.get_command(step.invocation.id);
    if (!command) continue;
    const result = check_args(command, step.invocation.args, input.enum_sources);
    if (result.ok) {
      // Defaults filled in, so a content-side leaf runs without the registry.
      step.invocation = { ...step.invocation, args: result.args };
    } else if (result.missing_param === undefined) {
      warnings.push(`${mode}: skipped "${path.join("")}": ${result.error}`);
      return false;
    }
    // A missing param means the binding wants a prompt. It stays and the router refuses it until phase 2.
  }
  return true;
}

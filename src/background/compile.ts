// Turns the default keymap plus the loaded config into the compiled tree.
// Each binding's args go through the one validator here, so a bad entry is
// skipped with a warning and the content script never sees it.

import type { CommandDef, Mode } from "../shared/command.ts";
import type { MergedConfig } from "../shared/config.ts";
import type { KeymapConfig } from "../shared/keymap.ts";
import type { CompiledKeymap, TreeBranch, TreeNode } from "../shared/prefix_tree.ts";
import type { Prompt } from "../shared/invocation.ts";
import { find_param, is_context_source } from "../shared/registry/params.ts";
import { check_args } from "../shared/registry/check_args.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";
import { DEFAULT_PALETTE, is_palette_name, palette_or_default, resolve_mode_colors } from "../shared/mode_colors.ts";
import { compile_keymap } from "../shared/keys/compiler.ts";
import { merge_keymaps } from "./keymap_merge.ts";

export type CompileInput = {
  config: MergedConfig;
  default_keymap: KeymapConfig;
  get_command: (command_id: string) => Pick<CommandDef, "id" | "label" | "params" | "runs_in" | "count" | "modes"> | undefined;
  enum_sources: EnumSources;
};

export type CompileOutput = { compiled: CompiledKeymap; warnings: string[] };

export function compile_config(input: CompileInput): CompileOutput {
  const keymap = merge_keymaps(input.default_keymap, input.config.keymap);
  const { compiled, warnings } = compile_keymap(keymap, input.config.settings, (command_id) => {
    const command = input.get_command(command_id);
    return command && { runs_in: command.runs_in, label: command.label, count: command.count ?? "ignore", params: command.params ?? [] };
  }, { engine_labels: Object.fromEntries(Object.entries(input.config.search_engines).map(([name, engine]) => [name, engine.label])) });

  const requested_palette = input.config.settings.palette;
  if (requested_palette !== undefined && !is_palette_name(requested_palette)) {
    warnings.push(`settings: palette "${String(requested_palette)}" is not an oasis palette, using ${DEFAULT_PALETTE}`);
  }
  compiled.mode_colors = resolve_mode_colors(palette_or_default(requested_palette));

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
    const mode_error = mode_problem(mode, command);
    if (mode_error) {
      warnings.push(`${mode}: skipped "${path.join("")}": ${mode_error}`);
      return false;
    }
    const prompt_error = prompt_problem(step.invocation.prompt, command);
    if (prompt_error) {
      warnings.push(`${mode}: skipped "${path.join("")}": ${prompt_error}`);
      return false;
    }
    if (step.invocation.prompt) {
      // The fixed args must be good. Only the prompted param may be left out.
      const fixed = check_args(command, step.invocation.args, input.enum_sources);
      if (!fixed.ok && fixed.missing_param === undefined) {
        warnings.push(`${mode}: skipped "${path.join("")}": ${fixed.error}`);
        return false;
      }
      // Only the router can open the command line with the typed text, so the step goes to the background.
      step.runs_in = "background";
      continue;
    }
    const result = check_args(command, step.invocation.args, input.enum_sources);
    if (result.ok) {
      // Defaults filled in, so a content-side leaf runs without the registry.
      step.invocation = { ...step.invocation, args: result.args };
    } else if (result.missing_param === undefined) {
      warnings.push(`${mode}: skipped "${path.join("")}": ${result.error}`);
      return false;
    } else {
      // A missing param means the binding wants a prompt. The router opens the command line for it.
      step.runs_in = "background";
    }
  }
  return true;
}

// Firefox shortcuts fire in the tab's normal mode, so a `browser` binding needs a command that runs there.
function mode_problem(keymap_mode: string, command: Pick<CommandDef, "id" | "modes">): string | undefined {
  const runtime_mode = keymap_mode === "browser" ? "normal" : keymap_mode;
  const allowed = command.modes ?? ["normal"];
  if (allowed.includes(runtime_mode as Mode)) return undefined;
  return `${command.id} runs in ${allowed.join(", ")} mode, not ${runtime_mode}`;
}

function prompt_problem(prompt: Prompt | undefined, command: Pick<CommandDef, "id" | "params">): string | undefined {
  if (!prompt) return undefined;
  if (!find_param(command, prompt.param)) return `prompt names "${prompt.param}", which is not a param of ${command.id}`;
  if (prompt.prefill !== undefined && !is_context_source(prompt.prefill)) return `prompt prefill is not a known context source`;
  return undefined;
}

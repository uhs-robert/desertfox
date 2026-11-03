// Turns the three inputs of the help page into plain rows. No DOM here, so tests can read the rows.

import { MODES } from "../shared/command.ts";
import type { CommandMeta, ParamDef, ParamValue } from "../shared/command.ts";
import type { KeymapMode } from "../shared/keymap.ts";
import type { Prompt } from "../shared/invocation.ts";
import type { CompiledKeymap, TreeNode } from "../shared/prefix_tree.ts";
import { is_context_source, is_dynamic_values } from "../shared/registry/params.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";
import { print_command } from "../shared/registry/print_command.ts";
import { subject_param } from "../shared/registry/params.ts";
import { flag_alternatives, usage_line } from "../shared/registry/usage.ts";

export type KeyRow = { mode: KeymapMode; keys: string; args: string };

export type ParamRow = {
  name: string;
  type: string;
  default: string;
  values: string;
  // How to type the param as a flag. Empty for the subject, which is typed bare.
  flags: string;
};

export type CommandRow = {
  id: string;
  label: string;
  intent: string;
  usage: string;
  params: ParamRow[];
  keys: KeyRow[];
};

export type HelpGroup = { name: string; commands: CommandRow[] };

export type HelpModel = { warnings: string[]; groups: HelpGroup[] };

const MODE_ORDER: readonly KeymapMode[] = [...MODES, "browser"];

function describe_value(value: ParamValue | { from: string }): string {
  return is_context_source(value) ? `from ${value.from}` : String(value);
}

function param_row(param: ParamDef, subject: ParamDef | undefined): ParamRow {
  let values = "";
  if (is_dynamic_values(param.values)) values = `from ${param.values.from}`;
  else if (param.values) values = param.values.join(", ");
  return {
    name: param.name,
    type: param.type,
    default: param.default === undefined ? "" : describe_value(param.default),
    values,
    flags: param === subject ? "" : flag_alternatives(param).join(" "),
  };
}

type Printing = { commands: Map<string, CommandMeta>; sources: EnumSources };

// The args as the command line writes them in the long style, without the command word.
function describe_args(sources: EnumSources, command: CommandMeta | undefined, args: Record<string, unknown> | undefined, count: number | undefined, prompt: Prompt | undefined): string {
  const parts: string[] = [];
  if (command && args && Object.keys(args).length > 0) {
    const text = print_command(command, args, { flags: "long", sources });
    parts.push(text.slice((command.name ?? command.id).length).trim());
  }
  if (count !== undefined) parts.push(`count=${count}`);
  if (prompt) parts.push(prompt.prefill ? `prompts for ${prompt.param}, prefilled from ${prompt.prefill.from}` : `prompts for ${prompt.param}`);
  return parts.join(" ");
}

// Every leaf lists under each command it runs, so a two-step binding shows on both.
function collect_keys(node: TreeNode, path: string[], mode: KeymapMode, into: Map<string, KeyRow[]>, printing: Printing): void {
  if (node.kind === "branch") {
    for (const [token, child] of Object.entries(node.children)) collect_keys(child, [...path, token], mode, into, printing);
    return;
  }
  for (const step of node.steps) {
    const rows = into.get(step.invocation.id) ?? [];
    rows.push({ mode, keys: path.join(""), args: describe_args(printing.sources, printing.commands.get(step.invocation.id), step.invocation.args, step.invocation.count, step.invocation.prompt) });
    into.set(step.invocation.id, rows);
  }
}

function keys_by_command(compiled: CompiledKeymap | undefined, printing: Printing): Map<string, KeyRow[]> {
  const into = new Map<string, KeyRow[]>();
  for (const mode of MODE_ORDER) {
    const root = compiled?.modes[mode];
    if (root) collect_keys(root, [], mode, into, printing);
  }
  return into;
}

// `sources` are the configured engine names, so a query that starts with one prints with its `--` guard.
export function build_help_model(commands: CommandMeta[], compiled: CompiledKeymap | undefined, warnings: string[], sources: EnumSources = {}): HelpModel {
  const keys = keys_by_command(compiled, { commands: new Map(commands.map((command) => [command.id, command])), sources });
  const groups = new Map<string, CommandRow[]>();
  for (const command of commands) {
    const group_name = command.id.split(".")[0] ?? command.id;
    const row: CommandRow = {
      id: command.id,
      label: command.label,
      intent: command.intent,
      usage: usage_line(command),
      params: (command.params ?? []).map((param) => param_row(param, subject_param(command))),
      keys: keys.get(command.id) ?? [],
    };
    groups.set(group_name, [...(groups.get(group_name) ?? []), row]);
  }
  return {
    warnings,
    groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => ({ name, commands: rows })),
  };
}

// The public styling surface from design.md "Styles". Only surfaces that exist in phase 1 are listed.
export const STYLE_VARIABLES: { name: string; meaning: string }[] = [
  { name: "--oasisfox-bg", meaning: "Background of a surface" },
  { name: "--oasisfox-fg", meaning: "Text color" },
  { name: "--oasisfox-accent", meaning: "Highlight color for keys and the current item" },
  { name: "--oasisfox-font", meaning: "Font shorthand, for example 14px system-ui, sans-serif" },
  { name: "--oasisfox-radius", meaning: "Corner radius" },
];

export const STYLE_CLASSES: { name: string; meaning: string }[] = [
  { name: "oasisfox-toast", meaning: "The message toast a refused command shows in the page" },
  { name: "oasisfox-mode", meaning: "The badge that names the mode (NORMAL, INSERT, IGNORE, PASS)" },
];

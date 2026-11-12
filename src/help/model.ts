// Turns the three inputs of the help page into plain rows. No DOM here, so tests can read the rows.

import { MODES } from "../shared/command.ts";
import type { CommandMeta, ParamDef, ParamValue } from "../shared/command.ts";
import { DEFAULT_SETTINGS } from "../shared/config.ts";
import type { SearchEngine } from "../shared/config.ts";
import { search_engine_name } from "../commands/url_build.ts";
import type { ConfigStatus } from "../background/config_load.ts";
import { build_config_view } from "./config_view.ts";
import { ROLES } from "../shared/theme/roles.ts";
import type { Role } from "../shared/theme/roles.ts";
import { token_name } from "../shared/theme/tokens.ts";
import type { KeymapMode } from "../shared/keymap.ts";
import type { Prompt } from "../shared/invocation.ts";
import { token_label } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, TreeNode } from "../shared/prefix_tree.ts";
import { describe_default, is_dynamic_values, positional_params, source_text } from "../shared/registry/params.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";
import { print_command } from "../shared/registry/print_command.ts";
import { subject_param } from "../shared/registry/params.ts";
import type { Block } from "./blocks.ts";
import { site_rules_view } from "../background/site_rules_view.ts";
import type { SiteRulesView } from "../background/site_rules_view.ts";
import { quick_start_blocks, tip_block } from "./quick_start.ts";
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
  // The command line name, set by hand in the registry.
  name: string;
  label: string;
  intent: string;
  usage: string;
  params: ParamRow[];
  keys: KeyRow[];
  advanced: boolean;
};

export type HelpGroup = { name: string; commands: CommandRow[] };

export type EngineRow = {
  name: string;
  label: string;
  url: string;
  // The host alone, for a narrow table. The full url stays in `url`.
  host: string;
  // Every normal-mode key sequence that opens this engine, prefix included.
  keys: string[];
  // Page slots the engine needs, or "" when it runs anywhere.
  needs: string;
  // Where the engine falls back to, or "".
  fallback: string;
  // One "field: file [level]" line per field that has an origin.
  origins: string[];
  // The config files the origins name, without their level, in first-seen order.
  files: string[];
};

export type HelpModel = {
  warnings: string[];
  // Where the settings came from.
  config_source: string;
  // The commands to run after editing the config files.
  rebuild_steps: string[];
  groups: HelpGroup[];
  engines: EngineRow[];
  quick_start: Block[];
  tip: Block;
  // The Site Rules page's rows for one address, read from the keymap the model was built from.
  site_rules_for: (address: string) => SiteRulesView;
};

const MODE_ORDER: readonly KeymapMode[] = [...MODES, "browser"];

function param_row(param: ParamDef, subject: ParamDef | undefined, positional: readonly ParamDef[]): ParamRow {
  let values = "";
  if (is_dynamic_values(param.values)) values = `from ${param.values.from}`;
  else if (param.values) values = param.values.join(", ");
  return {
    name: param.name,
    type: param.type,
    default: describe_default(param),
    values,
    flags: param === subject || positional.includes(param) ? "" : flag_alternatives(param).join(" "),
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
  if (prompt) parts.push(prompt.prefill ? `prompts for ${prompt.param}, prefilled from ${source_text(prompt.prefill).slice(1)}` : `prompts for ${prompt.param}`);
  return parts.join(" ");
}

// Every leaf lists under each command it runs, so a two-step binding shows on both.
function collect_keys(node: TreeNode, path: string[], mode: KeymapMode, into: Map<string, KeyRow[]>, printing: Printing): void {
  if (node.kind === "branch") {
    for (const [token, child] of Object.entries(node.children)) collect_keys(child, [...path, token_label(token)], mode, into, printing);
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

// Parents before their children, siblings by name: github, github.code, github.repo, github.repo.code, github.repos.
function compare_engine_names(left: string, right: string): number {
  const left_path = left.split(".");
  const right_path = right.split(".");
  for (let depth = 0; depth < Math.min(left_path.length, right_path.length); depth++) {
    const order = left_path[depth]!.localeCompare(right_path[depth]!);
    if (order !== 0) return order;
  }
  return left_path.length - right_path.length;
}

// Only "<file> [<level>]" names a file. The resolver also writes "<name> (labels on the path)" and "generated under <path>".
const FILE_ORIGIN = /^(.+) \[[^\]]*\]$/;

// A url with slots such as {query} or {host:raw} is not parseable, so each slot becomes a numbered host-safe stand-in first and the original slot text is restored in the result.
function url_host(url: string): string {
  const slots: string[] = [];
  const parseable = url.replace(/\{[^}]*\}/g, (slot) => `slot-${slots.push(slot) - 1}-`);
  try {
    const host = new URL(parseable).host;
    return host ? host.replace(/slot-(\d+)-/g, (_, index) => slots[Number(index)]!) : url;
  } catch {
    return url;
  }
}

function collect_engine_keys(node: TreeNode, path: string[], default_engine: string, into: Map<string, string[]>): void {
  if (node.kind === "branch") {
    for (const [token, child] of Object.entries(node.children)) collect_engine_keys(child, [...path, token], default_engine, into);
    return;
  }
  for (const step of node.steps) {
    if (step.invocation.id !== "open.search") continue;
    const engine = search_engine_name(step.invocation.args?.engine, default_engine);
    into.set(engine, [...(into.get(engine) ?? []), path.join("")]);
  }
}

function engine_rows(engines: Record<string, SearchEngine>, compiled: CompiledKeymap | undefined, default_engine: string): EngineRow[] {
  const keys = new Map<string, string[]>();
  if (compiled?.modes.normal) collect_engine_keys(compiled.modes.normal, [], default_engine, keys);
  return Object.keys(engines)
    .sort(compare_engine_names)
    .map((name) => {
      const engine = engines[name]!;
      return {
        name,
        label: engine.label,
        url: engine.url,
        host: url_host(engine.url),
        keys: keys.get(name) ?? [],
        needs: (engine.slots ?? []).map((slot) => `{${slot}}`).join(" "),
        fallback: engine.fallback ?? "",
        origins: Object.entries(engine.origins ?? {}).map(([field, origin]) => `${field}: ${origin}`),
        files: [...new Set(Object.values(engine.origins ?? {}).flatMap((origin) => FILE_ORIGIN.exec(origin)?.[1] ?? []))],
      };
    });
}

// `sources` are the configured engine names, so a query that starts with one prints with its `--` guard.
export function build_help_model(commands: CommandMeta[], compiled: CompiledKeymap | undefined, warnings: string[], sources: EnumSources = {}, engines: Record<string, SearchEngine> = {}, status?: ConfigStatus): HelpModel {
  const config_view = build_config_view(status);
  const keys = keys_by_command(compiled, { commands: new Map(commands.map((command) => [command.id, command])), sources });
  const groups = new Map<string, CommandRow[]>();
  for (const command of commands) {
    const group_name = command.id.split(".")[0] ?? command.id;
    const row: CommandRow = {
      id: command.id,
      name: command.name ?? command.id,
      label: command.label,
      intent: command.intent,
      usage: usage_line(command),
      params: (command.params ?? []).map((param) => param_row(param, subject_param(command), positional_params(command))),
      keys: keys.get(command.id) ?? [],
      advanced: command.advanced === true,
    };
    groups.set(group_name, [...(groups.get(group_name) ?? []), row]);
  }
  return {
    warnings,
    config_source: config_view.source_text,
    rebuild_steps: config_view.rebuild_steps,
    engines: engine_rows(engines, compiled, status?.settings.default_engine ?? DEFAULT_SETTINGS.default_engine),
    quick_start: quick_start_blocks(compiled, commands),
    tip: tip_block(compiled, commands),
    site_rules_for: (address) => site_rules_view(compiled, address),
    groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => ({ name, commands: rows })),
  };
}

// The model the Commands page draws: without `advanced` commands unless the route asks for them. The one card a route names stays,
// so a `#command=<id>` link to an advanced command still lands on it. A group the filter empties drops out, so no heading stands alone.
export function visible_commands_model(model: HelpModel, show_advanced: boolean, named_command?: string): HelpModel {
  if (show_advanced) return model;
  const groups = model.groups.flatMap((group) => {
    const commands = group.commands.filter((command) => !command.advanced || command.id === named_command);
    return commands.length === 0 && group.commands.length > 0 ? [] : [{ name: group.name, commands }];
  });
  return { ...model, groups };
}

export const advanced_count = (model: HelpModel): number => model.groups.reduce((total, group) => total + group.commands.filter((command) => command.advanced).length, 0);

// The public styling surface from design.md "Styles" and "Themes".
const ROLE_MEANINGS: Record<Role, string> = {
  bg_core: "Background of a surface",
  bg_mantle: "A surface layered on bg_core, for panels and rows",
  bg_crust: "A second layer on bg_core, lighter than the mantle in a dark theme",
  selection: "Background of the selected row, and of the selection in visual mode",
  fg_core: "Text color",
  fg_comment: "Secondary text, such as descriptions",
  fg_dim: "Hints, such as the command line usage line",
  fg_muted: "Disabled text and faint marks",
  primary: "Brand color: links, titles, groups, hint labels",
  secondary: "Keys in which-key, and the new tab clock second hand",
  accent: "Highlight marks",
  border: "Borders and dividers",
  error: "Errors and refused commands",
  warn: "Warnings",
  ok: "Success",
  info: "Information",
  mode_normal: "Mode badge in normal mode",
  mode_insert: "Mode badge in insert mode",
  mode_ignore: "Mode badge in ignore mode",
  mode_caret: "Mode badge in caret mode and the caret cell, the Neovim cursor color",
  mode_visual: "Mode badge in visual mode",
  search_bg: "Background of every match of a / search and of the f and t targets",
  search_fg: "Text on those matches",
  search_current_bg: "Background of the current match",
  search_current_fg: "Text on the current match",
};

export const STYLE_VARIABLES: { name: string; meaning: string }[] = [
  { name: "--desertfox-font", meaning: "Font shorthand, for example 14px system-ui, sans-serif" },
  { name: "--desertfox-radius", meaning: "Corner radius" },
  ...ROLES.map((role) => ({ name: token_name(role), meaning: ROLE_MEANINGS[role] })),
];

export const STYLE_CLASSES: { name: string; meaning: string }[] = [
  { name: "desertfox-toast", meaning: "The message toast a refused command shows in the page" },
  { name: "desertfox-mode", meaning: "The badge that names the mode (NORMAL, INSERT, IGNORE, PASS)" },
  { name: "desertfox-whichkey", meaning: "The which-key panel" },
  { name: "desertfox-hint", meaning: "One hint label" },
  { name: "desertfox-hint-message", meaning: "The message hint mode shows at the bottom of the page" },
  { name: "desertfox-cmdline", meaning: "The command line panel" },
  { name: "desertfox-help-code", meaning: "A code block on the help page, holding the head and the body" },
  { name: "desertfox-help-code-head", meaning: "The row above a code block with the language label and the Copy button" },
  { name: "desertfox-help-code-lang", meaning: "The language label of a code block" },
  { name: "desertfox-help-code-copy", meaning: "The Copy button of a code block" },
  { name: "desertfox-help-code-body", meaning: "The code text of a code block" },
  { name: "desertfox-help-sections", meaning: "The list of section links under a page entry in the help sidebar" },
  { name: "desertfox-help-sections-toggle", meaning: "The button that expands and collapses a page's section list" },
  { name: "desertfox-help-topbar", meaning: "The bar with the menu button that a narrow help page shows on top" },
  { name: "desertfox-help-menu-toggle", meaning: "The menu button that opens and closes the help sidebar on a narrow page" },
  { name: "desertfox-help-backdrop", meaning: "The shade behind the open help sidebar on a narrow page, which closes it on a click" },
  { name: "desertfox-help-tip", meaning: "The tip callout at the top of the Home and Commands pages" },
  { name: "desertfox-help-tip-label", meaning: "The bold \"Tip\" word that starts the callout" },
  { name: "desertfox-help-inline-code", meaning: "A code snippet inside a sentence on the help page" },
  { name: "desertfox-help-shadowed", meaning: "A column or key on the Site Rules page that an earlier row already decides" },
];

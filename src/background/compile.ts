// Turns the default keymap plus the loaded config into the compiled tree.
// Each binding's args go through the one validator here, so a bad entry is
// skipped with a warning and the content script never sees it.

import type { CommandDef, Mode } from "../shared/command.ts";
import type { MergedConfig, Settings } from "../shared/config.ts";
import type { KeymapConfig } from "../shared/keymap.ts";
import { ANY_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch, TreeNode } from "../shared/prefix_tree.ts";
import type { Prompt } from "../shared/invocation.ts";
import { captured_key_param, find_param, is_context_source, without_param } from "../shared/registry/params.ts";
import { check_args } from "../shared/registry/check_args.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";
import { DEFAULT_LIGHT_INTENSITY, DEFAULT_PALETTE, DEFAULT_SETTINGS } from "../shared/config.ts";
import { DESKTOP_PALETTE, LIGHT_INTENSITIES } from "../shared/theme/roles.ts";
import { load_theme, local_theme_problem } from "../shared/theme/load.ts";
import type { StoredTheme } from "../shared/theme/apply.ts";
import type { Registry } from "../shared/registry/index.ts";
import { make_entry_resolver } from "../shared/config_build/resolve_binding.ts";
import { match_regex_source } from "../shared/match_pattern.ts";
import { compile_keymap } from "../shared/keys/compiler.ts";
import { default_rows_left_on } from "./default_site_rows.ts";
import type { DefaultSiteRow } from "./default_site_rows.ts";
import { default_layer_of, merge_keymaps } from "./keymap_merge.ts";

export type CompileInput = {
  config: MergedConfig;
  default_keymap: KeymapConfig;
  // The site rows that ship with DesertFox, after the user's rows. Absent means none.
  default_site_rows?: readonly DefaultSiteRow[];
  get_command: (command_id: string) => Pick<CommandDef, "id" | "label" | "params" | "runs_in" | "count" | "modes" | "bundle"> | undefined;
  enum_sources: EnumSources;
  // Parses the text of a site bind that a browser edit set, since only a config file goes through the build. Absent means such a bind is skipped with a warning.
  registry?: Registry;
  // The palette the desktop last pushed. `palette = "desktop"` shows it, or the default while none was pushed.
  desktop_palette?: string | undefined;
};

export type CompileOutput = { compiled: CompiledKeymap; theme: StoredTheme; warnings: string[] };

// A browser edit saves a bind as typed, so its text resolves here with the parser of the config build. A bad step is a warning and drops that bind.
function with_resolved_binds(rows: Settings["site_rules"], input: CompileInput, warnings: string[]): Settings["site_rules"] {
  if (input.registry === undefined) return rows;
  const { search_engines, command_aliases } = input.config;
  const registry = input.registry;
  const aliased: Registry = { ...registry, find: (word) => registry.find(word) ?? (Object.hasOwn(command_aliases, word) && !/\s/.test(word) ? registry.get(command_aliases[word]!) : undefined) };
  const resolve_entry = make_entry_resolver(aliased, { search_engines: Object.keys(search_engines) }, warnings);
  return rows.map((row) => {
    if (row.bind === undefined) return row;
    const bind: Record<string, unknown> = {};
    for (const [sequence, entry] of Object.entries(row.bind)) {
      const resolved = resolve_entry(entry, `site_rules: skipped bind "${sequence}" of "${row.site}"`);
      if (resolved !== undefined) bind[sequence] = resolved;
    }
    return { ...row, bind: bind as never };
  });
}

export function compile_config(input: CompileInput): CompileOutput {
  const keymap = merge_keymaps(input.default_keymap, input.config.keymap);
  const resolve_warnings: string[] = [];
  const user_rows = with_resolved_binds(input.config.settings.site_rules ?? DEFAULT_SETTINGS.site_rules, input, resolve_warnings);
  // The shipped rows rank after the user's, so a user row decides each column first.
  const settings = { ...input.config.settings, site_rules: [...user_rows, ...default_rows_left_on(input.default_site_rows ?? [], input.config.settings.default_site_rows_off ?? DEFAULT_SETTINGS.default_site_rows_off)] };
  const { compiled, warnings } = compile_keymap(keymap, settings, (command_id) => {
    const command = input.get_command(command_id);
    return command && { runs_in: command.runs_in, ...(command.bundle && { bundle: command.bundle }), label: command.label, count: command.count ?? "ignore", params: command.params ?? [], accepts_args: (args, prompt) => {
      // A captured key is filled when the key runs, so the rest of the args are checked without it.
      const captured = captured_key_param(command, args);
      const result = check_args(captured ? without_param(command, captured.name) : command, args, input.enum_sources);
      // The prompted param is filled when the key runs, as in keep_node.
      return result.ok || (prompt !== undefined && result.missing_param === prompt.param);
    } };
  }, { engine_labels: Object.fromEntries(Object.entries(input.config.search_engines).flatMap(([name, engine]) => (typeof engine?.label === "string" ? [[name, engine.label]] : []))) }, default_layer_of(input.default_keymap, input.config.keymap));

  const set_palette = input.config.settings.palette ?? DEFAULT_PALETTE;
  const requested_palette = set_palette === DESKTOP_PALETTE ? (input.desktop_palette ?? DEFAULT_PALETTE) : set_palette;
  let light_intensity = input.config.settings.light_intensity ?? DEFAULT_LIGHT_INTENSITY;
  if (!(LIGHT_INTENSITIES as readonly unknown[]).includes(light_intensity)) {
    warnings.push(`settings: light_intensity ${JSON.stringify(light_intensity)} is not 1 to 5, using ${DEFAULT_LIGHT_INTENSITY}`);
    light_intensity = DEFAULT_LIGHT_INTENSITY;
  }
  const requested_theme = load_theme(String(requested_palette), light_intensity, input.config.local_theme);
  if (!requested_theme) {
    const local_problem = input.config.local_theme?.name === requested_palette ? local_theme_problem(input.config.local_theme.colors) : undefined;
    warnings.push(`settings: palette "${String(requested_palette)}" ${local_problem ? `is a local theme with a problem: ${local_problem}` : "names no theme"}, using ${DEFAULT_PALETTE}`);
  }
  const theme = requested_theme ?? load_theme(DEFAULT_PALETTE, light_intensity)!;

  for (const [mode, root] of Object.entries(compiled.modes) as [string, TreeBranch][]) {
    check_branch(root, [], mode, input, warnings);
    if (Object.keys(root.children).length === 0) delete compiled.modes[mode as keyof CompiledKeymap["modes"]];
  }
  for (const rule of compiled.site_rules ?? []) {
    const site = (settings.site_rules as { site: string }[]).find((row) => match_regex_source([row.site]) === rule.regex)?.site ?? rule.regex;
    for (const [key, { tokens, leaf }] of Object.entries(rule.bind ?? {})) {
      const waits_for_key = leaf.steps.some((step) => captured_key_param(input.get_command(step.invocation.id) ?? {}, step.invocation.args));
      if (waits_for_key) warnings.push(`site_rules: skipped bind "${tokens.join("")}" of "${site}": a bind cannot wait for a key press`);
      // keep_node words its warnings for a keymap entry, so they are renamed to name the site row.
      const node_warnings: string[] = [];
      const kept = !waits_for_key && keep_node(leaf, tokens, "normal", input, node_warnings);
      warnings.push(...node_warnings.map((warning) => warning.replace(/^normal: skipped "[^"]*"/, `site_rules: skipped bind "${tokens.join("")}" of "${site}"`)));
      if (waits_for_key || !kept) delete rule.bind![key];
    }
  }
  return { compiled, theme: { dark: theme.dark, light: theme.light }, warnings: [...resolve_warnings, ...warnings] };
}

// Checks and prunes in place.
function check_branch(branch: TreeBranch, path: string[], mode: string, input: CompileInput, warnings: string[]): void {
  for (const [token, node] of Object.entries(branch.children)) {
    if (!keep_node(node, [...path, token], mode, input, warnings)) delete branch.children[token];
    // A leaf that waits for a key press moves under a branch of its own, so the matcher reaches it through one more key.
    else if (node.kind === "leaf" && node.steps.some((step) => step.capture)) branch.children[token] = { kind: "branch", ...(node.label === undefined ? {} : { label: node.label }), children: { [ANY_KEY]: node } };
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
    if (find_param(command, "register")?.type === "string") step.register = true;
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
    const captured = captured_key_param(command, step.invocation.args);
    if (captured) {
      if (mode === "browser") {
        warnings.push(`browser: skipped "${path.join("")}": a Firefox shortcut cannot wait for a key press`);
        return false;
      }
      const rest = check_args(without_param(command, captured.name), step.invocation.args, input.enum_sources);
      if (!rest.ok) {
        warnings.push(`${mode}: skipped "${path.join("")}": ${rest.error}`);
        return false;
      }
      // The key press fills the param once the key flow has it. Only the router can check and fill defaults then, so the step goes to the background.
      step.capture = captured.name;
      step.runs_in = "background";
      continue;
    }
    const result = check_args(command, step.invocation.args, input.enum_sources);
    if (result.ok) {
      // Defaults filled in, so a content-side leaf runs without the registry.
      step.invocation = { ...step.invocation, args: result.args };
    } else {
      warnings.push(`${mode}: skipped "${path.join("")}": ${result.error}`);
      return false;
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

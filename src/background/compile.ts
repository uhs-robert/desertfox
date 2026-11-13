// Turns the default keymap plus the loaded config into the compiled tree.
// Each binding's args go through the one validator here, so a bad entry is
// skipped with a warning and the content script never sees it.

import type { CommandDef, Mode } from "../shared/command.ts";
import type { MergedConfig, Settings } from "../shared/config.ts";
import type { BindingTable } from "../shared/settings_table.ts";
import type { Keymap, KeymapConfig, KeymapMode, ModeBindings } from "../shared/keymap.ts";
import { spelling_of } from "./edit_layers.ts";
import type { KeymapEdits } from "./edit_layers.ts";
import { ANY_KEY, LIVE_KEY } from "../shared/prefix_tree.ts";
import type { CompiledKeymap, LeafStep, SiteBind, SiteRule, SiteRuleSource, TreeBranch, TreeLeaf, TreeNode } from "../shared/prefix_tree.ts";
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
import { compile_keymap } from "../shared/keys/compiler.ts";
import { COUNT_MODES } from "../shared/keys/matcher.ts";
import { default_rows_left_on } from "./default_site_rows.ts";
import type { DefaultSiteRow } from "./default_site_rows.ts";
import { default_layer_of, merge_keymaps } from "./keymap_merge.ts";

export type CompileInput = {
  config: MergedConfig;
  default_keymap: KeymapConfig;
  // The site rows that ship with DesertFox, after the user's rows. Absent means none.
  default_site_rows?: readonly DefaultSiteRow[];
  get_command: (command_id: string) => Pick<CommandDef, "id" | "label" | "params" | "runs_in" | "count" | "modes" | "bundle" | "jumps"> | undefined;
  enum_sources: EnumSources;
  // Parses the text of a site bind or a key edit that a browser edit set, since only a config file goes through the build. Absent means such a bind is skipped with a warning, and the key edits are left out.
  registry?: Registry;
  // The key edits of the settings page. They win over keymap.toml and the defaults.
  keymap_edits?: KeymapEdits;
  // The palette the desktop last pushed. `palette = "desktop"` shows it, or the default while none was pushed.
  desktop_palette?: string | undefined;
};

export type CompileOutput = { compiled: CompiledKeymap; theme: StoredTheme; warnings: string[] };

// Resolves binding text as the config build does, with the config's command aliases and engine names. Each problem goes to `problems`.
export function config_entry_resolver(registry: Registry, config: Pick<MergedConfig, "search_engines" | "command_aliases">, problems: string[]) {
  const { search_engines, command_aliases } = config;
  const aliased: Registry = { ...registry, find: (word) => registry.find(word) ?? (Object.hasOwn(command_aliases, word) && !/\s/.test(word) ? registry.get(command_aliases[word]!) : undefined) };
  return make_entry_resolver(aliased, { search_engines: Object.keys(search_engines) }, problems);
}

// A browser edit saves a bind as typed, so its text resolves here with the parser of the config build. A bad step is a warning and drops that bind.
function with_resolved_binds(rows: Settings["site_rules"], input: CompileInput, warnings: string[]): Settings["site_rules"] {
  if (input.registry === undefined) return rows;
  const resolve_entry = config_entry_resolver(input.registry, input.config, warnings);
  const resolve_table = (table: BindingTable, scope: string, site: string): never => {
    const resolved: Record<string, unknown> = {};
    for (const [sequence, entry] of Object.entries(table)) {
      const step = resolve_entry(entry, `site_rules: ${scope}skipped bind "${sequence}" of "${site}"`);
      if (step !== undefined) resolved[sequence] = step;
    }
    return resolved as never;
  };
  return rows.map((row) => {
    if (row.bind === undefined && row.modes === undefined) return row;
    const modes = row.modes && Object.fromEntries(Object.entries(row.modes).map(([name, mode]) => [name, { ...mode, bind: resolve_table(mode.bind, `mode "${name}" `, row.site) }]));
    return { ...row, ...(row.bind && { bind: resolve_table(row.bind, "", row.site) }), ...(modes && { modes }) };
  });
}

// The keymap of the files with the key edits on top. A text that does not resolve is a warning and drops that edit, so the file or default binding stays.
function with_keymap_edits(input: CompileInput, warnings: string[]): KeymapConfig {
  const edits = Object.entries(input.keymap_edits ?? {});
  if (edits.length === 0) return input.config.keymap;
  if (input.registry === undefined) {
    warnings.push("keymap edits: skipped, no command list to read them with");
    return input.config.keymap;
  }
  const resolve_entry = config_entry_resolver(input.registry, input.config, warnings);
  const file_keymap: KeymapConfig = { ...input.config.keymap };
  const resolved: Keymap = {};
  for (const [mode, table] of edits) {
    const bindings: ModeBindings = {};
    for (const [sequence, text] of Object.entries(table ?? {})) {
      // keymap.d writes "" to unbind, and the merge reads null as that.
      const binding = text === "" ? null : resolve_entry(text, `keymap edits: ${mode} skipped "${sequence}"`);
      if (binding !== undefined) bindings[sequence] = binding;
    }
    // The edits are stored under one spelling, and the merge goes by the written key. So a file key spelled another way (`<C-D>` for `<C-d>`) goes, or the compile would keep it over the edit.
    const file_bindings = Object.entries(file_keymap[mode as KeymapMode] ?? {}).filter(([sequence]) => !Object.hasOwn(bindings, spelling_of(sequence)));
    file_keymap[mode as KeymapMode] = Object.fromEntries(file_bindings);
    resolved[mode as KeymapMode] = bindings;
  }
  return merge_keymaps(file_keymap, resolved);
}

export function compile_config(input: CompileInput): CompileOutput {
  const resolve_warnings: string[] = [];
  const user_keymap = with_keymap_edits(input, resolve_warnings);
  const keymap = merge_keymaps(input.default_keymap, user_keymap);
  const user_rows = with_resolved_binds(input.config.settings.site_rules ?? DEFAULT_SETTINGS.site_rules, input, resolve_warnings);
  // The shipped rows rank after the user's, so a user row decides each column first.
  const default_rows = default_rows_left_on(input.default_site_rows ?? [], input.config.settings.default_site_rows_off ?? DEFAULT_SETTINGS.default_site_rows_off);
  const settings = { ...input.config.settings, site_rules: [...user_rows, ...default_rows.map(({ row }) => row)] };
  const row_sources: SiteRuleSource[] = [...user_rows.map((): SiteRuleSource => ({ origin: "user" })), ...default_rows.map(({ name }): SiteRuleSource => ({ origin: "default", name }))];
  const { compiled, warnings } = compile_keymap(keymap, settings, (command_id) => {
    const command = input.get_command(command_id);
    return command && { runs_in: command.runs_in, ...(command.bundle && { bundle: command.bundle }), label: command.label, count: command.count ?? "ignore", params: command.params ?? [], accepts_args: (args, prompt) => {
      // A captured key is filled when the key runs, so the rest of the args are checked without it.
      const captured = captured_key_param(command, args);
      const result = check_args(captured ? without_param(command, captured.name) : command, args, input.enum_sources);
      // The prompted param is filled when the key runs, as in keep_node.
      return result.ok || (prompt !== undefined && result.missing_param === prompt.param);
    } };
  }, { engine_labels: Object.fromEntries(Object.entries(input.config.search_engines).flatMap(([name, engine]) => (typeof engine?.label === "string" ? [[name, engine.label]] : []))) }, default_layer_of(input.default_keymap, user_keymap), row_sources);

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
    const { site } = rule;
    check_site_binds(rule.bind, "", site, input, warnings);
    for (const [name, mode] of Object.entries(rule.modes ?? {})) check_site_binds(mode.bind, `mode "${name}" `, site, input, warnings);
  }
  warn_unknown_modes(compiled.site_rules ?? [], compiled.modes.normal, warnings);
  return { compiled, theme: { dark: theme.dark, light: theme.light }, warnings: [...resolve_warnings, ...warnings] };
}

// Checks the binds of a site row or one of its modes, and drops the bad ones in place. A mode lays over normal mode, so its binds run in normal mode.
function check_site_binds(binds: Record<string, SiteBind> | undefined, scope: string, site: string, input: CompileInput, warnings: string[]): void {
  for (const [key, { tokens, leaf }] of Object.entries(binds ?? {})) {
    const waits_for_key = leaf.steps.some((step) => captured_key_param(input.get_command(step.invocation.id) ?? {}, step.invocation.args));
    if (waits_for_key) warnings.push(`site_rules: ${scope}skipped bind "${tokens.join("")}" of "${site}": a bind cannot wait for a key press`);
    // keep_node words its warnings for a keymap entry, so they are renamed to name the site row.
    const node_warnings: string[] = [];
    const kept = !waits_for_key && keep_node(leaf, tokens, "normal", input, node_warnings);
    warnings.push(...node_warnings.map((warning) => warning.replace(/^normal: skipped "[^"]*"/, `site_rules: ${scope}skipped bind "${tokens.join("")}" of "${site}"`)));
    if (waits_for_key || !kept) delete binds![key];
  }
}

// A `mode.site` bind that names a mode no site row defines does nothing on any page. Rows merge by mode name across sites, so the check is over every row, and it only warns. The keymap's normal mode is checked too, because a key there can start a mode as well.
function warn_unknown_modes(rules: readonly SiteRule[], normal: TreeBranch | undefined, warnings: string[]): void {
  const defined = new Set(rules.flatMap((rule) => Object.keys(rule.modes ?? {})));
  const check = (owner: string, tokens: readonly string[], leaf: TreeLeaf) => {
    for (const { invocation } of leaf.steps) {
      const name = invocation.id === "mode.site" ? invocation.args?.name : undefined;
      if (typeof name === "string" && name !== "off" && !defined.has(name)) warnings.push(`${owner}: bind "${tokens.join("")}" starts the site mode "${name}", which no site row defines`);
    }
  };
  const walk = (node: TreeNode, tokens: readonly string[]) => {
    if (node.kind === "leaf") check("normal", tokens, node);
    else for (const [token, child] of Object.entries(node.children)) walk(child, [...tokens, token]);
  };
  if (normal) walk(normal, []);
  for (const rule of rules) {
    for (const { tokens, leaf } of [...Object.values(rule.bind ?? {}), ...Object.values(rule.modes ?? {}).flatMap((mode) => Object.values(mode.bind))]) check("site_rules", tokens, leaf);
  }
}

// Checks and prunes in place.
function check_branch(branch: TreeBranch, path: string[], mode: string, input: CompileInput, warnings: string[]): void {
  for (const [token, node] of Object.entries(branch.children)) {
    if (!keep_node(node, [...path, token], mode, input, warnings)) delete branch.children[token];
    // A leaf that waits for a key press moves under a branch of its own, so the matcher reaches it through one more key.
    else if (node.kind === "leaf" && node.steps.some((step) => step.capture)) branch.children[token] = { kind: "branch", ...(node.label === undefined ? {} : { label: node.label }), children: { [ANY_KEY]: node, ...live_repeat_child(node, input) } };
  }
}

// While a find is live its key repeats it, as `;` for a forward binding and `,` (the reverse) for a backward one, whatever way the find started. It derives from the binding, so a remapped key follows.
function live_repeat_child(captured: TreeLeaf, input: CompileInput): Record<string, TreeLeaf> {
  const find = captured.steps.find((step) => step.capture && step.invocation.id === "caret.find");
  const move = input.get_command("caret.move");
  if (!find || !move) return {};
  const direction = find.invocation.args?.direction === "back" ? "back" : "forward";
  const step: LeafStep = { invocation: { id: "caret.move", args: { unit: "find_repeat", direction, big: false } }, runs_in: move.runs_in, count_rule: move.count ?? "ignore", ...(move.bundle && { bundle: move.bundle }) };
  return { [LIVE_KEY]: { kind: "leaf", label: "Repeat the character find", steps: [step] } };
}

// Only the router reads the offset a jump leaves, so a first press of a content command that moves the view goes to the router.
const moves_view = (command: Pick<CommandDef, "jumps">, args: Record<string, unknown>): boolean => (typeof command.jumps === "function" ? command.jumps(args) : command.jumps === true);

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
      if (moves_view(command, result.args)) step.jump = true;
    } else if (COUNT_MODES.includes(mode) && result.missing_param !== undefined && typeof command.count === "object" && result.missing_param === command.count.param) {
      // The typed count fills this param when the key runs (`50%`), and a key with no count is refused then. A stand-in count lets every other arg get its check. A Firefox shortcut takes no count, so it gets no such pass.
      const stand_in = check_args(command, { ...step.invocation.args, [result.missing_param]: 1 }, input.enum_sources);
      if (!stand_in.ok) {
        warnings.push(`${mode}: skipped "${path.join("")}": ${stand_in.error}`);
        return false;
      }
      step.runs_in = "background";
      if (moves_view(command, stand_in.args)) step.jump = true;
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

// Compiles the merged keymap into the prefix tree the content script walks.

import type { BundleName } from "../bundles.ts";
import { MODES as RUNTIME_MODES } from "../command.ts";
import type { CountBehavior, ParamDef, RunsIn } from "../command.ts";
import { hosts_disjoint, match_regex_source, site_row_columns } from "../match_pattern.ts";
import { COMPILED_KEYMAP_VERSION, FRAME_SITE_SETTINGS } from "../prefix_tree.ts";
import type { CompiledKeymap, FrameSiteName, LeafStep, SiteBind, SiteRule, SiteRuleSource, TreeBranch, TreeNode } from "../prefix_tree.ts";
import { DEFAULT_SETTINGS } from "../config.ts";
import type { Settings } from "../config.ts";
import type { BindingTable } from "../settings_table.ts";
import { MAX_BIND_STEPS } from "../table_constants.ts";
import type { BoundInvocation, KeyBinding, Prompt } from "../invocation.ts";
import type { KeymapConfig, KeymapMode, Modifier } from "../keymap.ts";
import { default_of, is_dynamic_values } from "../registry/params.ts";
import { parse_sequence } from "./notation.ts";

// `accepts_args` is the registry validator, passed in because the content bundle includes the keys index: importing the validator here grew content.js from 15.7 KB to 21 KB, over its 17 KB limit. Without it a modifier variant is never judged and always inserted.
export type CommandInfo = { runs_in: RunsIn; bundle?: BundleName; label: string; count: CountBehavior; params?: readonly ParamDef[]; accepts_args?: (args: Record<string, unknown>, prompt?: Prompt) => boolean };

// Search engine name to the label the user gave it. A key that searches with an engine reads as that label.
export type LabelSources = { engine_labels: Record<string, string> };

// Returns undefined for an id the registry does not know.
export type ResolveCommand = (command_id: string) => CommandInfo | undefined;

export type CompileResult = { compiled: CompiledKeymap; warnings: string[] };

type Layer = "defaults" | "user";
type Entry = { sequence: string; tokens: string[]; binding: KeyBinding; source_index: number; layer: Layer };

// Explicit bindings win over generated ones, so generated entries go in first.
function generated_bindings(keymap: KeymapConfig, settings: Partial<Settings>): Record<string, KeyBinding> {
  const search_prefixes = { ...DEFAULT_SETTINGS.search_prefixes, ...settings.search_prefixes };
  const container_prefixes = { ...DEFAULT_SETTINGS.container_prefixes, ...settings.container_prefixes };
  const bindings: Record<string, KeyBinding> = {};
  for (const [last_key, engine] of Object.entries(keymap.search_keys ?? {})) {
    bindings[search_prefixes.here + last_key] = { id: "open.search", args: { engine, where: "here" } };
    bindings[search_prefixes.tab + last_key] = { id: "open.search", args: { engine, where: "tab" } };
  }
  const site_prefix = (where: "here" | "tab") => search_prefixes[where] + "/";
  for (const [last_key, engines] of Object.entries(keymap.site_keys ?? {})) {
    const first = engines[0];
    if (first === undefined) continue;
    for (const where of ["here", "tab"] as const) {
      bindings[site_prefix(where) + last_key] = { id: "open.search", args: { engine: first, where }, site_search: { letter: last_key, engines } };
    }
  }
  for (const [last_key, container] of Object.entries(keymap.container_keys ?? {})) {
    bindings[container_prefixes.reopen + last_key] = { id: "tab.reopen_in_container", args: { container } };
    bindings[container_prefixes.tab + last_key] = { id: "open.url", args: { where: "tab", container }, prompt: { param: "url", prefill: { from: "current_url" } } };
  }
  return bindings;
}

// Each modifier derives, from every key of its group, a variant with the modifier args added. The group is the modifier key minus its last token.
// A variant exists only when the registry validator accepts its args, so which-key and help never show a combination that would be refused.
// A key that sets its own `action` gets no variants: the modifier would fight it.
// Explicit keys win over variants without a warning, so a user can rebind one variant, or remove it with a null.
function modifier_variants(modifiers: Record<string, Modifier>, taken: Map<string, Entry>, removed: Set<string>, resolve: ResolveCommand, warnings: string[]): Entry[] {
  const parsed_modifiers = Object.entries(modifiers).flatMap(([sequence, { label: _label, ...args }]) => {
    const parsed = parse_sequence(sequence);
    if (parsed.error !== undefined) warnings.push(`modifiers: skipped "${sequence}": ${parsed.error}`);
    else if (parsed.tokens.length < 2) warnings.push(`modifiers: skipped "${sequence}": a modifier must sit inside a group, for example ";r"`);
    else if (taken.has(parsed.tokens.join(""))) warnings.push(`modifiers: skipped "${sequence}": the key has its own binding, which wins`);
    else if (removed.has(parsed.tokens.join(""))) return [];
    else return [{ sequence, tokens: parsed.tokens, args }];
    return [];
  });
  const modifier_keys = parsed_modifiers.map(({ tokens }) => tokens.join(""));
  const sources = [...taken.values()].filter(({ tokens, binding }) => {
    const joined = tokens.join("");
    return !Array.isArray(binding) && binding.args?.action === undefined && !modifier_keys.some((key) => joined.startsWith(key));
  });
  const variants: Entry[] = [];
  for (const { sequence, tokens, args } of parsed_modifiers) {
    const group = tokens.slice(0, -1);
    const in_group = sources.filter((source) => source.tokens.length > group.length && group.every((token, index) => source.tokens[index] === token));
    let accepted = 0;
    for (const source of in_group) {
      const binding = source.binding as BoundInvocation;
      const info = resolve(binding.id);
      const variant_args = { ...binding.args, ...args };
      if (!info || info.accepts_args?.(variant_args, binding.prompt) === false) continue;
      accepted++;
      const variant_tokens = [...group, tokens[tokens.length - 1]!, ...source.tokens.slice(group.length)];
      const variant_key = variant_tokens.join("");
      if (taken.has(variant_key) || removed.has(variant_key)) continue;
      variants.push({ sequence: variant_key, tokens: variant_tokens, binding: { ...without_intent(binding), args: variant_args, ...(binding.variant_label === undefined ? {} : { label: binding.variant_label }) }, source_index: -1, layer: "defaults" });
    }
    if (accepted === 0) warnings.push(`modifiers: "${sequence}" matches no key of its group, so it makes no variants`);
  }
  return variants;
}

function without_intent({ intent: _intent, ...rest }: BoundInvocation): BoundInvocation {
  return rest;
}

type Drop = { default_sequence: string; extenders: string[] };

// A default leaf that a user key extends (default `sg`, user `sgg`) would hide the user key, so the default goes.
// Only an extender that can compile counts, so a user key the registry refuses never leaves both keys unbound.
// A dropped key joins `removed`, so a modifier variant cannot refill its slot.
// The reverse, a user leaf shorter than a default group, needs no rule: the leaf is inserted first and the default longer key is skipped.
function drop_default_leaves_under_user_keys(entries: Map<string, Entry>, removed: Set<string>, resolve: ResolveCommand, drops: Drop[]) {
  const user_entries = [...entries.values()].filter((entry) => entry.layer === "user" && can_compile(entry, resolve));
  for (const [normalized, entry] of entries) {
    if (entry.layer !== "defaults") continue;
    const extenders = user_entries.filter(({ tokens }) => tokens.length > entry.tokens.length && entry.tokens.every((token, index) => tokens[index] === token));
    if (extenders.length === 0) continue;
    entries.delete(normalized);
    removed.add(normalized);
    drops.push({ default_sequence: entry.sequence, extenders: extenders.map(({ sequence }) => sequence) });
  }
}

function can_compile({ binding }: Entry, resolve: ResolveCommand): boolean {
  return (Array.isArray(binding) ? binding : [binding]).every((invocation) => {
    const info = resolve(invocation.id);
    return info !== undefined && info.accepts_args?.(invocation.args ?? {}, invocation.prompt) !== false;
  });
}

function entries_for_mode(
  mode: KeymapMode,
  keymap: KeymapConfig,
  settings: Partial<Settings>,
  resolve: ResolveCommand,
  warnings: string[],
  default_layer: KeymapConfig,
): Entry[] {
  const sources = [mode === "normal" ? generated_bindings(keymap, settings) : {}, keymap[mode] ?? {}];
  const default_sequences = [mode === "normal" ? generated_bindings(default_layer, settings) : {}, default_layer[mode] ?? {}];
  const by_normalized_sequence = new Map<string, Entry>();
  const removed = new Set<string>();
  for (const [source_index, source] of sources.entries()) {
    for (const [sequence, binding] of Object.entries(source)) {
      const parsed = parse_sequence(sequence);
      if (parsed.error !== undefined) {
        warnings.push(`${mode}: skipped "${sequence}": ${parsed.error}`);
        continue;
      }
      const normalized = parsed.tokens.join("");
      if (binding === null) {
        by_normalized_sequence.delete(normalized);
        removed.add(normalized);
      } else {
        const earlier = by_normalized_sequence.get(normalized);
        if (earlier && earlier.source_index === source_index) {
          warnings.push(`${mode}: "${sequence}" and "${earlier.sequence}" are the same keys, kept "${sequence}"`);
        }
        const layer: Layer = sequence in default_sequences[source_index]! ? "defaults" : "user";
        by_normalized_sequence.set(normalized, { sequence, tokens: parsed.tokens, binding, source_index, layer });
      }
    }
  }
  const drops: Drop[] = [];
  drop_default_leaves_under_user_keys(by_normalized_sequence, removed, resolve, drops);
  if (mode === "normal" || mode === "media") {
    // Normal mode already warned about a modifier that matches no key, so the media mode, which holds only the hint group, stays quiet.
    for (const variant of modifier_variants(keymap.modifiers ?? {}, by_normalized_sequence, removed, resolve, mode === "media" ? [] : warnings)) {
      by_normalized_sequence.set(variant.tokens.join(""), variant);
    }
    // A generated variant is a default key too: a user key may extend it.
    drop_default_leaves_under_user_keys(by_normalized_sequence, removed, resolve, drops);
  }
  if (drops.length > 0) {
    warnings.push(`${mode}: dropped default keys that your keys extend: ${drops.map(({ default_sequence, extenders }) => `"${default_sequence}" by ${extenders.join(", ")}`).join("; ")}`);
  }
  // Shorter sequences first, so a prefix claims its place before the longer entries below it.
  return [...by_normalized_sequence.values()].sort((a, b) => a.tokens.length - b.tokens.length);
}

// The label of a binding is the label its author wrote, else one derived from the command and the args the binding sets.
// The args are the authored ones: defaults the validator fills in later must not show up in the label.
// Prompted params, free strings and numbers are never named. Hand labels cover the keys that set them.
// A value phrase that an ancestor group name already says as whole words is dropped: under "Search in new tab", a row reads "Google", not "Google in new tab".
function derived_label(invocation: BoundInvocation, info: CommandInfo, settings: Partial<Settings>, sources: LabelSources, ancestor_names: string[]): string {
  let label = info.label;
  const phrases: string[] = [];
  for (const param of info.params ?? []) {
    const value = invocation.args?.[param.name];
    if (is_dynamic_values(param.values)) {
      if (param.values.from === "containers" && typeof value === "string" && value !== "") {
        return value === "default" ? "Default container" : value;
      }
      if (param.values.from === "search_engines") {
        const engine = typeof value === "string" && value !== "" ? value : (settings.default_engine ?? DEFAULT_SETTINGS.default_engine);
        label = sources.engine_labels[engine] ?? label;
      }
    } else if (param.type === "enum" && typeof value === "string" && value !== default_of(info, param, invocation.args ?? {})) {
      phrases.push(param.value_labels?.[value] ?? value.replaceAll("_", " "));
    } else if (param.type === "bool" && value === true && value !== default_of(info, param, invocation.args ?? {})) {
      phrases.push(param.name.replaceAll("_", " "));
    }
  }
  return [label, ...phrases.filter((phrase) => !ancestor_names.some((name) => says_phrase(name, phrase)))].join(" ");
}

function says_phrase(name: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(name);
}

// A label or an intent is one line of text. `noun` starts the message ("a label"). Null when the text is fine.
function line_problem(noun: string, text: string): string | null {
  if (text.trim() === "") return `${noun} must not be empty`;
  if (/\p{Cc}/u.test(text)) return `${noun} must not hold control characters`;
  return null;
}

export const label_problem = (label: string) => line_problem("a label", label);

export const intent_problem = (intent: string) => line_problem("an intent", intent);

function to_steps(mode: KeymapMode, entry: Entry, resolve: ResolveCommand, settings: Partial<Settings>, sources: LabelSources, ancestor_names: string[], warnings: string[]) {
  const invocations = Array.isArray(entry.binding) ? entry.binding : [entry.binding];
  const steps: LeafStep[] = [];
  let label: string | undefined;
  let intent: string | undefined;
  for (const invocation of invocations) {
    const info = resolve(invocation.id);
    if (!info) {
      warnings.push(`${mode}: skipped "${entry.sequence}": unknown command "${invocation.id}"`);
      return undefined;
    }
    if (label === undefined) {
      const written_problem = invocation.label === undefined ? null : label_problem(invocation.label);
      if (written_problem) {
        warnings.push(`${mode}: skipped "${entry.sequence}": ${written_problem}`);
        return undefined;
      }
      const intent_error = invocation.intent === undefined ? null : intent_problem(invocation.intent);
      if (intent_error) {
        warnings.push(`${mode}: skipped "${entry.sequence}": ${intent_error}`);
        return undefined;
      }
      intent = invocation.intent;
      label = invocation.label ?? derived_label(invocation, info, settings, sources, ancestor_names);
      // A derived label can carry a bad engine label or value phrase. The key still works, so it falls back to the command label.
      const derived_problem = invocation.label === undefined ? label_problem(label) : null;
      if (derived_problem) {
        warnings.push(`${mode}: "${entry.sequence}" keeps the command label: ${derived_problem}`);
        label = info.label;
      }
    }
    // The label is for the leaf. The steps stay the plain invocations the router runs.
    const { label: _label, intent: _intent, variant_label: _variant_label, ...plain } = invocation;
    steps.push({ invocation: plain, runs_in: info.runs_in, count_rule: info.count, ...(info.bundle && { bundle: info.bundle }) });
  }
  if (steps.length === 0) {
    warnings.push(`${mode}: skipped "${entry.sequence}": empty binding`);
    return undefined;
  }
  return { steps, label, intent };
}

function insert_entry(root: TreeBranch, mode: KeymapMode, entry: Entry, resolve: ResolveCommand, settings: Partial<Settings>, sources: LabelSources, group_names: GroupName[], warnings: string[]) {
  const resolved = to_steps(mode, entry, resolve, settings, sources, ancestor_group_names(entry.tokens, group_names), warnings);
  if (!resolved) return;

  let branch = root;
  for (const [depth, token] of entry.tokens.entries()) {
    const is_last = depth === entry.tokens.length - 1;
    const existing = branch.children[token];
    if (!is_last) {
      if (existing?.kind === "leaf") {
        warnings.push(`${mode}: skipped "${entry.sequence}": "${entry.tokens.slice(0, depth + 1).join("")}" is already a complete binding`);
        return;
      }
      branch = existing ?? (branch.children[token] = { kind: "branch", children: {} });
    } else if (existing) {
      warnings.push(`${mode}: skipped "${entry.sequence}": ${existing.kind === "leaf" ? "same keys as another binding" : "another binding already continues past it"}`);
    } else {
      branch.children[token] = { kind: "leaf", ...(resolved.label === undefined ? {} : { label: resolved.label }), ...(resolved.intent === undefined ? {} : { intent: resolved.intent }), steps: resolved.steps };
    }
  }
}

type GroupName = { tokens: string[]; name: string };

// Two spellings of one key sequence name one group. The later one wins, so each group has one name for both the labels and the panel.
function parse_group_names(group_names: Record<string, string>, warnings: string[]): GroupName[] {
  const by_normalized_sequence = new Map<string, GroupName>();
  for (const [sequence, name] of Object.entries(group_names)) {
    const parsed = parse_sequence(sequence);
    if (parsed.error === undefined) by_normalized_sequence.set(parsed.tokens.join(""), { tokens: parsed.tokens, name });
    else warnings.push(`group_names: skipped "${sequence}": ${parsed.error}`);
  }
  return [...by_normalized_sequence.values()];
}

// The names of every group above the key, nearest or not.
function ancestor_group_names(tokens: string[], group_names: GroupName[]): string[] {
  const prefixes = new Set(tokens.slice(0, -1).map((_, index) => tokens.slice(0, index + 1).join("")));
  return group_names.filter(({ tokens: group_tokens }) => prefixes.has(group_tokens.join(""))).map(({ name }) => name);
}

function name_groups(root: TreeBranch, group_names: GroupName[]) {
  for (const { tokens, name } of group_names) {
    let node: TreeNode | undefined = root;
    for (const token of tokens) node = node?.kind === "branch" ? node.children[token] : undefined;
    if (node?.kind === "branch") node.label = name;
  }
}

const key_sequences = (text: string, warnings: string[]): string[][] =>
  text.split(/\s+/).flatMap((word) => {
    if (word === "") return [];
    const parsed = parse_sequence(word);
    if (parsed.error !== undefined) warnings.push(`site_rules: skipped "${word}": ${parsed.error}`);
    return parsed.tokens === undefined ? [] : [parsed.tokens];
  });

// A rule whose pattern never matches is dropped.
// By value, because a list setting is a new array after every load. Not in `prefix_tree.ts`, whose default settings import would reach content.js.
export const is_default_value = (name: FrameSiteName, value: unknown): boolean => JSON.stringify(value) === JSON.stringify(DEFAULT_SETTINGS[name]);

// A bind with a bad key, an unknown command or too many steps is skipped with a warning, and the row's other binds stay. The label comes from the first step, as for a keymap entry. The args are checked later, in `compile.ts`, where the registry validator is. A bind still in text form never went through the build, so it is skipped.
function compile_binds(table: BindingTable, resolve: ResolveCommand, settings: Partial<Settings>, sources: LabelSources, warnings: string[], scope = ""): Record<string, SiteBind> {
  const binds: Record<string, SiteBind> = {};
  for (const [sequence, written] of Object.entries(table)) {
    const parsed = parse_sequence(sequence);
    if (parsed.error !== undefined) {
      warnings.push(`site_rules: ${scope}skipped bind "${sequence}": ${parsed.error}`);
      continue;
    }
    const steps = [written].flat() as unknown[];
    if (steps.length > MAX_BIND_STEPS) {
      warnings.push(`site_rules: ${scope}skipped bind "${sequence}": more than ${MAX_BIND_STEPS} steps`);
      continue;
    }
    if (steps.some((step) => typeof step !== "object" || step === null || "run" in step)) {
      warnings.push(`site_rules: ${scope}skipped bind "${sequence}": the binding was not resolved by the config build`);
      continue;
    }
    const binding = steps.map((step) => ({ ...(step as BoundInvocation) }));
    const step_warnings: string[] = [];
    const resolved = to_steps("normal", { sequence, tokens: parsed.tokens, binding, source_index: 0, layer: "user" }, resolve, settings, sources, [], step_warnings);
    if (resolved === undefined) {
      warnings.push(...step_warnings.map((warning) => `site_rules: ${scope}bind ${warning.replace(/^normal: /, "")}`));
      continue;
    }
    binds[parsed.tokens.join("")] = { tokens: parsed.tokens, leaf: { kind: "leaf", ...(resolved.label === undefined ? {} : { label: resolved.label }), ...(resolved.intent === undefined ? {} : { intent: resolved.intent }), steps: resolved.steps } };
  }
  return binds;
}

// Rows that bind a key and a longer key under it. The shorter bind wins and the longer is dropped when the binds are grafted, as in a keymap, where a complete binding hides the keys under it.
// Rows of one pattern are checked against each other. Rows of other patterns are checked too unless their hosts are provably different, as a page can fit both. Order does not matter.
function warn_prefix_binds(rows: readonly { site: string; rule: SiteRule }[], warnings: string[]) {
  type Scope = { site: string; mode: string; binds: SiteBind[] };
  const scopes = new Map<string, Scope>();
  // A mode has binds of its own, so its keys are checked against each other and not against the row's.
  const add = (site: string, regex: string, mode: string, binds: Record<string, SiteBind> | undefined) => {
    const key = `${regex} mode ${mode}`;
    const scope = scopes.get(key) ?? { site, mode, binds: [] };
    scope.binds.push(...Object.values(binds ?? {}));
    scopes.set(key, scope);
  };
  for (const { site, rule } of rows) {
    add(site, rule.regex, "", rule.bind);
    for (const [name, mode] of Object.entries(rule.modes ?? {})) add(site, rule.regex, name, mode.bind);
  }
  const under = (longer: SiteBind, binds: SiteBind[]) => binds.find((other) => other.tokens.length < longer.tokens.length && other.tokens.every((token, index) => longer.tokens[index] === token));
  for (const scope of scopes.values()) {
    for (const longer of scope.binds) {
      const shorter = under(longer, scope.binds);
      if (shorter) {
        warnings.push(`site_rules: skipped bind "${longer.tokens.join("")}": "${shorter.tokens.join("")}" is already a complete bind for the same site`);
        continue;
      }
      // Only the row's own binds merge across rows. A named mode comes whole from the first matching row, so its binds never meet those of another row.
      if (scope.mode !== "") continue;
      for (const other of scopes.values()) {
        // Disjoint hosts are skipped, though an embedded cross-site frame resolves rules by both its own URL and the tab's and can still meet both rows.
        const hiding = other === scope || other.mode !== "" || hosts_disjoint(scope.site, other.site) ? undefined : under(longer, other.binds);
        if (hiding) warnings.push(`site_rules: skipped bind "${longer.tokens.join("")}" of "${scope.site}": "${hiding.tokens.join("")}" is already a complete bind of "${other.site}", which can match the same pages`);
      }
    }
  }
}

// `row_sources` runs parallel to `rules`. A row without an entry is the user's.
export function compile_site_rules(rules: Settings["site_rules"], resolve: ResolveCommand, settings: Partial<Settings>, sources: LabelSources, warnings: string[], row_sources: readonly SiteRuleSource[] = []): SiteRule[] {
  const rows = compile_rows(rules, resolve, settings, sources, warnings, row_sources);
  warn_prefix_binds(rows, warnings);
  return rows.map(({ rule }) => rule);
}

function compile_rows(rules: Settings["site_rules"], resolve: ResolveCommand, settings: Partial<Settings>, sources: LabelSources, warnings: string[], row_sources: readonly SiteRuleSource[]): { site: string; rule: SiteRule }[] {
  return rules.flatMap((row, index): { site: string; rule: SiteRule }[] => {
    const regex = match_regex_source([row.site]);
    if (regex === undefined) return [];
    const { keys, bind, modes, ...columns } = site_row_columns(row);
    const compiled_bind = bind === undefined ? {} : { bind: compile_binds(bind as BindingTable, resolve, settings, sources, warnings) };
    const compiled_modes = modes === undefined ? {} : { modes: Object.fromEntries(Object.entries(modes).map(([name, mode]) => [name, { label: mode.label, bind: compile_binds(mode.bind as BindingTable, resolve, settings, sources, warnings, `mode "${name}" `) }])) };
    const rule: SiteRule = { ...(row_sources[index] ?? { origin: "user" }), site: row.site, regex, ...columns, ...compiled_bind, ...compiled_modes };
    if (keys === undefined) return [{ site: row.site, rule }];
    return [{ site: row.site, rule: { ...rule, keys: "pass" in keys ? { pass: key_sequences(keys.pass, warnings) } : { only: key_sequences(keys.only, warnings) } } }];
  });
}

export function compile_keymap(keymap: KeymapConfig, settings: Partial<Settings>, resolve: ResolveCommand, label_sources: LabelSources = { engine_labels: {} }, default_layer: KeymapConfig = {}, row_sources: readonly SiteRuleSource[] = []): CompileResult {
  const warnings: string[] = [];
  const modes: CompiledKeymap["modes"] = {};
  const keymap_modes: readonly KeymapMode[] = [...RUNTIME_MODES, "browser"];
  const modifier_names = Object.fromEntries(Object.entries(keymap.modifiers ?? {}).flatMap(([sequence, { label }]) => (typeof label === "string" ? [[sequence, label]] : [])));
  const group_names = parse_group_names({ ...modifier_names, ...keymap.group_names }, warnings);
  for (const mode of keymap_modes) {
    const root: TreeBranch = { kind: "branch", children: {} };
    for (const entry of entries_for_mode(mode, keymap, settings, resolve, warnings, default_layer)) {
      insert_entry(root, mode, entry, resolve, settings, label_sources, group_names, warnings);
    }
    name_groups(root, group_names);
    if (Object.keys(root.children).length > 0) modes[mode] = root;
  }
  const site_rules = compile_site_rules(settings.site_rules ?? DEFAULT_SETTINGS.site_rules, resolve, settings, label_sources, warnings, row_sources);
  const frame_site_globals = Object.fromEntries(FRAME_SITE_SETTINGS.flatMap((name) => (settings[name] === undefined || is_default_value(name, settings[name]) ? [] : [[name, settings[name]]])));
  const which_key_skip = (settings.which_key_skip ?? []).flatMap((entry) => {
    const { tokens, error } = parse_sequence(entry);
    if (error === undefined) return [tokens.join("")];
    warnings.push(`which_key_skip: skipped "${entry}": ${error}`);
    return [];
  });
  const compiled: CompiledKeymap = {
    format_version: COMPILED_KEYMAP_VERSION,
    modes,
    ...(site_rules.length > 0 ? { site_rules } : {}),
    mode_indicator: settings.mode_indicator ?? DEFAULT_SETTINGS.mode_indicator,
    ...(settings.bridge === true ? { bridge: true as const } : {}),
    ...(settings.bridge === true && settings.bridge_share_tabs === true ? { bridge_share_tabs: true as const } : {}),
    ...(Object.keys(frame_site_globals).length > 0 ? { frame_site_globals } : {}),
    which_key_border: settings.which_key_border ?? DEFAULT_SETTINGS.which_key_border,
    which_key_delay_ms: settings.which_key_delay_ms ?? DEFAULT_SETTINGS.which_key_delay_ms,
    toast_ms: settings.toast_ms ?? DEFAULT_SETTINGS.toast_ms,
    toast_error_ms: settings.toast_error_ms ?? DEFAULT_SETTINGS.toast_error_ms,
    ...(which_key_skip.length > 0 ? { which_key_skip } : {}),
    ...(settings.layout_fallback === false ? { layout_fallback: false as const } : {}),
  };
  return { compiled, warnings };
}

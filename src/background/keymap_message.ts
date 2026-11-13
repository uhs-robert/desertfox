// The key editor's messages: the binding list, the check of one binding, and one key edit. A key edit goes through `change_layers`, so it shares the queue and rollback of `:set`.

import type { MergedConfig } from "../shared/config.ts";
import type { KeyBinding, BoundInvocation } from "../shared/invocation.ts";
import type { KeymapConfig, KeymapMode } from "../shared/keymap.ts";
import type { BindingRow, ChangeKeymap, ChangeKeymapAnswer, CheckBinding, CheckBindingAnswer, ListBindingsAnswer } from "../shared/messages.ts";
import { ANY_KEY } from "../shared/prefix_tree.ts";
import type { TreeBranch, TreeLeaf, TreeNode } from "../shared/prefix_tree.ts";
import { KEYMAP_MODES } from "../shared/config_build/merge.ts";
import { parse_sequence, to_firefox_shortcut } from "../shared/keys/index.ts";
import { plan_slots } from "./slots.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";
import type { Registry } from "../shared/registry/index.ts";
import { print_command } from "../shared/registry/print_command.ts";
import { config_entry_resolver } from "./compile.ts";
import type { CompileOutput } from "./compile.ts";
import { by_spelling, normalized_keys } from "./edit_layers.ts";
import type { EditLayers, KeymapEdits } from "./edit_layers.ts";

// Read in the change queue. `compile` compiles the config in force under the given layers.
export type KeymapState = { config: MergedConfig; layers: EditLayers; compile: (layers: EditLayers) => CompileOutput };

export type KeymapMessageDeps = {
  default_keymap: KeymapConfig;
  registry: Registry;
  read_keymap_state: () => Promise<KeymapState>;
  change_layers: (kind: "keymap", decide: (current: KeymapEdits, config: MergedConfig) => KeymapEdits | undefined) => Promise<void>;
};

// The text keymap.toml would write for an invocation. A prompted param goes back into the args, and the leading `:` marks the prompt.
function invocation_text(invocation: BoundInvocation, registry: Registry, sources: EnumSources): string {
  const command = registry.get(invocation.id);
  if (!command) return invocation.id;
  const { prompt } = invocation;
  const args = prompt?.prefill === undefined ? (invocation.args ?? {}) : { ...invocation.args, [prompt.param]: prompt.prefill };
  return `${prompt ? ":" : ""}${print_command(command, args, { sources })}`;
}

// A binding of several steps has no one-line form. The steps show joined by `STEP_JOINER`, and the check refuses a text that holds it.
const STEP_JOINER = " ; ";
const binding_text = (binding: KeyBinding, registry: Registry, sources: EnumSources) => [binding].flat().map((step) => invocation_text(step, registry, sources)).join(STEP_JOINER);

export function binding_rows(default_keymap: KeymapConfig, file_keymap: KeymapConfig, edits: KeymapEdits, registry: Registry, sources: EnumSources): BindingRow[] {
  const rows: BindingRow[] = [];
  for (const mode of KEYMAP_MODES) {
    const defaults = default_keymap[mode] ?? {};
    const files = by_spelling(file_keymap[mode] ?? {});
    const edited = edits[mode] ?? {};
    for (const keys of new Set([...Object.keys(defaults), ...Object.keys(files), ...Object.keys(edited)])) {
      const shipped = defaults[keys];
      const default_text = shipped ? binding_text(shipped, registry, sources) : undefined;
      const replaced_default = default_text === undefined ? {} : { default_text };
      const edit = edited[keys];
      const file = files[keys];
      if (edit !== undefined && edit !== "") rows.push({ mode, keys, text: edit, origin: "edit", ...replaced_default });
      else if (edit === "" || file === null) {
        // An unbind of nothing leaves nothing to show.
        if (shipped || (edit === "" && file)) rows.push({ mode, keys, text: "", origin: "removed", ...replaced_default });
      } else if (file) rows.push({ mode, keys, text: binding_text(file, registry, sources), origin: "file", ...replaced_default });
      else if (shipped) rows.push({ mode, keys, text: default_text!, origin: "default" });
    }
  }
  return rows;
}

// The capture key of a leaf that waits for a key press sits one level down, so such a branch counts as the leaf.
function as_leaf(node: TreeNode | undefined): TreeLeaf | undefined {
  if (node?.kind === "leaf") return node;
  const captured = node?.children[ANY_KEY];
  return captured?.kind === "leaf" ? captured : undefined;
}

// The leaves a binding on `tokens` can touch: one on a prefix of it, one on it, and every one it would start.
function leaves_near(root: TreeBranch | undefined, tokens: readonly string[]): Map<string, TreeLeaf> {
  const found = new Map<string, TreeLeaf>();
  let node: TreeNode | undefined = root;
  for (let index = 0; index < tokens.length && node?.kind === "branch"; index += 1) {
    node = node.children[tokens[index]!];
    const leaf = as_leaf(node);
    if (leaf) found.set(tokens.slice(0, index + 1).join(""), leaf);
  }
  const walk = (branch: TreeBranch, path: string) => {
    for (const [token, child] of Object.entries(branch.children)) {
      const leaf = as_leaf(child);
      if (leaf) found.set(path + token, leaf);
      else if (child.kind === "branch") walk(child, path + token);
    }
  };
  if (node?.kind === "branch" && !as_leaf(node)) walk(node, tokens.join(""));
  return found;
}

// `text` undefined drops the edit, so the file or default binding shows again.
function with_key_edit(edits: KeymapEdits, mode: KeymapMode, keys: string, text: string | undefined): KeymapEdits {
  const { [keys]: _replaced, ...others } = edits[mode] ?? {};
  const table = text === undefined ? others : { ...others, [keys]: text };
  const { [mode]: _mode, ...modes } = edits;
  return Object.keys(table).length === 0 ? modes : { ...modes, [mode]: table };
}

const is_mode = (mode: unknown): mode is KeymapMode => (KEYMAP_MODES as readonly unknown[]).includes(mode);

// Diffs a compile with the candidate against one without it, so the answer holds only what this binding adds.
export function check_candidate(state: KeymapState, registry: Registry, request: { mode: unknown; keys: unknown; text: unknown }): { saves: boolean; problems: string[]; warnings: string[]; shadows: { keys: string; text: string }[] } {
  const none = { saves: false, warnings: [], shadows: [] };
  if (!is_mode(request.mode)) return { problems: [`unknown mode ${JSON.stringify(request.mode)}`], ...none };
  if (typeof request.keys !== "string" || typeof request.text !== "string") return { problems: ["the binding needs keys and a command text"], ...none };
  const { mode, text } = request;
  const normalized = normalized_keys(mode, request.keys);
  if ("problem" in normalized) return { problems: [`${mode} "${request.keys}": ${normalized.problem}`], ...none };
  const problems: string[] = [];
  if (text !== "") config_entry_resolver(registry, state.config, problems)(text, `${mode} "${normalized.keys}"`);
  if (text.includes(STEP_JOINER)) problems.push(`${mode} "${normalized.keys}": a binding of several steps is edited in the config files`);
  if (problems.length > 0) return { problems, ...none };

  const before = state.compile(state.layers);
  const after = state.compile({ ...state.layers, keymap: with_key_edit(state.layers.keymap, mode, normalized.keys, text) });
  const warnings_before = new Set(before.warnings);
  const { tokens } = normalized;
  const near_after = leaves_near(after.compiled.modes[mode], tokens);
  const sources = { search_engines: Object.keys(state.config.search_engines) };
  const shadows = [...leaves_near(before.compiled.modes[mode], tokens)]
    .filter(([keys, leaf]) => JSON.stringify(near_after.get(keys)) !== JSON.stringify(leaf))
    .map(([keys, leaf]) => ({ keys, text: binding_text(leaf.steps.map((step) => step.invocation), registry, sources) }));
  const warnings = after.warnings.filter((warning) => !warnings_before.has(warning));
  // An unbind always lands. A binding lands when the compile kept it: a skip leaves its reason in the new warnings.
  let saves = text === "" || near_after.has(normalized.keys);
  if (mode === "browser" && text !== "") {
    // The slots are planned at publish, so a chord past the last free slot would compile and still do nothing.
    const slot_warnings_before = new Set(plan_slots(before.compiled.modes.browser).warnings);
    const after_plan = plan_slots(after.compiled.modes.browser);
    warnings.push(...after_plan.warnings.filter((warning) => !slot_warnings_before.has(warning)));
    const shortcut = to_firefox_shortcut(normalized.keys).shortcut;
    saves &&= after_plan.assignments.some((assignment) => assignment.shortcut === shortcut);
  }
  return { saves, problems: [], warnings, shadows };
}

// The edits as the export writes them: only the ones that read against the config in force, since an import refuses a whole config over one unknown command.
export function exportable_key_edits(state: Pick<KeymapState, "config" | "layers">, registry: Registry): { edits: KeymapEdits; skipped: string[] } {
  const skipped: string[] = [];
  const resolve = config_entry_resolver(registry, state.config, skipped);
  const edits: KeymapEdits = {};
  for (const [mode, table] of Object.entries(state.layers.keymap) as [KeymapMode, Record<string, string>][]) {
    const kept = Object.entries(table).filter(([keys, text]) => text === "" || resolve(text, `${mode} "${keys}"`) !== undefined);
    if (kept.length > 0) edits[mode] = Object.fromEntries(kept);
  }
  return { edits, skipped };
}

// The key edits whose text runs `command_id`, as `mode "keys"`. A snippet they bind must not be removed under them.
export function key_edits_running(command_id: string, state: Pick<KeymapState, "config" | "layers">, registry: Registry): string[] {
  const resolve = config_entry_resolver(registry, state.config, []);
  return (Object.entries(state.layers.keymap) as [KeymapMode, Record<string, string>][]).flatMap(([mode, table]) =>
    Object.entries(table)
      .filter(([, text]) => text !== "" && [resolve(text, "") ?? []].flat().some((step) => step.id === command_id))
      .map(([keys]) => `${mode} "${keys}"`),
  );
}

// An edit the compile dropped shows why, instead of showing in force. A text that does not read leaves the binding under it, a skip leaves no leaf.
function with_skipped_edits(rows: BindingRow[], compiled: CompileOutput): BindingRow[] {
  return rows.map((row) => {
    if (row.origin !== "edit") return row;
    const reason = compiled.warnings.find((warning) => warning.startsWith(`keymap edits: ${row.mode} skipped "${row.keys}":`) || warning.startsWith(`${row.mode}: skipped "${row.keys}":`));
    const has_leaf = leaves_near(compiled.compiled.modes[row.mode], parse_sequence(row.keys).tokens ?? []).has(row.keys);
    if (reason === undefined && has_leaf) return row;
    return { ...row, skipped: reason ?? "the compile skips it" };
  });
}

const failure = (error: unknown): { ok: false; message: string } => ({ ok: false, message: error instanceof Error ? error.message : String(error) });

export function create_keymap_messages(deps: KeymapMessageDeps) {
  const rows_of = (config: MergedConfig, edits: KeymapEdits) => binding_rows(deps.default_keymap, config.keymap, edits, deps.registry, { search_engines: Object.keys(config.search_engines) });

  async function list(): Promise<ListBindingsAnswer> {
    try {
      const state = await deps.read_keymap_state();
      return { ok: true, bindings: with_skipped_edits(rows_of(state.config, state.layers.keymap), state.compile(state.layers)) };
    } catch (error) {
      return failure(error);
    }
  }

  async function check(request: CheckBinding): Promise<CheckBindingAnswer> {
    try {
      return { ok: true, ...check_candidate(await deps.read_keymap_state(), deps.registry, request) };
    } catch (error) {
      return failure(error);
    }
  }

  async function change(request: ChangeKeymap): Promise<ChangeKeymapAnswer> {
    const { mode, action } = request;
    if (action !== "set" && action !== "remove" && action !== "reset") return { ok: false, message: `unknown action ${JSON.stringify(action)}` };
    if (!is_mode(mode)) return { ok: false, message: `unknown mode ${JSON.stringify(mode)}` };
    if (typeof request.keys !== "string") return { ok: false, message: "the edit names no keys" };
    const normalized = normalized_keys(mode, request.keys);
    if ("problem" in normalized) return { ok: false, message: `${mode} "${request.keys}": ${normalized.problem}` };
    const { keys } = normalized;
    try {
      if (action === "set") {
        if (typeof request.text !== "string" || request.text.trim() === "") return { ok: false, message: "the edit names no command" };
        // The check and the change are two queue turns: a reload between them can still make the text bad, and then the compile drops it with a warning.
        const verdict = check_candidate(await deps.read_keymap_state(), deps.registry, { mode, keys, text: request.text });
        if (!verdict.saves) {
          const problems = [...verdict.problems, ...verdict.warnings];
          return { ok: false, message: `${mode} "${keys}" not saved: ${problems[0] ?? "the compile skips it"}`, problems };
        }
      }
      let row: BindingRow | undefined;
      let changed = false;
      await deps.change_layers("keymap", (current, config) => {
        // A key only an edit binds is unbound by dropping the edit. Unbinding a file or default binding takes an empty text.
        const file_bindings = by_spelling(config.keymap[mode] ?? {});
        const underlying = Object.hasOwn(file_bindings, keys) ? file_bindings[keys] : deps.default_keymap[mode]?.[keys];
        const text = action === "set" ? request.text : action === "remove" && underlying ? "" : undefined;
        const next = with_key_edit(current, mode, keys, text);
        row = rows_of(config, next).find((candidate) => candidate.mode === mode && candidate.keys === keys);
        changed = JSON.stringify(next) !== JSON.stringify(current);
        return changed ? next : undefined;
      });
      // A key only a generator binds (`search_keys` and the like), or bound nowhere, has nothing here to change.
      if (!changed) return { ok: false, message: `Nothing to change: ${{ set: "it already runs that text", remove: "no file or default binding to remove", reset: "no edit to reset" }[action]} on ${mode} "${keys}".` };
      const done = { set: `Bound ${keys} in ${mode} mode`, remove: `Unbound ${keys} in ${mode} mode`, reset: `Reset ${keys} in ${mode} mode` }[action];
      return { ok: true, ...(row && { row }), message: done };
    } catch (error) {
      return failure(error);
    }
  }

  return { list, check, change };
}

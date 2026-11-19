// Loads the config, compiles the keymap and publishes the result.

import { best_effort, keep_chain, warn_and_go } from "../shared/swallow.ts";
import { effective_settings, needs_page, with_fallback_engines } from "../shared/config.ts";
import { built_in_theme_names } from "../shared/theme/load.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import type { MergedConfig, SettingEdits, SettingOverrides, Settings } from "../shared/config.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import { registry } from "../shared/registry/builtin.ts";
import { container_names, make_router_deps, show_toast_on_tab, snippet_deps } from "./browser_deps.ts";
import { compile_config } from "./compile.ts";
import type { CompileInput } from "./compile.ts";
import type { KeymapState } from "./keymap_message.ts";
import { alias_edits_of, engine_edits_of, has_build_edits, load_layers, store_layers } from "./edit_layers.ts";
import type { AliasEdits, EditLayers, EngineEdits, LayerKind, LayerOf } from "./edit_layers.ts";
import { build_layered, dropped_warning, fresh_drops, refusal_of } from "./engine_layer.ts";
import type { EngineState } from "./engine_message.ts";
import type { AliasState } from "./alias_message.ts";
import type { LayeredBuild } from "./engine_layer.ts";
import { build_config_status, load_config, load_edits, load_effective_config, load_files_source, store_edits, with_edits } from "./config_load.ts";
import type { FilesSource, LoadedConfig } from "./config_load.ts";
import { DEFAULT_KEYMAP } from "./default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "./default_site_rows.ts";
import { DESKTOP_THEME } from "../shared/theme/roles.ts";
import { THEME_STORAGE_KEY, USER_CSS_STORAGE_KEY } from "../shared/theme/apply.ts";
import { CONFIG_STATUS_STORAGE_KEY, DESKTOP_THEME_STORAGE_KEY, DISABLED_STORAGE_KEY, LAYERED_CONFIG_STORAGE_KEY, SLOT_TABLE_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "./storage_keys.ts";
import { OFF_KEYMAP, saved_popup_rows, site_is_off, site_pattern, site_rows_after } from "./toolbar.ts";
import { saved_pass_rows, site_rows_with_pass, site_rows_without_pass } from "./site_keys.ts";
import type { SiteRuleRow } from "../shared/match_pattern.ts";
import { apply_slot_plan, plan_slots, read_slot_map, release_slots, SLOT_COUNT, slot_table, store_slot_map } from "./slots.ts";
import type { SlotPlan } from "./slots.ts";
import { no_repeat_memory } from "./repeat_memory.ts";
import { create_snippets } from "./snippets.ts";
import { browser_native_deps, create_native_client, host_file_of, NativeHostError } from "./native_client.ts";
import type { ConfigFilesReply } from "./native_client.ts";
import { create_host_update } from "./host_update.ts";
import { browser_host_update_deps } from "./host_update_browser.ts";
import { build_files_config, ConfigRefusal, KEPT_CURRENT } from "./config_reload.ts";
import type { ApplyAction } from "./config_reload.ts";
import { checked_consent, IMPORT_DIR_LABEL, imports_nothing, plan_import_files, preview_import, preview_snippet, read_import_source } from "./config_import.ts";
import { edit_problem, is_snippet_file } from "../shared/config_file_path.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import type { ConfigImportPreview, SnippetPreview } from "../shared/messages.ts";
import { create_autoconfig_mirror } from "./autoconfig_mirror.ts";
import { css_limit_breaches } from "./css_limits.ts";
import { key_edits_running } from "./keymap_message.ts";
import { parse_snippet } from "../shared/config_build/snippet.ts";
import { commands_of_registry } from "../shared/config_build/build_config.ts";
import { drop_keymap } from "./keymap_source.ts";
import { FILES_CONFIG_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY, THEME_EDITS_STORAGE_KEY } from "./storage_keys.ts";
import { classify_host_start, clear_host_pending, compared_files, files_digest, has_config_files, read_host_memory, remember_applied, same_files, settle_host_start, store_host_pending } from "./host_start.ts";
import { files_before_unsynced, held_in_settings_d, read_unsynced, replayed_on_folder, rows_in_settings_file, SETTINGS_FILE, settings_d_file_that_sets, settings_d_files_naming, settings_file_naming, settings_file_sets, store_unsynced, theme_named_in, stored_unsynced, text_sha256, unsynced_of_stored, with_setting_in_files, with_unsynced_path, without_setting, without_setting_in_files, without_unsynced_path } from "./settings_file.ts";
import type { CopyReplacedBy, FileWriteOutcome, UnsyncedFiles } from "./settings_file.ts";
import type { TomlScalar, TomlValue } from "./toml_key_edit.ts";
import { imports_moved_to_files, theme_file_path } from "./theme_message.ts";
import type { ThemeFileChange } from "./theme_message.ts";
import type { HostStartChoice } from "../shared/messages.ts";

export const snippets = create_snippets(registry, snippet_deps, make_router_deps(get_config, no_repeat_memory));
// The updater needs the client to send `self_update`, and the client reports each reply to the updater, so the updater reads `native_host` late.
export const host_update = create_host_update(browser_host_update_deps(() => get_config(), (request) => native_host.self_update(request)));
export const native_host = create_native_client(browser_native_deps(), host_update.watch);
const autoconfig = create_autoconfig_mirror({ write_autoconfig: native_host.write_autoconfig, warn: console.warn });

// Everything a load (the first one, or a `config.reload`) works out and `publish` reuses. Browser edits are not part of it: they change while this stays.
type LoadStep = {
  loaded: LoadedConfig;
  // Warnings of the load itself. A publish adds the compile warnings to them.
  load_warnings: string[];
  // Found on the first publish of a load. A `:set` keeps it: it refuses the prefix settings, the only ones that move keys.
  slots?: { plan: SlotPlan; table: ReturnType<typeof slot_table>; warnings: string[]; applied: boolean };
  // The files the load built, when the load knows them. Otherwise the engines and aliases layers read them from storage the first time they build.
  source?: FilesSource;
  // The last build of the engines and aliases layers over the files, so a `:set` publish does not build again. Keyed by the layers.
  layered?: { key: string; build: LayeredBuild };
};

// Derived from storage on every start, so a restart loses nothing.
let load_step: Promise<LoadStep> | undefined;
// Replaced after each publish, so a reader never sees the config from before a `:set`.
let current_config: Promise<MergedConfig> | undefined;

export function get_config(): Promise<MergedConfig> {
  return (current_config ??= start());
}

export async function get_search_engine_names(): Promise<string[]> {
  return Object.keys((await get_config()).search_engines);
}

async function start(): Promise<MergedConfig> {
  const loaded = await load_config();
  // Before the compile, so a key bound to a snippet resolves.
  const snippet_warnings = snippets.register(loaded.config.snippets);
  const step: LoadStep = { loaded, load_warnings: [...loaded.warnings, ...snippet_warnings] };
  load_step = Promise.resolve(step);
  return (await publish(step, await load_edits())).config;
}

async function compile_input(config: MergedConfig, layers: EditLayers): Promise<CompileInput> {
  return {
    config,
    desktop_theme: await pushed_theme(),
    default_keymap: DEFAULT_KEYMAP,
    default_site_rows: DEFAULT_SITE_ROWS,
    get_command: (command_id) => registry.get(command_id),
    registry,
    enum_sources: { search_engines: Object.keys(config.search_engines), containers: await container_names() },
    keymap_edits: layers.keymap,
  };
}

// Compiles the loaded config under the browser edits, stores the result and tells the tabs.
// `warnings` is the whole list the help page shows: load, compile and shortcut slots.
// The edit layers are read from storage unless given, so every publish keeps them on top of the files.
async function publish(step: LoadStep, edits: SettingEdits, layers?: EditLayers): Promise<{ config: MergedConfig; warnings: string[] }> {
  const in_force = layers ?? (await load_layers());
  const layered = has_build_edits(in_force) ? await layered_build(step, engine_edits_of(in_force), alias_edits_of(in_force)) : undefined;
  const config = with_edits(layered?.loaded.config ?? step.loaded.config, edits);
  const { compiled, theme, warnings } = compile_config(await compile_input(config, in_force));
  // The build repeats the warnings of the files build, which the load warnings hold already.
  const layer_warnings = layered ? [...layered.loaded.warnings.filter((warning) => !step.load_warnings.includes(warning)), ...layered.dropped.map(dropped_warning)] : [];

  // Read at every publish, so a restart with the switch off, a `:set` and a reload all store the empty keymap.
  const disabled = (await browser.storage.local.get(DISABLED_STORAGE_KEY))[DISABLED_STORAGE_KEY] === true;
  // The map is read and written only here, and a publish runs in the change queue or before any other, so two saves never read the same map.
  // A fresh plan is stored before the slots are applied. A failed publish puts the old map back with the rest (`change_layers`, `apply_files`).
  let plan = step.slots?.plan;
  if (!plan) {
    plan = plan_slots(compiled.modes.browser, SLOT_COUNT, await read_slot_map());
    await store_slot_map(plan.map);
  }
  if (disabled) {
    // A taken chord would still be eaten by Firefox, so the page would lose it while off.
    await release_slots(plan, browser.commands);
    step.slots = { plan, table: slot_table({ ...plan, assignments: [] }), warnings: plan.warnings, applied: false };
  } else if (!step.slots?.applied) {
    const applied = await apply_slot_plan(plan, browser.commands);
    step.slots = { plan, table: slot_table({ ...plan, assignments: applied.applied }), warnings: [...plan.warnings, ...applied.warnings], applied: true };
  }
  const all_warnings = [...step.load_warnings, ...layer_warnings, ...warnings, ...step.slots.warnings];
  for (const warning of all_warnings) console.warn(`desertfox: ${warning}`);

  await browser.storage.local.set({
    [COMPILED_KEYMAP_STORAGE_KEY]: disabled ? OFF_KEYMAP : compiled,
    [WARNINGS_STORAGE_KEY]: all_warnings,
    [CONFIG_STATUS_STORAGE_KEY]: build_config_status(step.loaded.source, step.loaded.config.settings, edits),
    [LAYERED_CONFIG_STORAGE_KEY]: layered?.stored.config ?? null,
    [SLOT_TABLE_STORAGE_KEY]: step.slots.table,
    [THEME_STORAGE_KEY]: theme,
    [USER_CSS_STORAGE_KEY]: config.css,
  });
  drop_keymap();
  await tell_tabs_tree_changed();
  return { config, warnings: all_warnings };
}

// The commands the build checks snippet ids against: the built-in ones, so the snippets of the last load stay out.
const built_in_commands = () => commands_of_registry(registry).filter((command) => !snippets.is_snippet(command.id));

async function layered_build(step: LoadStep, engines: EngineEdits, aliases: AliasEdits): Promise<LayeredBuild> {
  const key = JSON.stringify([engines, aliases]);
  if (step.layered?.key === key) return step.layered.build;
  step.source ??= await load_files_source();
  const build = build_layered(step.source.files, step.source.dir_label, built_in_commands(), engines, aliases);
  step.layered = { key, build };
  return build;
}

async function pushed_theme(): Promise<string | undefined> {
  const pushed = (await browser.storage.local.get(DESKTOP_THEME_STORAGE_KEY))[DESKTOP_THEME_STORAGE_KEY];
  return typeof pushed === "string" ? pushed : undefined;
}

// The bridge stores the theme the desktop pushed. It republishes only while `theme` follows the desktop, so a push never moves a theme the user chose by name. A repeat of the stored name still republishes, so a retry after a failed publish applies it.
export function set_desktop_theme(name: string): Promise<void> {
  return in_change_queue(async () => {
    await browser.storage.local.set({ [DESKTOP_THEME_STORAGE_KEY]: name });
    const config = await get_config();
    if (config.settings.theme === DESKTOP_THEME) await publish(await (load_step as Promise<LoadStep>), await load_edits());
  });
}

// `:set` and `:unset` change the edits one at a time, so two of them in a row never read the same stored value.
let change_queue: Promise<unknown> = Promise.resolve();
// Counts committed swaps, so the start read can tell that a newer reload or import landed while it waited on the host.
let swap_count = 0;

// Stores `next` and publishes it. On a failure it stores `before` again and publishes that, then throws.
async function commit_change<T>(before: T, next: T, write: { store: (value: T) => Promise<void>; publish: (value: T) => Promise<{ config: MergedConfig }> }): Promise<void> {
  try {
    // Inside the try: a store can be several writes, and one can land while another fails.
    await write.store(next);
    // Assigned after the publish succeeds, so a failed one leaves the readers the last good config.
    current_config = Promise.resolve((await write.publish(next)).config);
  } catch (error) {
    // Pages read the stored edits themselves, so a failed publish must not leave them ahead of the config.
    // Best effort, so a failed rollback never hides the error that caused it.
    await write.store(before).catch(warn_and_go("rollback store"));
    // Best effort: the failed publish may have written the keymap and status for `next` already.
    await write.publish(before).catch(warn_and_go("rollback publish"));
    throw error;
  }
}

// `decide` gets the edits now in force and the config under them. It returns the edits to keep, or nothing to change nothing.
export function change_edits(decide: (current: SettingEdits, config: MergedConfig) => SettingEdits | undefined): Promise<void> {
  return in_change_queue(async () => {
    const config = await get_config();
    const before = await load_edits();
    const next = decide(before, config);
    if (next === undefined) return;
    await commit_change(before, next, { store: store_edits, publish: async (edits) => publish(await (load_step as Promise<LoadStep>), edits) });
    if (JSON.stringify(next.saved) !== JSON.stringify(before.saved)) void autoconfig.mirror(next.saved, (await load_layers()).keymap);
  });
}

// What the Firefox shortcut slots follow: the browser chords, and the engines a `search` binding can name.
const chord_state = (layers: EditLayers): string => JSON.stringify([layers.keymap.browser ?? {}, layers.engines ?? {}]);

// `change_edits` for one edit layer, in the same queue, so a key edit and a `:set` never publish over each other.
// `decide` gets the key editor's state of this turn, so its slot check sees every change that landed before it.
export function change_layers<K extends LayerKind>(kind: K, decide: (current: LayerOf<K>, state: KeymapState) => LayerOf<K> | undefined): Promise<void> {
  return in_change_queue(async () => {
    const config = await get_config();
    const before = await load_layers();
    const changed = decide((before[kind] ?? {}) as LayerOf<K>, await keymap_state(config, before));
    if (changed === undefined) return;
    const next: EditLayers = { ...before, [kind]: changed };
    const step = await (load_step as Promise<LoadStep>);
    // An engines or aliases edit is refused for what it breaks, before anything is stored. A piece the files already broke stays out of the way, so it can still be removed.
    if ((kind === "engines" || kind === "aliases") && has_build_edits(next)) {
      const known = has_build_edits(before) ? (await layered_build(step, engine_edits_of(before), alias_edits_of(before))).dropped : [];
      const fresh = fresh_drops(await layered_build(step, engine_edits_of(next), alias_edits_of(next)), known);
      if (fresh.length > 0) throw refusal_of(fresh);
    }
    const slot_map_before = await read_slot_map();
    // A publish keeps the slot plan of the load, so a change of the browser chords drops it, both ways: the rollback must put the old chords back too.
    // An engine edit moves them too: it can drop a `search <engine>` binding the browser holds a slot for.
    const moves_chords = chord_state(before) !== chord_state(next);
    const publish_layers = async (layers: EditLayers) => {
      if (moves_chords) delete step.slots;
      return publish(step, await load_edits(), layers);
    };
    // The rollback stores `before`: the chord-to-slot map goes back with it, or the old chords would plan from the new map.
    const store = async (layers: EditLayers) => {
      await store_layers(layers);
      if (layers === before) await store_slot_map(slot_map_before);
    };
    await commit_change(before, next, { store, publish: publish_layers });
    if (JSON.stringify(next.keymap) !== JSON.stringify(before.keymap)) void autoconfig.mirror((await load_edits()).saved, next.keymap);
  });
}

// The config in force, the stored layers, the slot map and a compile of that config under any layers.
async function keymap_state(config: MergedConfig, layers: EditLayers): Promise<KeymapState> {
  const input = await compile_input(config, layers);
  return { config, layers, slot_map: await read_slot_map(), compile: (other) => compile_config({ ...input, keymap_edits: other.keymap }) };
}

// What the settings page reads, in the change queue so a change still storing or rolling back is not seen half done.
export function read_settings_layers(): ReturnType<typeof load_effective_config> {
  return in_change_queue(() => load_effective_config());
}

// What the key editor reads, in the change queue so a change still writing or rolling back is not seen half done.
export function read_keymap_state(): Promise<KeymapState> {
  return in_change_queue(async () => keymap_state(await get_config(), await load_layers()));
}

// What the engine and alias forms read: the layers in force, what the build kept of them and what it left out.
async function read_layer_build(): Promise<{ config: MergedConfig; layers: EditLayers; current?: LayeredBuild; source: FilesSource }> {
  const config = await get_config();
  const layers = await load_layers();
  const step = await (load_step as Promise<LoadStep>);
  const current = has_build_edits(layers) ? await layered_build(step, engine_edits_of(layers), alias_edits_of(layers)) : undefined;
  step.source ??= await load_files_source();
  return { config, layers, ...(current && { current }), source: step.source };
}

export function read_engine_state(): Promise<EngineState> {
  return in_change_queue(async () => {
    const { config, layers, current, source } = await read_layer_build();
    const { files, dir_label } = source;
    const aliases = alias_edits_of(layers);
    return { config, engines: engine_edits_of(layers), aliases, kept: current?.kept ?? {}, kept_aliases: current?.kept_aliases ?? {}, dropped: current?.dropped ?? [], trial: (other) => build_layered(files, dir_label, built_in_commands(), other, aliases) };
  });
}

// The browser copy of the config files, read in the change queue so a change still writing is not seen half done.
export function read_stored_files(): Promise<ConfigFiles> {
  return in_change_queue(async () => (await load_files_source()).files);
}

export function read_alias_state(): Promise<AliasState> {
  return in_change_queue(async () => {
    const { config, layers, current } = await read_layer_build();
    return { config, aliases: alias_edits_of(layers), kept: current?.kept_aliases ?? {}, dropped: current?.dropped ?? [] };
  });
}

// Publishes again under the current edits, for a change that is not an edit: the toolbar switch. It runs in the change queue like the edits.
export function republish(): Promise<void> {
  const again = change_queue.then(async () => {
    await get_config();
    await publish(await (load_step as Promise<LoadStep>), await load_edits());
  });
  change_queue = keep_chain(again);
  return again;
}

// The one swap path of `config.reload` and of an import: builds the raw files and swaps the config, snippets and stored files in place.
// Nothing restarts, so the edits and the modes stay. Runs only inside the change queue, so a swap, a `:set` and another swap never publish over each other.
// A setting write passes `setting`: the edits that replace the setting edits, and the record of the folder's base texts (none when no file is written).
// They go into the same storage write as the files, so a stop between writes never leaves one without the other, and a failure restores them all.
async function apply_files(source: FilesSource, action: ApplyAction, setting?: { edits_after: SettingEdits; unsynced: UnsyncedFiles | undefined }): Promise<{ warnings: number }> {
  const { files, dir_label } = source;
  await get_config();
  const current_step = await (load_step as Promise<LoadStep>);
  // The build checks snippet ids against the built-in commands, so the snippets of the last load stay out.
  const { stored, loaded } = build_files_config(files, dir_label, built_in_commands(), action);
  const edits = await load_edits();
  const swapped_keys = [FILES_CONFIG_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY];
  const local_before = await browser.storage.local.get(swapped_keys);
  const unsynced_after = setting ? setting.unsynced : await unsynced_kept_by(action, source);
  let local_written = false;
  // From here the registry holds the new snippets while the tabs still run the old keymap.
  // Readers wait on `get_config` until the swap commits, so no command runs against half of it.
  const config_before = current_config as Promise<MergedConfig>;
  const slot_map_before = await read_slot_map();
  let commit!: (config: MergedConfig | Promise<MergedConfig>) => void;
  current_config = new Promise<MergedConfig>((resolve) => (commit = resolve));
  try {
    // Before the publish, so a key bound to a snippet resolves.
    const snippet_warnings = snippets.register(loaded.config.snippets);
    // No slots: the new keymap can move the browser chords, so the publish plans them again.
    const step: LoadStep = { loaded, load_warnings: [...loaded.warnings, ...snippet_warnings], source };
    const published = await publish(step, setting?.edits_after ?? edits);
    // One `set`, so the config, the files it was built from, the saved edits and the record of a lagging folder never part.
    // `null` drops the record within the same `set`.
    local_written = true;
    await browser.storage.local.set({
      [FILES_CONFIG_STORAGE_KEY]: stored,
      [FILES_SOURCE_STORAGE_KEY]: source satisfies FilesSource,
      [SETTINGS_FILE_UNSYNCED_STORAGE_KEY]: stored_unsynced(unsynced_after),
      ...(setting && { [SAVED_SETTINGS_STORAGE_KEY]: setting.edits_after.saved }),
    });
    // Temp edits live in session storage, which no `set` of local storage covers.
    if (setting) await browser.storage.session.set({ [TEMP_SETTINGS_STORAGE_KEY]: setting.edits_after.temp });
    // A setting write keeps the copies-differ question: its own write classifies the folder again.
    if (action !== "setting") await clear_host_pending();
    load_step = Promise.resolve(step);
    commit(published.config);
    swap_count += 1;
    if (!setting) {
      const dropped = Object.keys(unsynced_of_stored(local_before[SETTINGS_FILE_UNSYNCED_STORAGE_KEY]) ?? {}).filter((path) => !unsynced_after || !Object.hasOwn(unsynced_after, path));
      for (const path of dropped) note_record_dropped(path, action === "import" || action === "edit" ? action : "reload");
    }
    return { warnings: published.warnings.length };
  } catch (error) {
    // The failed publish may have written the new keymap and status already.
    // Each step is best effort, so a failed rollback never hides the error that caused it.
    try {
      snippets.register(current_step.loaded.config.snippets);
    } catch {
      // The publish below still puts the old keymap back.
    }
    // The failed publish may have stored a map planned from the new keymap.
    await store_slot_map(slot_map_before).catch(warn_and_go("rollback slot map"));
    if (local_written) await restore_local(swapped_keys, local_before).catch(warn_and_go("rollback stored files"));
    if (setting) await browser.storage.session.set({ [TEMP_SETTINGS_STORAGE_KEY]: edits.temp }).catch(warn_and_go("rollback temp edits"));
    await publish({ loaded: current_step.loaded, load_warnings: current_step.load_warnings }, edits).catch(warn_and_go("rollback publish"));
    commit(config_before);
    throw error;
  }
}

// Puts each key back as it was, and removes the ones that were absent.
async function restore_local(keys: string[], before: Record<string, unknown>): Promise<void> {
  await browser.storage.local.set(Object.fromEntries(keys.filter((key) => Object.hasOwn(before, key)).map((key) => [key, before[key]])));
  await browser.storage.local.remove(keys.filter((key) => !Object.hasOwn(before, key)));
}

// The record of a file the folder has not got survives an editor save or a snippet change that leaves that file as it was: the browser's edit is still the only change to it.
// A reload or an import that replaces the config brings the copy from elsewhere, and a save of the file itself changes what the folder would get, so those drop its path.
async function unsynced_kept_by(action: ApplyAction, source: FilesSource): Promise<UnsyncedFiles | undefined> {
  // An import of snippets alone keeps the config files, so it is a snippet change too.
  const keeps_config = action === "edit" || action === "remove" || (action === "import" && !source.imported);
  const unsynced = keeps_config ? await read_unsynced() : undefined;
  if (!unsynced) return undefined;
  const stored = (await load_files_source()).files;
  return stored_unsynced(Object.fromEntries(Object.entries(unsynced).filter(([path]) => stored[path] === source.files[path]))) ?? undefined;
}

function in_change_queue<T>(work: () => Promise<T>): Promise<T> {
  const queued = change_queue.then(work);
  change_queue = keep_chain(queued);
  return queued;
}

// Writes `value` into the browser copy of settings.toml, drops any saved or temp edit of `name` that would hide it, then asks the host to write the file.
export function set_in_settings_file(name: keyof Settings, value: TomlValue): Promise<FileWriteOutcome> {
  return change_setting_in_file<FileWriteOutcome>(name, async (files) => {
    if (name === "theme" && typeof value === "string" && !(await theme_in_files(value))) throw new RuntimeRefusal(`theme not changed: no theme named "${value}"`);
    if (name === "default_engine" && typeof value === "string") {
      if (needs_page(with_fallback_engines((await get_config()).search_engines)[value])) throw new RuntimeRefusal(`default_engine not changed: ${value} needs the current page, so it cannot be the default engine`);
      const home = await where_engine_named(value);
      if (home === "nowhere") throw new RuntimeRefusal(`default_engine not changed: no search engine named "${value}"`);
      if (home === "browser") {
        await save_in_browser(name, value);
        return { done: { kind: "saved_in_browser" } };
      }
    }
    return { files: with_setting_in_files(files, name, value) };
  });
}

// Flips the value in force and writes it as `set_in_settings_file` does. The value is read in the change queue, so two quick toggles flip twice.
export async function toggle_in_settings_file(name: keyof Settings): Promise<{ value: boolean; outcome: FileWriteOutcome }> {
  let value = false;
  const outcome = await change_setting_in_file<FileWriteOutcome>(name, async (files) => {
    value = !effective_settings((await get_config()).settings)[name];
    return { files: with_setting_in_files(files, name, value) };
  });
  return { value, outcome };
}

// What an unset did besides a file write: `edits_only` dropped the browser edits and left settings.toml as it was, `not_set` found nothing to drop.
export type UnsetResult = FileWriteOutcome | { kind: "edits_only" } | { kind: "not_set" };

// Removes `name` from settings.toml and drops its saved and temp edits, so the default applies.
// A `settings.d` file that sets it would still win, so the file stays as it is then: the browser edits go, or, with none, the unset refuses and names that file.
export function unset_in_settings_file(name: keyof Settings): Promise<UnsetResult> {
  return change_setting_in_file<UnsetResult>(name, async (files) => {
    const edits = await load_edits();
    const has_browser_edit = Object.hasOwn(edits.saved, name) || Object.hasOwn(edits.temp, name);
    const winning_file = settings_d_file_that_sets(files, name);
    if (winning_file === undefined && settings_file_sets(files, name)) return { files: without_setting_in_files(files, name) };
    if (has_browser_edit) {
      await drop_edits_of(name);
      return { done: { kind: "edits_only" } };
    }
    if (winning_file !== undefined) throw held_in_settings_d(winning_file, name);
    return { done: { kind: "not_set" } };
  });
}

// The popup's Disable or Enable on the site of the page at `url`: appends its off row to the `[[site_rules]]` of settings.toml, or removes its rows for the site's pattern there.
// A list the popup saved in the browser before it wrote the file is dropped on every click, even one that changes no row, and its own rows go into the file.
// `unchanged`: the site already was as asked and no saved list was left, so nothing is written.
export function change_site_rule_in_file(url: string, action: "disable" | "enable"): Promise<FileWriteOutcome | { kind: "unchanged" }> {
  return change_setting_in_file<{ kind: "unchanged" }>("site_rules", async (files) => {
    const pattern = site_pattern(url);
    if (pattern === undefined) throw new RuntimeRefusal("this page has no site to change");
    // Checked before the rows, as a popup row held in that file reads as already gone from settings.toml.
    const winning_file = settings_d_file_that_sets(files, "site_rules");
    if (winning_file !== undefined) throw held_in_settings_d(winning_file, "site_rules");
    const saved_list = (await load_edits()).saved.site_rules;
    const file_rows = rows_in_settings_file(files, "site_rules") as SiteRuleRow[];
    const rows = [...file_rows, ...saved_popup_rows(file_rows, saved_list)];
    const changed_rows = site_rows_after(rows, pattern, action);
    const rows_after = changed_rows ?? rows;
    // With the saved list gone, the file's own rules decide again, and one of them can still decide the site the other way.
    if (site_is_off(rows_after, url) !== (action === "disable")) {
      throw new RuntimeRefusal(action === "disable" ? "Not disabled: an earlier rule in site_rules keeps this site on. Change it in settings.toml." : "Not enabled: another rule in site_rules turns this site off. Change it in settings.toml.");
    }
    if (changed_rows === undefined && saved_list === undefined) return { done: { kind: "unchanged" } };
    // No rows left removes the key, so a file that had none before the first click gets its text back.
    return { files: rows_after.length === 0 ? without_setting_in_files(files, "site_rules") : with_setting_in_files(files, "site_rules", rows_after as TomlValue) };
  });
}

// The Settings form's Save and Remove for the keys a site keeps: writes or removes its `{site, pass}` row in settings.toml, in place when the file has one. `unchanged`: Remove found no row.
export function change_site_keys_in_file(pattern: string, keys: string | null): Promise<FileWriteOutcome | { kind: "unchanged" }> {
  return change_setting_in_file<{ kind: "unchanged" }>("site_rules", async (files) => {
    const winning_file = settings_d_file_that_sets(files, "site_rules");
    if (winning_file !== undefined) throw held_in_settings_d(winning_file, "site_rules");
    const file_rows = rows_in_settings_file(files, "site_rules") as SiteRuleRow[];
    const saved_list = (await load_edits()).saved.site_rules;
    const rows = [...file_rows, ...saved_popup_rows(file_rows, saved_list), ...saved_pass_rows(file_rows, saved_list, pattern)];
    let rows_after: SiteRuleRow[];
    if (keys === null) {
      const removed = site_rows_without_pass(rows, pattern);
      if (removed === undefined) return { done: { kind: "unchanged" } };
      rows_after = removed;
    } else {
      const changed = site_rows_with_pass(rows, pattern, keys);
      if ("refusal" in changed) throw new RuntimeRefusal(`Not saved. ${changed.refusal}`);
      rows_after = changed.rows;
    }
    return { files: rows_after.length === 0 ? without_setting_in_files(files, "site_rules") : with_setting_in_files(files, "site_rules", rows_after as TomlValue) };
  });
}

// One change of `name` in settings.toml. `plan` runs in the change queue on the browser copy's files and returns them changed, or a result that wrote no file.
// The change drops the saved and temp edits of `name`, so no browser edit hides the file.
async function change_setting_in_file<R>(name: keyof Settings, plan: (files: ConfigFiles) => Promise<{ files: ConfigFiles } | { done: R }>): Promise<FileWriteOutcome | R> {
  const changed = await change_folder_files<R>(async (files) => {
    const planned = await plan(files);
    return "done" in planned ? planned : { files: planned.files, edits_after: without_setting(await load_edits(), name), paths: [SETTINGS_FILE] };
  });
  return "done" in changed ? changed.done : changed.outcomes[0]!;
}

// A change of config files the host writes: the browser copy's files after it, the setting edits after it, and the paths it changed, in the order they are written.
type FolderFilesPlan = { files: ConfigFiles; edits_after: SettingEdits; paths: string[] };

// One change of files the folder holds. `plan` runs in the change queue on the browser copy's files. The outcomes follow the plan's paths.
// Only the edit runs in the change queue. The host writes run outside it, one path after the other, so a slow host never holds up a `:set`.
async function change_folder_files<R>(plan: (files: ConfigFiles) => Promise<FolderFilesPlan | { done: R }>): Promise<{ done: R } | { outcomes: FileWriteOutcome[] }> {
  const committed = await in_change_queue(async () => {
    const current = await load_files_source();
    const planned = await plan(current.files);
    if ("done" in planned) return planned;
    return { paths: planned.paths, ...(await commit_folder_files(current, planned)) };
  });
  if ("done" in committed) return committed;
  if (committed.picks === undefined) return { outcomes: committed.paths.map((): FileWriteOutcome => ({ kind: "browser_copy" })) };
  const outcomes: FileWriteOutcome[] = [];
  // A pick always stores a record, so the loop finds an outcome. The fallback only satisfies the type.
  for (const pick of committed.picks) outcomes.push((await write_waiting_file(in_change_queue, pick.path, pick)) ?? { kind: "written" });
  // The question was made against the copy before the pick. The folder may still differ in other files, so it is asked again or settled.
  if (outcomes.every((outcome) => outcome.kind === "written") && committed.question_was_pending) {
    const folder = await read_folder_after_write();
    if (folder) await in_change_queue(() => ask_when_folder_differs(folder, { clear_when_settled: true }));
  }
  return { outcomes };
}

// In the change queue. Swaps in the planned files and edits, with each changed path in the record when the copy came from the folder, and numbers a pick for each path.
// No picks: the copy did not come from the folder, so only the copy changed.
async function commit_folder_files(current: FilesSource, planned: FolderFilesPlan): Promise<{ question_was_pending: boolean; picks?: PickMark[] }> {
  // An earlier edit the folder never got keeps its base: the folder still holds that text.
  const from_folder = await came_from_folder(current);
  let unsynced = from_folder ? await read_unsynced() : undefined;
  if (from_folder) for (const path of planned.paths) unsynced = with_unsynced_path(unsynced, path, current.files[path] ?? null);
  const edits = await load_edits();
  const question_was_pending = (await browser.storage.local.get(HOST_START_PENDING_STORAGE_KEY))[HOST_START_PENDING_STORAGE_KEY] !== undefined;
  try {
    await apply_files({ ...current, files: planned.files }, "setting", { edits_after: planned.edits_after, unsynced });
  } catch (error) {
    // The files build can refuse a value the setting's own check passes. The checks before catch the common ones with a clearer message.
    throw error instanceof ConfigRefusal ? new RuntimeRefusal(error.message) : error;
  }
  if (JSON.stringify(planned.edits_after.saved) !== JSON.stringify(edits.saved)) void autoconfig.mirror(planned.edits_after.saved, (await load_layers()).keymap);
  if (!from_folder) return { question_was_pending };
  const picks = planned.paths.map((path) => {
    const writes = writes_of(path);
    writes.picks_made += 1;
    return { path, seq: writes.picks_made, drops: writes.drops };
  });
  return { question_was_pending, picks };
}

// Saves the theme file `themes/<name>.toml` with `text`, or removes it with `text` null, in the browser copy and then through the host, as `set_in_settings_file` writes settings.toml.
// A save over an existing file needs `replace`. A remove also takes `theme` out of settings.toml and drops the saved and temp edits when they name the theme, so nothing names a theme the files no longer have.
// A `settings.d` file that sets `theme` to it refuses the remove, as the files build would refuse the config without the theme.
export async function set_theme_file(name: string, text: string | null, replace: boolean): Promise<ThemeFileChange> {
  const path = theme_file_path(name);
  let replaced = false;
  const changed = await change_folder_files<"needs_replace">(async (files) => {
    replaced = Object.hasOwn(files, path);
    const edits = await load_edits();
    if (text !== null) {
      if (replaced && !replace) return { done: "needs_replace" };
      return { files: { ...files, [path]: text }, edits_after: edits, paths: [path] };
    }
    if (!replaced) throw new RuntimeRefusal(`No theme named ${name} is in the config files.`);
    const naming_file = settings_d_files_naming(files, "theme", name)[0];
    if (naming_file !== undefined) throw new RuntimeRefusal(`${naming_file} sets theme = "${name}". Change it there before you remove the theme.`);
    const { [path]: _removed, ...others } = files;
    const edits_after = { saved: without_theme_named(edits.saved, name), temp: without_theme_named(edits.temp, name) };
    // settings.toml goes first, so the folder never names a theme file it no longer has.
    return settings_file_naming(files, "theme", name) ? { files: without_setting_in_files(others, "theme"), edits_after, paths: [SETTINGS_FILE, path] } : { files: others, edits_after, paths: [path] };
  });
  if ("done" in changed) return { kind: changed.done };
  const file = changed.outcomes.at(-1)!;
  const settings = changed.outcomes.length > 1 ? changed.outcomes[0] : undefined;
  return { kind: "changed", replaced, file, ...(settings && { settings }) };
}

const without_theme_named = (layer: SettingOverrides, theme: string): SettingOverrides => (layer.theme === theme ? Object.fromEntries(Object.entries(layer).filter(([setting]) => setting !== "theme")) : layer);

// The folder's text is the base only when the browser copy came from the folder: a copy from an import, or one that never read a folder, would seed the folder with a settings.toml of its own.
async function came_from_folder(source: FilesSource): Promise<boolean> {
  return !source.imported && (await read_host_memory()).applied !== undefined;
}

// Whether the files build knows the theme, so a settings.toml that names it builds.
async function theme_in_files(value: string): Promise<boolean> {
  const files_config = (await (load_step as Promise<LoadStep>)).loaded.config;
  return value === DESKTOP_THEME || built_in_theme_names().includes(value) || Object.hasOwn(files_config.local_themes ?? {}, value);
}

// Where an engine name is known. `browser`: only in the browser (an engine added on the Engines page), so the files build refuses a settings.toml that names it.
// An engine of the same name in the files is known to the build, so that name still goes to the file.
async function where_engine_named(value: string): Promise<"files" | "browser" | "nowhere"> {
  const files_config = (await (load_step as Promise<LoadStep>)).loaded.config;
  if (Object.hasOwn(with_fallback_engines(files_config.search_engines), value)) return "files";
  return Object.hasOwn(with_fallback_engines((await get_config()).search_engines), value) ? "browser" : "nowhere";
}

// The saved edit, as before the file write existed: it lasts, and it drops a temp edit of the name that would hide it.
async function save_in_browser(name: keyof Settings, value: TomlScalar): Promise<void> {
  const before = await load_edits();
  await commit_setting_edits(before, { saved: { ...before.saved, [name]: value }, temp: without_setting(before, name).temp });
}

async function drop_edits_of(name: keyof Settings): Promise<void> {
  const before = await load_edits();
  await commit_setting_edits(before, without_setting(before, name));
}

// `change_edits` for a caller already in the change queue.
async function commit_setting_edits(before: SettingEdits, next: SettingEdits): Promise<void> {
  await commit_change(before, next, { store: store_edits, publish: async (edits) => publish(await (load_step as Promise<LoadStep>), edits) });
  if (JSON.stringify(next.saved) !== JSON.stringify(before.saved)) void autoconfig.mirror(next.saved, (await load_layers()).keymap);
}

type HostWriteReply = { ok: true } | { ok: false; error: unknown };
// `superseded`: the record moved to a newer base during the write, so the write loop goes on from it.
type SettledWrite = FileWriteOutcome | { kind: "superseded" };
// A write of the file at `path` sent to the host (`text` null deletes it). The change queue starts it and settles its reply once, and the host call runs between the two, outside the queue.
// `covers` and `drops` are the path's `picks_made` and `drops` at the start: the text holds every pick of the path up to `covers` made since that many drops.
type HostWrite = { path: string; base: string | null; text: string | null; covers: number; drops: number; reply: Promise<HostWriteReply>; outcome?: Promise<SettledWrite> };

// What the write loop keeps for one path of the record. Each path has its own, so a refusal, a drop or a write out on one file never decides another file's outcome.
// It lives in memory only, as the replies that read it do.
// A pick is numbered when it stores the record, and a swap that drops the path counts as a drop, so a pick can tell a write that holds it from one that does not.
type PathWrites = {
  // The write out now. One at a time per path: a second write against the same base would find the first one's text and be refused.
  out?: HostWrite;
  picks_made: number;
  drops: number;
  // The swap behind each drop: entry n dropped the record of the picks made after n drops.
  drop_causes: CopyReplacedBy[];
  // How the path's record last ended, for a pick whose write another caller settled before the pick's own turn.
  end?: FileWriteOutcome;
  // Refused writes in a row whose edits went onto the folder's new text, counted per write loop. A tool that rewrites the file all the time would otherwise keep the loop going.
  replays_in_a_row: number;
};
const path_writes = new Map<string, PathWrites>();
const MAX_REPLAYS_IN_A_ROW = 3;
// Successful writes settled so far, of any path. A folder read taken before another path's write settled can hold that file's old text.
let writes_landed = 0;

function writes_of(path: string): PathWrites {
  let writes = path_writes.get(path);
  if (!writes) path_writes.set(path, (writes = { picks_made: 0, drops: 0, drop_causes: [], replays_in_a_row: 0 }));
  return writes;
}

// What a pick's reply needs to say what became of it.
type PickMark = { path: string; seq: number; drops: number };

function note_record_dropped(path: string, by: CopyReplacedBy): void {
  const writes = writes_of(path);
  writes.drop_causes[writes.drops] = by;
  writes.drops += 1;
  writes.end = { kind: "replaced", by, written: false };
}

// Runs `start` and `settle` in the change queue, or inline for a caller already in it.
type QueueRunner = <T>(work: () => Promise<T>) => Promise<T>;
const already_in_queue: QueueRunner = (work) => work();

// Writes every file the folder lags, one path after the other. A path that ends refused or waiting leaves the next one to its own write.
async function write_waiting_files(in_queue: QueueRunner): Promise<void> {
  const unsynced = await in_queue(read_unsynced);
  for (const path of Object.keys(unsynced ?? {})) await write_waiting_file(in_queue, path);
}

// Writes the browser copy of the file at `path` to the folder while the folder lags it, and again for a pick made during a write. Undefined when nothing waited.
// With `pick` it stops at the outcome of that pick: the write that holds it, or the swap that replaced it.
async function write_waiting_file(in_queue: QueueRunner, path: string, pick?: PickMark): Promise<FileWriteOutcome | undefined> {
  const writes = writes_of(path);
  let outcome: FileWriteOutcome | undefined;
  writes.replays_in_a_row = 0;
  // Whether a write that held the pick reached the folder before a swap replaced the copy.
  let pick_written = false;
  const replaced = (): FileWriteOutcome | undefined => (pick && writes.drops !== pick.drops ? { kind: "replaced", by: writes.drop_causes[pick.drops]!, written: pick_written } : undefined);
  const holds_pick = (write: HostWrite) => pick !== undefined && write.covers >= pick.seq && write.drops === pick.drops;
  // The outcome of the one write this loop makes of a path that must land first. A path still behind it after that waits for a later loop, so two files never chase each other.
  let first_outcome: FileWriteOutcome | undefined;
  let wrote_first = false;
  for (;;) {
    const first = await in_queue(() => path_to_write_first(path));
    if (first !== undefined) {
      if (wrote_first) return replaced() ?? (first_outcome?.kind === "waiting" ? first_outcome : { kind: "waiting" });
      wrote_first = true;
      first_outcome = await write_waiting_file(in_queue, first);
      continue;
    }
    const started = await in_queue(async () => replaced() ?? (await start_host_write(path)));
    if (started === undefined) return outcome ?? (pick && writes.end);
    if ("kind" in started) return started;
    const reply = await started.reply;
    const landed_before_read = writes_landed;
    const folder = changed_on_disk(reply) ? await read_folder_after_write() : undefined;
    const settled = await in_queue(async () => {
      const shared = await settle_host_write(started, reply, folder && { ...folder, current: writes_landed === landed_before_read });
      if (reply.ok && holds_pick(started)) pick_written = true;
      return replaced() ?? shared;
    });
    if (settled.kind === "superseded") continue;
    outcome = settled;
    if (outcome.kind !== "written" || (pick && started.covers >= pick.seq)) return outcome;
  }
}

// A settings.toml `theme` and the theme file it names reach the folder in the order that keeps the folder building: the file before a settings.toml that names it, and a settings.toml that names it no more before the file's delete.
// The path of the record whose write goes before the one at `path`, or undefined. In the change queue.
async function path_to_write_first(path: string): Promise<string | undefined> {
  const unsynced = await read_unsynced();
  if (!unsynced || !Object.hasOwn(unsynced, path)) return undefined;
  const { files } = await load_files_source();
  if (path === SETTINGS_FILE) {
    const named = theme_named_in(files[SETTINGS_FILE] ?? null);
    const named_path = named === undefined ? undefined : theme_file_path(named);
    return named_path !== undefined && Object.hasOwn(unsynced, named_path) && files[named_path] !== undefined ? named_path : undefined;
  }
  const deleted_theme = files[path] === undefined ? theme_name_of_file(path) : undefined;
  if (deleted_theme === undefined || !Object.hasOwn(unsynced, SETTINGS_FILE)) return undefined;
  return theme_named_in(unsynced[SETTINGS_FILE] ?? null) === deleted_theme ? SETTINGS_FILE : undefined;
}

// In the change queue. Sends the browser copy of the file at `path` when the folder lags it, or hands back the write already out.
// A file the copy no longer has is deleted from the folder, through the same base check.
async function start_host_write(path: string): Promise<HostWrite | FileWriteOutcome | undefined> {
  const writes = writes_of(path);
  if (writes.out) return writes.out;
  const unsynced = await read_unsynced();
  if (!unsynced || !Object.hasOwn(unsynced, path)) return undefined;
  const base = unsynced[path] as string | null;
  const text = (await load_files_source()).files[path] ?? null;
  if (text === null && base === null) {
    // Neither side has the file, so there is nothing to write.
    await store_unsynced(without_unsynced_path(unsynced, path));
    return (writes.end = { kind: "written" });
  }
  const base_sha256 = base === null ? null : await text_sha256(base);
  const reply = native_host.write_config_file(path, text, base_sha256).then((): HostWriteReply => ({ ok: true }), (error: unknown): HostWriteReply => ({ ok: false, error }));
  writes.out = { path, base, text, covers: writes.picks_made, drops: writes.drops, reply };
  return writes.out;
}

const theme_name_of_file = (path: string): string | undefined => {
  const file = host_file_of(path);
  return file?.kind === "theme" ? file.name : undefined;
};

const changed_on_disk = (reply: HostWriteReply) => !reply.ok && reply.error instanceof NativeHostError && reply.error.failure === "file_changed";

const read_folder_after_write = () => native_host.read_config().catch(warn_and_go("read the folder after a config file write"));

// The folder read after a refusal. `current` is false when another path's write settled since the read began, so the read can hold that file's text from before the write.
type FolderAfterRefusal = ConfigFilesReply & { current: boolean };

// In the change queue. Applies the host's reply to the record once, however many callers waited on the write. `folder` is undefined when it could not be read.
function settle_host_write(write: HostWrite, reply: HostWriteReply, folder: FolderAfterRefusal | undefined): Promise<SettledWrite> {
  const writes = writes_of(write.path);
  if (writes.out === write) delete writes.out;
  if (reply.ok) writes.replays_in_a_row = 0;
  write.outcome ??= outcome_of_host_write(write, reply, folder);
  return write.outcome;
}

async function outcome_of_host_write(write: HostWrite, reply: HostWriteReply, folder: FolderAfterRefusal | undefined): Promise<SettledWrite> {
  if (!reply.ok && !(reply.error instanceof NativeHostError)) throw reply.error;
  const { path } = write;
  const writes = writes_of(path);
  const unsynced = await read_unsynced();
  // A swap replaced the browser copy during the write and dropped the path. On success the folder holds this text, and the copy is the swap's.
  if (!unsynced || !Object.hasOwn(unsynced, path)) return { kind: "replaced", by: writes.drop_causes[write.drops]!, written: reply.ok };
  // A later pick started a new record after a swap: its own write goes next, from its own base.
  if (unsynced[path] !== write.base) return { kind: "superseded" };
  if (!reply.ok) {
    // The new record can share the dropped one's base, and this refusal and its folder read are older than it.
    if (write.drops !== writes.drops) return { kind: "superseded" };
    const error = reply.error as NativeHostError;
    if (error.failure === "file_changed") {
      // Both sides changed. The record stays for a retry when the folder cannot be read.
      if (!folder) return { kind: "failed", reason: `${path} changed on disk, and the config folder could not be read again` };
      // A replay of that read puts the other file back at its old text in the copy, so the write runs again and reads the folder anew.
      if (!folder.current) return { kind: "superseded" };
      if (writes.replays_in_a_row < MAX_REPLAYS_IN_A_ROW && (await replay_edits_onto_folder(path, unsynced, folder))) {
        writes.replays_in_a_row += 1;
        return { kind: "superseded" };
      }
      writes.replays_in_a_row = 0;
      // Only the user can choose. The path goes once the folder is classified, and the other paths keep their writes.
      const asked = await ask_when_folder_differs(folder, { clear_when_settled: false });
      const end: FileWriteOutcome = { kind: asked === "asked" ? "conflict" : "conflict_kept" };
      let kept = without_unsynced_path(unsynced, path);
      // A theme delete waits behind this write. The folder's settings.toml still names that theme, so the delete goes to the question too, and the folder keeps building.
      if (path === SETTINGS_FILE) {
        const still_named = theme_named_in(folder.files[SETTINGS_FILE] ?? null);
        const { files } = await load_files_source();
        for (const other of Object.keys(kept ?? {})) {
          if (files[other] !== undefined || still_named === undefined || theme_name_of_file(other) !== still_named) continue;
          kept = without_unsynced_path(kept, other);
          writes_of(other).end = end;
        }
      }
      await store_unsynced(kept);
      return (writes.end = end);
    }
    if (error.failure === "host_outdated") return { kind: "waiting", host_outdated: true };
    if (error.failure === "no_permission" || error.failure === "host_missing") return { kind: "waiting" };
    return { kind: "failed", reason: error.message };
  }
  writes_landed += 1;
  const { files } = await load_files_source();
  const folder_now: UnsyncedFiles = { ...unsynced, [path]: write.text };
  // The folder now matches the copy wherever it matched before the edit, so a copy that held no other browser change still holds none, and the next start does not ask.
  if ((await files_digest(files_before_unsynced(files, unsynced))) === (await read_host_memory()).applied) await remember_applied(files_before_unsynced(files, folder_now));
  // A pick during the write is still ahead of the folder, and its write starts from this text.
  if ((files[path] ?? null) !== write.text) {
    await store_unsynced(folder_now);
    return { kind: "written" };
  }
  await store_unsynced(without_unsynced_path(unsynced, path));
  return (writes.end = { kind: "written" });
}

// After a refused write of settings.toml: swaps in the folder's files with the browser's edits set again on its new settings.toml, and moves the record to that text, so a hand edit saved during the write and the pick both stay.
// Only for a copy that held no other browser change: the folder's files then replace it without losing one. False leaves everything as it was.
// A whole file such as a theme has no keys to set again, so its refusal goes to the question.
async function replay_edits_onto_folder(path: string, unsynced: UnsyncedFiles, folder: ConfigFilesReply): Promise<boolean> {
  if (path !== SETTINGS_FILE) return false;
  // The swap below is a setting write, which skips the checks of a folder read, so the folder's files pass them here: a `,r` of this folder would refuse it too.
  if (!folder.config_dir_exists || !has_config_files(folder.files) || css_limit_breaches(folder.files).length > 0) return false;
  const current = await load_files_source();
  if ((await files_digest(files_before_unsynced(current.files, unsynced))) !== (await read_host_memory()).applied) return false;
  // The other files of the record keep the copy's text and their own write. The folder must still hold each at its base, or at the copy's text when that write landed before the read: anything else is a hand edit for the question.
  const others = Object.keys(unsynced).filter((other) => other !== path);
  if (others.some((other) => (folder.files[other] ?? null) !== unsynced[other] && folder.files[other] !== current.files[other])) return false;
  const folder_text = folder.files[path] ?? null;
  const text = replayed_on_folder(unsynced[path] as string | null, current.files[path] ?? "", folder_text);
  if (text === undefined) return false;
  // The folder's other files too, as a start would adopt them: an edit saved to keymap.toml beside settings.toml applies now, not at some later reload.
  const files: ConfigFiles = { ...folder.files, [path]: text };
  for (const other of others) {
    const copy_text = current.files[other];
    if (copy_text === undefined) delete files[other];
    else files[other] = copy_text;
  }
  const replayed: UnsyncedFiles = { ...unsynced, [path]: folder_text };
  try {
    await apply_files({ files, dir_label: folder.config_dir, imported: false }, "setting", { edits_after: await load_edits(), unsynced: replayed });
  } catch (error) {
    if (error instanceof ConfigRefusal) return false;
    throw error;
  }
  // The copy now matches the folder outside the edits again, as after a folder read.
  await remember_applied(files_before_unsynced(files, replayed));
  return true;
}

// Stores the copies-differ question the settings page shows for `folder`, as a start would. `ignored` when the folder needs no question, for example a folder the user chose to keep the copy over.
// `clear_when_settled` drops an older question that no longer applies. Runs in the change queue.
async function ask_when_folder_differs(folder: ConfigFilesReply, { clear_when_settled }: { clear_when_settled: boolean }): Promise<"asked" | "ignored"> {
  const plan = await classify_host_start(folder, (await load_files_source()).files, await read_host_memory());
  if (plan.kind === "ask") {
    await store_host_pending(plan.pending);
    return "asked";
  }
  if (clear_when_settled) await clear_host_pending();
  return "ignored";
}

// Rereads the files through the native host and applies them. They replace an import too.
// A setting still waiting for the folder is written first, so `,r` keeps it. When the host cannot write it, the folder wins as always.
export function reload_config(): Promise<{ config_dir: string; warnings: number }> {
  return in_change_queue(async () => {
    // `,r` holds the queue for its own host read, so it waits on a write that is out and writes in its turn.
    await write_waiting_files(already_in_queue);
    const reply = await native_host.read_config().catch((error: unknown) => {
      throw error instanceof NativeHostError ? new ConfigRefusal(`${KEPT_CURRENT.reload} ${error.message}`) : error;
    });
    // An empty build here would replace the user's config with the defaults, most likely because the host reads the wrong folder.
    if (!reply.config_dir_exists) throw new ConfigRefusal(missing_folder_message(reply.config_dir));
    if (!has_config_files(reply.files)) throw new ConfigRefusal(empty_folder_message(reply.config_dir));
    const { warnings } = await apply_host_files(reply.files, reply.config_dir);
    return { config_dir: reply.config_dir, warnings };
  });
}

// Runs once per start. Edits made to the files while the browser was closed reach the stored build here, without a `config.reload`.
// No permission, no host, a host error, or a missing or empty config folder keep the stored config and only warn on the console. Most users have no host, and the installer never creates the folder.
// A folder that differs replaces the browser copy only while the copy holds no browser change. Otherwise the start stores what it would change, and the user chooses on the settings page (`host_start.ts`).
// A broken file keeps the stored config too, and a toast names the problem so the user learns the edit failed.
// The host read runs outside the queue so it never blocks a `:set` while the host starts. A swap that commits during the read is newer than the reply, so the reply is dropped.
export async function reload_config_at_start(): Promise<void> {
  await move_imported_themes().catch(warn_and_go("move the imported themes into theme files"));
  await write_waiting_files(in_change_queue).catch(warn_and_go("write the waiting config files at start"));
  const swaps_before = swap_count;
  let reply;
  try {
    reply = await native_host.read_config();
  } catch (error) {
    console.warn(`Config not reread at start: ${error instanceof Error ? error.message : String(error)}`);
    // A choice needs the host, so a question left from an earlier start cannot be answered now.
    await in_change_queue(clear_host_pending).catch(warn_and_go("clear host pending"));
    return;
  }
  await in_change_queue(async () => {
    await get_config();
    if (swap_count !== swaps_before) return;
    const browser_files = (await load_files_source()).files;
    // A setting the host could not write yet (an older host) is the copy's only change while the folder still holds the base text: no question, the write comes later.
    const unsynced = await read_unsynced();
    const only_unwritten_edit_differs = unsynced !== undefined && same_files(compared_files(reply.files), compared_files(files_before_unsynced(browser_files, unsynced)));
    if (only_unwritten_edit_differs) return;
    const plan = await classify_host_start(reply, browser_files, await read_host_memory());
    if (plan.kind === "ask") {
      await store_host_pending(plan.pending);
      await toast_start(HOST_DIFFERS_MESSAGE, "warning");
      return;
    }
    if (plan.kind === "ignore") {
      if (plan.reason === "missing") console.warn(missing_folder_message(reply.config_dir));
      if (plan.reason === "empty") console.warn(empty_folder_message(reply.config_dir));
      if (plan.reason === "same") await remember_applied(reply.files);
      await clear_host_pending();
      return;
    }
    try {
      await apply_host_files(reply.files, reply.config_dir);
    } catch (error) {
      if (!(error instanceof ConfigRefusal)) throw error;
      await toast_start(error.message, "error");
    }
  }).catch((error: unknown) => console.warn(`Config not reread at start: ${error instanceof Error ? error.message : String(error)}`));
}

// Moves the imports an older version kept in browser storage into theme files, and a saved `theme` edit that names one into settings.toml. The waiting writes of the start send them to the folder, or a later start when the host is off.
// The stored list goes in the same queue turn, after the swap stored the files and the record together. A stop before that leaves the list, and the next start moves it again: a file that holds an import's text already counts as moved.
async function move_imported_themes(): Promise<void> {
  await in_change_queue(async () => {
    const stored = (await browser.storage.local.get(THEME_EDITS_STORAGE_KEY))[THEME_EDITS_STORAGE_KEY];
    if (stored === undefined) return;
    await get_config();
    const current = await load_files_source();
    const edits = await load_edits();
    const moved = imports_moved_to_files(stored, current.files, edits.saved);
    if (moved.paths.length > 0 || moved.saved !== edits.saved) await commit_folder_files(current, { files: moved.files, edits_after: { saved: moved.saved, temp: edits.temp }, paths: moved.paths });
    await browser.storage.local.remove(THEME_EDITS_STORAGE_KEY);
  });
}

const HOST_DIFFERS_MESSAGE = "The config folder differs from the config stored in the browser, which stays for now. Open the Settings page to choose.";

// Every swap to the folder's files goes through here, so the next start can tell an unedited browser copy from one with browser changes.
async function apply_host_files(files: ConfigFiles, config_dir: string): Promise<{ warnings: number }> {
  const applied = await apply_files({ files, dir_label: config_dir, imported: false }, "reload");
  await remember_applied(files);
  return applied;
}

// The answer to the settings page's question. In the change queue, so it never interleaves with a save, an import or a reload.
export function choose_host_start(choice: HostStartChoice["choice"], seen: { host_digest: string; browser_digest: string }): Promise<{ warnings: number }> {
  return in_change_queue(() =>
    settle_host_start(choice, seen, {
      read_host: () => native_host.read_config(),
      read_browser_files: async () => (await load_files_source()).files,
      apply_folder: apply_host_files,
    }),
  );
}

async function toast_start(message: string, kind: "error" | "warning"): Promise<void> {
  console.warn(message);
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  await show_toast_on_tab({ tab_id: tab?.id }, "config_start", message, kind);
}

const missing_folder_message = (config_dir: string) => `${KEPT_CURRENT.reload} The native host found no config folder at ${config_dir}. Create it, or set DESERTFOX_CONFIG_DIR for the host.`;
// The host creates the folder itself when it writes autoconfig.toml, so a folder holding only that file is as good as missing.
const empty_folder_message = (config_dir: string) => `${KEPT_CURRENT.reload} The native host found no config files in ${config_dir}. Put your config files there, or set DESERTFOX_CONFIG_DIR for the host.`;

// What an import would change, for the consent screen. It stores nothing and runs no snippet.
export async function preview_config_import(source: unknown): Promise<ConfigImportPreview> {
  const incoming = await read_import_source(source);
  await get_config();
  const built_in_commands = commands_of_registry(registry).filter((command) => !snippets.is_snippet(command.id));
  return preview_import(incoming, (await load_files_source()).files, built_in_commands);
}

// Applies an import over the slot's raw files: its config files replace the ones in force, and only the snippets in `accepted` join the installed ones.
// The slot is read inside the queue, so an import after a reload builds on the reloaded files.
export function import_config(source: unknown, accepted: unknown): Promise<{ warnings: number; replaces_config: boolean; snippets: number }> {
  const reading = read_import_source(source);
  // Settled here too, so a refused read is not an unhandled rejection while the queue waits.
  void keep_chain(reading);
  return in_change_queue(async () => {
    const incoming = await reading;
    const consented = checked_consent(incoming, accepted);
    if (imports_nothing(incoming, consented)) throw new ConfigRefusal(`${KEPT_CURRENT.import} The import holds no config files and no snippet was accepted.`);
    const current = await load_files_source();
    const { files, replaces_config } = plan_import_files(incoming, current.files, consented);
    const source = replaces_config ? { files, dir_label: IMPORT_DIR_LABEL, imported: true } : { ...current, files };
    const { warnings } = await apply_files(source, "import");
    return { warnings, replaces_config, snippets: Object.keys(consented).length };
  });
}

// Drops one installed snippet from the slot's raw files and rebuilds. A key in the files or a key edit that binds it refuses the removal, and the snippet stays.
export function remove_snippet(path: string): Promise<{ warnings: number }> {
  return in_change_queue(async () => {
    const current = await load_files_source();
    if (!path.startsWith("snippets/") || !Object.hasOwn(current.files, path)) throw new ConfigRefusal(`${KEPT_CURRENT.remove} No snippet ${path} is installed.`);
    const snippet_id = parse_snippet(path, current.files[path]!, [])?.id;
    if (snippet_id !== undefined) {
      const binding_edits = key_edits_running(snippet_id, { config: await get_config(), layers: await load_layers() }, registry);
      if (binding_edits.length > 0) throw new ConfigRefusal(`${KEPT_CURRENT.remove} The key edit ${binding_edits.join(", ")} runs ${snippet_id}. Reset or change it first.`);
    }
    const { [path]: _removed, ...files } = current.files;
    return apply_files({ ...current, files }, "remove");
  });
}

// Files the editor saved are named by their stored path, in the build and in the slot, so a message names the same file whatever the last action was.
const EDITOR_DIR_LABEL = "";

// Stores one file the user typed in the files editor, or deletes it with `text` null, and rebuilds. The user's own config: the import guards do not apply.
// It runs in the change queue, so saves and reloads apply one after another, each on the files the one before left. A build that fails writes nothing, so the stored files and the config stay as they were.
// A snippet is code with every permission, so it is stored only with `accepted` equal to its text. Otherwise the answer is the consent preview, and nothing is stored.
export function save_config_file(path: string, text: string | null, base: string | null, accepted?: string): Promise<{ warnings: number } | { consent: SnippetPreview }> {
  return in_change_queue(async () => {
    const current = await load_files_source();
    const problem = edit_problem(path, text, current.files);
    if (problem) throw new ConfigRefusal(`${KEPT_CURRENT.edit} ${problem}`);
    if ((current.files[path] ?? null) !== base) throw new ConfigRefusal(`${KEPT_CURRENT.edit} ${path} changed since you opened it (an import, a reload or another tab). Close it and open it again.`);
    if (text !== null && is_snippet_file(path) && accepted !== text) return { consent: preview_snippet(path, text, current.files, EDITOR_DIR_LABEL) };
    const { [path]: _replaced, ...others } = current.files;
    return apply_files({ files: text === null ? others : { ...others, [path]: text }, dir_label: EDITOR_DIR_LABEL, imported: current.imported }, "edit");
  });
}

async function tell_tabs_tree_changed(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? undefined : best_effort(browser.tabs.sendMessage(tab.id, { type: "tree_updated" })))),
  );
}

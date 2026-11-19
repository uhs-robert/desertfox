// Loads the config, compiles the keymap and publishes the result.

import { best_effort, keep_chain, warn_and_go } from "../shared/swallow.ts";
import type { MergedConfig, SettingEdits, Settings } from "../shared/config.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import { registry } from "../shared/registry/builtin.ts";
import { container_names, make_router_deps, show_toast_on_tab, snippet_deps } from "./browser_deps.ts";
import { compile_config } from "./compile.ts";
import type { CompileInput } from "./compile.ts";
import type { KeymapState } from "./keymap_message.ts";
import { alias_edits_of, engine_edits_of, has_build_edits, load_layers, store_layers } from "./edit_layers.ts";
import type { AliasEdits, EditLayers, EngineEdits, LayerKind, LayerOf, ThemeEdits } from "./edit_layers.ts";
import { build_layered, dropped_warning, fresh_drops, refusal_of } from "./engine_layer.ts";
import type { EngineState } from "./engine_message.ts";
import type { AliasState } from "./alias_message.ts";
import type { LayeredBuild } from "./engine_layer.ts";
import { build_config_status, load_config, load_edits, load_files_source, store_edits, with_edits } from "./config_load.ts";
import type { FilesSource, LoadedConfig } from "./config_load.ts";
import { DEFAULT_KEYMAP } from "./default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "./default_site_rows.ts";
import { DESKTOP_THEME } from "../shared/theme/roles.ts";
import { THEME_STORAGE_KEY, USER_CSS_STORAGE_KEY } from "../shared/theme/apply.ts";
import { CONFIG_STATUS_STORAGE_KEY, DESKTOP_THEME_STORAGE_KEY, DISABLED_STORAGE_KEY, LAYERED_CONFIG_STORAGE_KEY, SLOT_TABLE_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "./storage_keys.ts";
import { OFF_KEYMAP } from "./toolbar.ts";
import { apply_slot_plan, plan_slots, read_slot_map, release_slots, SLOT_COUNT, slot_table, store_slot_map } from "./slots.ts";
import type { SlotPlan } from "./slots.ts";
import { no_repeat_memory } from "./repeat_memory.ts";
import { create_snippets } from "./snippets.ts";
import { browser_native_deps, create_native_client, NativeHostError } from "./native_client.ts";
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
import { key_edits_running } from "./keymap_message.ts";
import { parse_snippet } from "../shared/config_build/snippet.ts";
import { commands_of_registry } from "../shared/config_build/build_config.ts";
import { drop_keymap } from "./keymap_source.ts";
import { FILES_CONFIG_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, HOST_START_PENDING_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY, TEMP_SETTINGS_STORAGE_KEY } from "./storage_keys.ts";
import { classify_host_start, clear_host_pending, compared_files, files_digest, has_config_files, read_host_memory, remember_applied, same_files, settle_host_start, store_host_pending } from "./host_start.ts";
import { clear_unsynced, read_unsynced, SETTINGS_FILE, store_unsynced, text_sha256, with_setting_in_files, without_setting } from "./settings_file.ts";
import type { FileWriteOutcome, UnsyncedSettingsFile } from "./settings_file.ts";
import type { TomlScalar } from "./toml_key_edit.ts";
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
  const edited = with_edits(layered?.loaded.config ?? step.loaded.config, edits);
  // An import wins over a theme file of the same name, as a browser edit wins over a file. The config the readers get holds both, so `:set theme` names either.
  const config: MergedConfig = in_force.themes === undefined ? edited : { ...edited, local_themes: { ...edited.local_themes, ...in_force.themes } };
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

// The imported themes, read in the change queue so a change still writing is not seen half done.
export function read_theme_edits(): Promise<ThemeEdits> {
  return in_change_queue(async () => (await load_layers()).themes ?? {});
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
// A setting write passes `setting`: the edits that replace the setting edits, and the record of the folder's base text (none when no file is written).
// They go into the same storage write as the files, so a stop between writes never leaves one without the other, and a failure restores them all.
async function apply_files(source: FilesSource, action: ApplyAction, setting?: { edits_after: SettingEdits; unsynced: UnsyncedSettingsFile | undefined }): Promise<{ warnings: number }> {
  const { files, dir_label } = source;
  await get_config();
  const current_step = await (load_step as Promise<LoadStep>);
  // The build checks snippet ids against the built-in commands, so the snippets of the last load stay out.
  const { stored, loaded } = build_files_config(files, dir_label, built_in_commands(), action);
  const edits = await load_edits();
  const swapped_keys = [FILES_CONFIG_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY, SAVED_SETTINGS_STORAGE_KEY, SETTINGS_FILE_UNSYNCED_STORAGE_KEY];
  const local_before = await browser.storage.local.get(swapped_keys);
  const unsynced_after = setting ? setting.unsynced : await unsynced_kept_by(action, files);
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
      [SETTINGS_FILE_UNSYNCED_STORAGE_KEY]: unsynced_after ?? null,
      ...(setting && { [SAVED_SETTINGS_STORAGE_KEY]: setting.edits_after.saved }),
    });
    // Temp edits live in session storage, which no `set` of local storage covers.
    if (setting) await browser.storage.session.set({ [TEMP_SETTINGS_STORAGE_KEY]: setting.edits_after.temp });
    // A setting write keeps the copies-differ question: its own write classifies the folder again.
    if (action !== "setting") await clear_host_pending();
    load_step = Promise.resolve(step);
    commit(published.config);
    swap_count += 1;
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

// The record of a setting the folder has not got survives an editor save or a snippet change that leaves settings.toml as it was: the setting is still the only change to that file.
// A reload or an import replaces the copy from elsewhere, and a save of settings.toml itself changes what the folder would get, so those drop it.
async function unsynced_kept_by(action: ApplyAction, files: ConfigFiles): Promise<UnsyncedSettingsFile | undefined> {
  if (action !== "edit" && action !== "remove") return undefined;
  const settings_unchanged = (await load_files_source()).files[SETTINGS_FILE] === files[SETTINGS_FILE];
  return settings_unchanged ? read_unsynced() : undefined;
}

function in_change_queue<T>(work: () => Promise<T>): Promise<T> {
  const queued = change_queue.then(work);
  change_queue = keep_chain(queued);
  return queued;
}

// Writes `value` into the browser copy of settings.toml, drops any saved or temp edit of `name` that would hide it, then asks the host to write the file.
// Only the edit runs in the change queue. The host write runs outside it, so a slow host never holds up a `:set`.
export async function set_in_settings_file(name: keyof Settings, value: TomlScalar): Promise<FileWriteOutcome> {
  const committed = await in_change_queue(async (): Promise<FileWriteOutcome | { question_was_pending: boolean }> => {
    if (name === "theme" && (await is_browser_only_theme(value))) {
      await save_in_browser(name, value);
      return { kind: "saved_in_browser" };
    }
    const current = await load_files_source();
    const files = with_setting_in_files(current.files, name, value);
    // An earlier edit the folder never got keeps its base: the folder still holds that text.
    const unsynced = (await came_from_folder(current)) ? ((await read_unsynced()) ?? { base: current.files[SETTINGS_FILE] ?? null }) : undefined;
    const edits = await load_edits();
    const edits_after = without_setting(edits, name);
    const question_was_pending = (await browser.storage.local.get(HOST_START_PENDING_STORAGE_KEY))[HOST_START_PENDING_STORAGE_KEY] !== undefined;
    await apply_files({ ...current, files }, "setting", { edits_after, unsynced });
    if (JSON.stringify(edits_after.saved) !== JSON.stringify(edits.saved)) void autoconfig.mirror(edits_after.saved, (await load_layers()).keymap);
    if (!unsynced) return { kind: "browser_copy" };
    return { question_was_pending };
  });
  if ("kind" in committed) return committed;
  // Nothing waiting means a write that was already out took this pick along.
  const outcome = (await write_waiting_settings_file(in_change_queue)) ?? { kind: "written" };
  // The question was made against the copy before the pick. The folder may still differ in other files, so it is asked again or settled.
  if (outcome.kind === "written" && committed.question_was_pending) {
    const folder = await read_folder_after_write();
    if (folder) await in_change_queue(() => ask_when_folder_differs(folder, { clear_when_settled: true }));
  }
  return outcome;
}

// The folder's text is the base only when the browser copy came from the folder: a copy from an import, or one that never read a folder, would seed the folder with a settings.toml of its own.
async function came_from_folder(source: FilesSource): Promise<boolean> {
  return !source.imported && (await read_host_memory()).applied !== undefined;
}

// An imported theme lives in browser storage only, so the files build refuses a settings.toml that names it. A theme file of the same name is known to the build, so that name still goes to the file.
async function is_browser_only_theme(value: TomlScalar): Promise<boolean> {
  if (typeof value !== "string") return false;
  const files_themes = (await (load_step as Promise<LoadStep>)).loaded.config.local_themes ?? {};
  return Object.hasOwn((await load_layers()).themes ?? {}, value) && !Object.hasOwn(files_themes, value);
}

// The saved edit, as before the file write existed: it lasts, and it drops a temp edit of the name that would hide it.
async function save_in_browser(name: keyof Settings, value: TomlScalar): Promise<void> {
  const before = await load_edits();
  const next = { saved: { ...before.saved, [name]: value }, temp: without_setting(before, name).temp };
  await commit_change(before, next, { store: store_edits, publish: async (edits) => publish(await (load_step as Promise<LoadStep>), edits) });
  void autoconfig.mirror(next.saved, (await load_layers()).keymap);
}

type HostWriteReply = { ok: true } | { ok: false; error: unknown };
// A settings.toml write sent to the host. The change queue starts it and settles its reply once, and the host call runs between the two, outside the queue.
type HostWrite = { base: string | null; text: string; reply: Promise<HostWriteReply>; outcome?: Promise<FileWriteOutcome> };
// The write out now. One at a time: a second write against the same base would find the first one's text and be refused.
let host_write: HostWrite | undefined;

// Runs `start` and `settle` in the change queue, or inline for a caller already in it.
type QueueRunner = <T>(work: () => Promise<T>) => Promise<T>;
const already_in_queue: QueueRunner = (work) => work();

// Writes the browser copy of settings.toml to the folder while the folder lags it, and again for a pick made during a write. Undefined when nothing waited.
async function write_waiting_settings_file(in_queue: QueueRunner): Promise<FileWriteOutcome | undefined> {
  let outcome: FileWriteOutcome | undefined;
  for (;;) {
    const started = await in_queue(start_host_write);
    if (started === undefined || "kind" in started) return started ?? outcome;
    const reply = await started.reply;
    const folder = changed_on_disk(reply) ? await read_folder_after_write() : undefined;
    outcome = await in_queue(() => settle_host_write(started, reply, folder));
    if (outcome.kind !== "written") return outcome;
  }
}

// In the change queue. Sends the browser copy of settings.toml when the folder lags it, or hands back the write already out.
async function start_host_write(): Promise<HostWrite | FileWriteOutcome | undefined> {
  if (host_write) return host_write;
  const unsynced = await read_unsynced();
  if (!unsynced) return undefined;
  const text = (await load_files_source()).files[SETTINGS_FILE];
  if (text === undefined) {
    await clear_unsynced();
    return { kind: "browser_copy" };
  }
  const base_sha256 = unsynced.base === null ? null : await text_sha256(unsynced.base);
  const reply = native_host.write_settings(text, base_sha256).then((): HostWriteReply => ({ ok: true }), (error: unknown): HostWriteReply => ({ ok: false, error }));
  host_write = { base: unsynced.base, text, reply };
  return host_write;
}

const changed_on_disk = (reply: HostWriteReply) => !reply.ok && reply.error instanceof NativeHostError && reply.error.failure === "file_changed";

const read_folder_after_write = () => native_host.read_config().catch(warn_and_go("read the folder after a settings.toml write"));

// In the change queue. Applies the host's reply to the record once, however many callers waited on the write. `folder` is the folder read after a refusal, undefined when it could not be read.
function settle_host_write(write: HostWrite, reply: HostWriteReply, folder: ConfigFilesReply | undefined): Promise<FileWriteOutcome> {
  if (host_write === write) host_write = undefined;
  write.outcome ??= outcome_of_host_write(write, reply, folder);
  return write.outcome;
}

async function outcome_of_host_write(write: HostWrite, reply: HostWriteReply, folder: ConfigFilesReply | undefined): Promise<FileWriteOutcome> {
  if (!reply.ok) {
    const { error } = reply;
    if (!(error instanceof NativeHostError)) throw error;
    if (error.failure === "file_changed") {
      // Both sides changed, so only the user can choose. The record goes once the folder is classified, and stays for a retry when the folder cannot be read.
      if (!folder) return { kind: "failed", reason: `${SETTINGS_FILE} changed on disk, and the config folder could not be read again` };
      const asked = await ask_when_folder_differs(folder, { clear_when_settled: false });
      await clear_unsynced();
      return { kind: asked === "asked" ? "conflict" : "conflict_kept" };
    }
    if (error.failure === "no_permission" || error.failure === "host_missing" || error.failure === "host_outdated") return { kind: "waiting" };
    return { kind: "failed", reason: error.message };
  }
  const unsynced = await read_unsynced();
  // A swap replaced the browser copy during the write and dropped the record: the folder holds this text, and the copy is the swap's.
  if (unsynced?.base !== write.base) return { kind: "written" };
  const { files } = await load_files_source();
  const folder_now: UnsyncedSettingsFile = { base: write.text };
  // The folder now matches the copy wherever it matched before the edit, so a copy that held no other browser change still holds none, and the next start does not ask.
  if ((await files_digest(before_unsynced_edit(files, unsynced))) === (await read_host_memory()).applied) await remember_applied(before_unsynced_edit(files, folder_now));
  // A pick during the write is still ahead of the folder, and its write starts from this text.
  if (files[SETTINGS_FILE] === write.text) await clear_unsynced();
  else await store_unsynced(folder_now);
  return { kind: "written" };
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
    await write_waiting_settings_file(already_in_queue);
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
  await write_waiting_settings_file(in_change_queue).catch(warn_and_go("write the waiting settings.toml at start"));
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
    const only_unwritten_edit_differs = unsynced !== undefined && same_files(compared_files(reply.files), compared_files(before_unsynced_edit(browser_files, unsynced)));
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

// The browser copy as it was before the edit the folder never got: settings.toml back at its base text.
function before_unsynced_edit(files: ConfigFiles, unsynced: UnsyncedSettingsFile): ConfigFiles {
  const { [SETTINGS_FILE]: _edited, ...others } = files;
  return unsynced.base === null ? others : { ...others, [SETTINGS_FILE]: unsynced.base };
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

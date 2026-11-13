// Loads the config, compiles the keymap and publishes the result.

import { best_effort, keep_chain, warn_and_go } from "../shared/swallow.ts";
import type { MergedConfig, SettingEdits } from "../shared/config.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import { registry } from "../shared/registry/builtin.ts";
import { container_names, make_router_deps, show_toast_on_tab, snippet_deps } from "./browser_deps.ts";
import { compile_config } from "./compile.ts";
import type { CompileInput } from "./compile.ts";
import type { KeymapState } from "./keymap_message.ts";
import { engine_edits_of, has_engine_edits, load_layers, store_layers } from "./edit_layers.ts";
import type { EditLayers, EngineEdits, LayerKind, LayerOf } from "./edit_layers.ts";
import { build_layered, dropped_warning, fresh_drops, refusal_of } from "./engine_layer.ts";
import type { EngineState } from "./engine_message.ts";
import type { LayeredBuild } from "./engine_layer.ts";
import { build_config_status, load_config, load_edits, load_files_source, store_edits, with_edits } from "./config_load.ts";
import type { FilesSource, LoadedConfig } from "./config_load.ts";
import { DEFAULT_KEYMAP } from "./default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "./default_site_rows.ts";
import { DESKTOP_PALETTE } from "../shared/theme/roles.ts";
import { THEME_STORAGE_KEY, USER_CSS_STORAGE_KEY } from "../shared/theme/apply.ts";
import { CONFIG_STATUS_STORAGE_KEY, DESKTOP_PALETTE_STORAGE_KEY, DISABLED_STORAGE_KEY, LAYERED_CONFIG_STORAGE_KEY, SLOT_TABLE_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "./storage_keys.ts";
import { OFF_KEYMAP } from "./toolbar.ts";
import { apply_slot_plan, plan_slots, read_slot_map, release_slots, SLOT_COUNT, slot_table, store_slot_map } from "./slots.ts";
import type { SlotPlan } from "./slots.ts";
import { no_repeat_memory } from "./repeat_memory.ts";
import { create_snippets } from "./snippets.ts";
import { browser_native_deps, create_native_client, NativeHostError } from "./native_client.ts";
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
import { FILES_CONFIG_STORAGE_KEY, FILES_SOURCE_STORAGE_KEY } from "./storage_keys.ts";
import { classify_host_start, clear_host_pending, has_config_files, read_host_memory, remember_applied, settle_host_start, store_host_pending } from "./host_start.ts";
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
  // The files the load built, when the load knows them. Otherwise the engines layer reads them from storage the first time it builds.
  source?: FilesSource;
  // The last build of the engines layer over the files, so a `:set` publish does not build again. Keyed by the layer.
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
    desktop_palette: await pushed_palette(),
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
  const engines = engine_edits_of(in_force);
  const layered = has_engine_edits(engines) ? await layered_build(step, engines) : undefined;
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

async function layered_build(step: LoadStep, engines: EngineEdits): Promise<LayeredBuild> {
  const key = JSON.stringify(engines);
  if (step.layered?.key === key) return step.layered.build;
  step.source ??= await load_files_source();
  const build = build_layered(step.source.files, step.source.dir_label, built_in_commands(), engines);
  step.layered = { key, build };
  return build;
}

async function pushed_palette(): Promise<string | undefined> {
  const pushed = (await browser.storage.local.get(DESKTOP_PALETTE_STORAGE_KEY))[DESKTOP_PALETTE_STORAGE_KEY];
  return typeof pushed === "string" ? pushed : undefined;
}

// The bridge stores the palette the desktop pushed. It republishes only while `palette` follows the desktop, so a push never moves a theme the user chose by name. A repeat of the stored name still republishes, so a retry after a failed publish applies it.
export function set_desktop_palette(name: string): Promise<void> {
  return in_change_queue(async () => {
    await browser.storage.local.set({ [DESKTOP_PALETTE_STORAGE_KEY]: name });
    const config = await get_config();
    if (config.settings.palette === DESKTOP_PALETTE) await publish(await (load_step as Promise<LoadStep>), await load_edits());
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
    // An engines edit is refused for what it breaks, before anything is stored. An engine the files already broke stays out of the way, so it can still be removed.
    if (kind === "engines" && has_engine_edits(engine_edits_of(next))) {
      const known = has_engine_edits(engine_edits_of(before)) ? (await layered_build(step, engine_edits_of(before))).dropped : [];
      const fresh = fresh_drops(await layered_build(step, engine_edits_of(next)), known);
      if (fresh.length > 0) throw refusal_of(fresh);
    }
    const slot_map_before = await read_slot_map();
    // A publish keeps the slot plan of the load, so a change of the browser chords drops it, both ways: the rollback must put the old chords back too.
    const moves_chords = JSON.stringify(before.keymap.browser ?? {}) !== JSON.stringify(next.keymap.browser ?? {});
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

export function read_engine_state(): Promise<EngineState> {
  return in_change_queue(async () => {
    const config = await get_config();
    const engines = engine_edits_of(await load_layers());
    const step = await (load_step as Promise<LoadStep>);
    const current = has_engine_edits(engines) ? await layered_build(step, engines) : undefined;
    step.source ??= await load_files_source();
    const { files, dir_label } = step.source;
    return { config, engines, kept: current?.kept ?? {}, dropped: current?.dropped ?? [], trial: (other) => build_layered(files, dir_label, built_in_commands(), other) };
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
async function apply_files(files: ConfigFiles, dir_label: string, action: ApplyAction): Promise<{ warnings: number }> {
  await get_config();
  const current_step = await (load_step as Promise<LoadStep>);
  // The build checks snippet ids against the built-in commands, so the snippets of the last load stay out.
  const { stored, loaded } = build_files_config(files, dir_label, built_in_commands(), action);
  const edits = await load_edits();
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
    const step: LoadStep = { loaded, load_warnings: [...loaded.warnings, ...snippet_warnings], source: { files, dir_label } };
    const published = await publish(step, edits);
    // One `set`, so the config and the files it was built from never part.
    await browser.storage.local.set({ [FILES_CONFIG_STORAGE_KEY]: stored, [FILES_SOURCE_STORAGE_KEY]: { files, dir_label } satisfies FilesSource });
    await clear_host_pending();
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
    await publish({ loaded: current_step.loaded, load_warnings: current_step.load_warnings }, edits).catch(warn_and_go("rollback publish"));
    commit(config_before);
    throw error;
  }
}

function in_change_queue<T>(work: () => Promise<T>): Promise<T> {
  const queued = change_queue.then(work);
  change_queue = keep_chain(queued);
  return queued;
}

// Rereads the files through the native host and applies them. They replace an import too.
export function reload_config(): Promise<{ config_dir: string; warnings: number }> {
  return in_change_queue(async () => {
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
    const plan = await classify_host_start(reply, (await load_files_source()).files, await read_host_memory());
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

const HOST_DIFFERS_MESSAGE = "The config folder differs from the config stored in the browser, which stays for now. Open the Settings page to choose.";

// Every swap to the folder's files goes through here, so the next start can tell an unedited browser copy from one with browser changes.
async function apply_host_files(files: ConfigFiles, config_dir: string): Promise<{ warnings: number }> {
  const applied = await apply_files(files, config_dir, "reload");
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
    const { warnings } = await apply_files(files, replaces_config ? IMPORT_DIR_LABEL : current.dir_label, "import");
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
    return apply_files(files, current.dir_label, "remove");
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
    return apply_files(text === null ? others : { ...others, [path]: text }, EDITOR_DIR_LABEL, "edit");
  });
}

async function tell_tabs_tree_changed(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? undefined : best_effort(browser.tabs.sendMessage(tab.id, { type: "tree_updated" })))),
  );
}

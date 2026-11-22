// The config in force: loads it, compiles the keymap and publishes the result, and holds the one queue that every change runs through.

import { best_effort, keep_chain, warn_and_go } from "../shared/swallow.ts";
import type { MergedConfig, SettingEdits } from "../shared/config.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import { registry } from "../shared/registry/builtin.ts";
import { container_names } from "./browser_deps.ts";
import { compile_config } from "./compile.ts";
import type { CompileInput } from "./compile.ts";
import type { KeymapState } from "./keymap_message.ts";
import { alias_edits_of, engine_edits_of, has_build_edits, load_layers, store_layers } from "./edit_layers.ts";
import type { AliasEdits, EditLayers, EngineEdits, LayerKind, LayerOf } from "./edit_layers.ts";
import { build_layered, dropped_warning, fresh_drops, refusal_of } from "./engine_layer.ts";
import type { EngineState } from "./engine_message.ts";
import type { AliasState } from "./alias_message.ts";
import type { LayeredBuild } from "./engine_layer.ts";
import { build_config_status, load_config, load_edits, load_effective_config, load_files_source, store_edits, with_edits } from "../shared/config/config_load.ts";
import type { FilesSource, LoadedConfig } from "../shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../shared/keys/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "./default_site_rows.ts";
import { DESKTOP_THEME } from "../shared/theme/roles.ts";
import { THEME_STORAGE_KEY, USER_CSS_STORAGE_KEY } from "../shared/theme/apply.ts";
import { CONFIG_STATUS_STORAGE_KEY, DESKTOP_THEME_STORAGE_KEY, DISABLED_STORAGE_KEY, LAYERED_CONFIG_STORAGE_KEY, SLOT_TABLE_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import { OFF_KEYMAP } from "./toolbar.ts";
import { apply_slot_plan, plan_slots, read_slot_map, release_slots, SLOT_COUNT, slot_table, store_slot_map } from "./slots.ts";
import type { SlotPlan } from "./slots.ts";
import type { ConfigFiles } from "../shared/config_build/source_files.ts";
import { commands_of_registry } from "../shared/config_build/build_config.ts";
import { drop_keymap } from "./keymap_source.ts";
import { SAVED_FOLD_NOTES_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import { create_services } from "./services.ts";
import type { Services } from "./services.ts";

declare const browser: MessagingBrowser;

// Everything a load (the first one, or a `config.reload`) works out and `publish` reuses. Browser edits are not part of it: they change while this stays.
export type LoadStep = {
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

// The config in force and the one change queue. Every publish, `:set` and swap runs through the queue this holds.
export function create_config_store(deps: Pick<Services, "snippets" | "autoconfig">) {
  const { snippets, autoconfig } = deps;
  // A change to the saved layer rewrites the file with the key edits, so the first one after an update clears the settings an older version mirrored there.
  async function mirror_key_edits(): Promise<void> {
    void autoconfig.mirror((await load_layers()).keymap);
  }

  // Derived from storage on every start, so a restart loses nothing.
  let load_step: Promise<LoadStep> | undefined;
  // Replaced after each publish, so a reader never sees the config from before a `:set`.
  let current_config: Promise<MergedConfig> | undefined;

  function get_config(): Promise<MergedConfig> {
    return (current_config ??= start());
  }

  async function get_search_engine_names(): Promise<string[]> {
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
    const all_warnings = [...step.load_warnings, ...layer_warnings, ...warnings, ...step.slots.warnings, ...(await read_fold_notes())];
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
  function set_desktop_theme(name: string): Promise<void> {
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
  function change_edits(decide: (current: SettingEdits, config: MergedConfig) => SettingEdits | undefined): Promise<void> {
    return in_change_queue(async () => {
      const config = await get_config();
      const before = await load_edits();
      const next = decide(before, config);
      if (next === undefined) return;
      await commit_change(before, next, { store: store_edits, publish: async (edits) => publish(await (load_step as Promise<LoadStep>), edits) });
      if (JSON.stringify(next.saved) !== JSON.stringify(before.saved)) await mirror_key_edits();
    });
  }

  // What the Firefox shortcut slots follow: the browser chords, and the engines a `search` binding can name.
  const chord_state = (layers: EditLayers): string => JSON.stringify([layers.keymap.browser ?? {}, layers.engines ?? {}]);

  // `change_edits` for one edit layer, in the same queue, so a key edit and a `:set` never publish over each other.
  // `decide` gets the key editor's state of this turn, so its slot check sees every change that landed before it.
  function change_layers<K extends LayerKind>(kind: K, decide: (current: LayerOf<K>, state: KeymapState) => LayerOf<K> | undefined): Promise<void> {
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
      if (JSON.stringify(next.keymap) !== JSON.stringify(before.keymap)) void autoconfig.mirror(next.keymap);
    });
  }

  // The config in force, the stored layers, the slot map and a compile of that config under any layers.
  async function keymap_state(config: MergedConfig, layers: EditLayers): Promise<KeymapState> {
    const input = await compile_input(config, layers);
    return { config, layers, slot_map: await read_slot_map(), compile: (other) => compile_config({ ...input, keymap_edits: other.keymap }) };
  }

  // What the settings page reads, in the change queue so a change still storing or rolling back is not seen half done.
  function read_settings_layers(): ReturnType<typeof load_effective_config> {
    return in_change_queue(() => load_effective_config());
  }

  // What the key editor reads, in the change queue so a change still writing or rolling back is not seen half done.
  function read_keymap_state(): Promise<KeymapState> {
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

  function read_engine_state(): Promise<EngineState> {
    return in_change_queue(async () => {
      const { config, layers, current, source } = await read_layer_build();
      return { config, files: source.files, engines: engine_edits_of(layers), aliases: alias_edits_of(layers), kept: current?.kept ?? {}, kept_aliases: current?.kept_aliases ?? {}, dropped: current?.dropped ?? [] };
    });
  }

  // The browser copy of the config files, read in the change queue so a change still writing is not seen half done.
  function read_stored_files(): Promise<ConfigFiles> {
    return in_change_queue(async () => (await load_files_source()).files);
  }

  function read_alias_state(): Promise<AliasState> {
    return in_change_queue(async () => {
      const { config, layers, current } = await read_layer_build();
      return { config, aliases: alias_edits_of(layers), kept: current?.kept_aliases ?? {}, dropped: current?.dropped ?? [] };
    });
  }

  // Publishes again under the current edits, for a change that is not an edit: the toolbar switch. It runs in the change queue like the edits.
  function republish(): Promise<void> {
    const again = change_queue.then(async () => {
      await get_config();
      await publish(await (load_step as Promise<LoadStep>), await load_edits());
    });
    change_queue = keep_chain(again);
    return again;
  }

  function in_change_queue<T>(work: () => Promise<T>): Promise<T> {
    const queued = change_queue.then(work);
    change_queue = keep_chain(queued);
    return queued;
  }

  async function read_fold_notes(): Promise<string[]> {
    const stored: unknown = (await browser.storage.session.get(SAVED_FOLD_NOTES_STORAGE_KEY))[SAVED_FOLD_NOTES_STORAGE_KEY];
    return Array.isArray(stored) ? stored.filter((note): note is string => typeof note === "string") : [];
  }

  async function tell_tabs_tree_changed(): Promise<void> {
    const tabs = await browser.tabs.query({});
    await Promise.all(
      tabs.map((tab) => (tab.id === undefined ? undefined : best_effort(browser.tabs.sendMessage(tab.id, { type: "tree_updated" })))),
    );
  }

  return {
    get_config,
    get_search_engine_names,
    publish,
    layered_build,
    built_in_commands,
    in_change_queue,
    commit_change,
    change_edits,
    change_layers,
    read_settings_layers,
    read_keymap_state,
    read_engine_state,
    read_stored_files,
    read_alias_state,
    republish,
    set_desktop_theme,
    mirror_key_edits,
    read_fold_notes,
    read_load_step: () => load_step as Promise<LoadStep>,
    set_load_step: (next: Promise<LoadStep>) => {
      load_step = next;
    },
    read_current_config: () => current_config,
    set_current_config: (next: Promise<MergedConfig>) => {
      current_config = next;
    },
    count_swap: () => {
      swap_count += 1;
    },
    read_swap_count: () => swap_count,
  };
}

export type ConfigStore = ReturnType<typeof create_config_store>;

// The production instances. The services need `get_config` and the store needs the services, so the reader is passed late.
export const services = create_services({ get_config: () => config_store.get_config() });
export const config_store = create_config_store(services);
export const { snippets, host_update, native_host } = services;
export const { get_config, get_search_engine_names, change_edits, change_layers, read_settings_layers, read_keymap_state, read_engine_state, read_stored_files, read_alias_state, republish, set_desktop_theme } = config_store;

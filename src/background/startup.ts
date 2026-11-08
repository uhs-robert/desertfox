// Loads the config, compiles the keymap and publishes the result.

import type { MergedConfig, SettingEdits } from "../shared/config.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import { registry } from "../shared/registry/builtin.ts";
import { container_names, make_router_deps, snippet_deps } from "./browser_deps.ts";
import { compile_config } from "./compile.ts";
import { build_config_status, load_config, load_edits, store_edits, with_edits } from "./config_load.ts";
import type { LoadedConfig } from "./config_load.ts";
import { DEFAULT_KEYMAP } from "./default_keymap.ts";
import { THEME_STORAGE_KEY, USER_CSS_STORAGE_KEY } from "../shared/theme/apply.ts";
import { CONFIG_STATUS_STORAGE_KEY, DISABLED_STORAGE_KEY, SLOT_TABLE_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "./storage_keys.ts";
import { OFF_KEYMAP } from "./toolbar.ts";
import { apply_slot_plan, plan_slots, slot_table } from "./slots.ts";
import { no_repeat_memory } from "./repeat_memory.ts";
import { create_snippets } from "./snippets.ts";
import { browser_native_deps, create_native_client, NativeHostError } from "./native_client.ts";
import { build_files_config, ConfigReloadError, KEPT_CURRENT } from "./config_reload.ts";
import { create_autoconfig_mirror } from "./autoconfig_mirror.ts";
import { commands_of_registry } from "../shared/config_build/build_config.ts";
import { FILES_CONFIG_STORAGE_KEY } from "./storage_keys.ts";

export const snippets = create_snippets(registry, snippet_deps, make_router_deps(get_config, no_repeat_memory));
const native_host = create_native_client(browser_native_deps());
const autoconfig = create_autoconfig_mirror({ write_autoconfig: native_host.write_autoconfig, warn: console.warn });

// Everything a load (the first one, or a `config.reload`) works out and `publish` reuses. Browser edits are not part of it: they change while this stays.
type LoadStep = {
  loaded: LoadedConfig;
  // Warnings of the load itself. A publish adds the compile warnings to them.
  load_warnings: string[];
  // Found on the first publish of a load. A `:set` keeps it: it refuses the prefix settings, the only ones that move keys.
  slots?: { table: ReturnType<typeof slot_table>; warnings: string[] };
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

// Compiles the loaded config under the browser edits, stores the result and tells the tabs.
// `warnings` is the whole list the help page shows: load, compile and shortcut slots.
async function publish(step: LoadStep, edits: SettingEdits): Promise<{ config: MergedConfig; warnings: string[] }> {
  const config = with_edits(step.loaded.config, edits);
  const { compiled, theme, warnings } = compile_config({
    config,
    default_keymap: DEFAULT_KEYMAP,
    get_command: (command_id) => registry.get(command_id),
    enum_sources: { search_engines: Object.keys(config.search_engines), containers: await container_names() },
  });

  if (!step.slots) {
    const plan = plan_slots(compiled.modes.browser);
    const applied = await apply_slot_plan(plan, browser.commands);
    step.slots = { table: slot_table({ ...plan, assignments: applied.applied }), warnings: [...plan.warnings, ...applied.warnings] };
  }
  const all_warnings = [...step.load_warnings, ...warnings, ...step.slots.warnings];
  for (const warning of all_warnings) console.warn(`desertfox: ${warning}`);

  // Read at every publish, so a restart with the switch off, a `:set` and a reload all store the empty keymap.
  const disabled = (await browser.storage.local.get(DISABLED_STORAGE_KEY))[DISABLED_STORAGE_KEY] === true;
  await browser.storage.local.set({
    [COMPILED_KEYMAP_STORAGE_KEY]: disabled ? OFF_KEYMAP : compiled,
    [WARNINGS_STORAGE_KEY]: all_warnings,
    [CONFIG_STATUS_STORAGE_KEY]: build_config_status(step.loaded.source, step.loaded.config.settings, edits, `~/.mozilla/managed-storage/${browser.runtime.id}.json`),
    [SLOT_TABLE_STORAGE_KEY]: step.slots.table,
    [THEME_STORAGE_KEY]: theme,
    [USER_CSS_STORAGE_KEY]: config.css,
  });
  await tell_tabs_tree_changed();
  return { config, warnings: all_warnings };
}

// `:set` and `:unset` change the edits one at a time, so two of them in a row never read the same stored value.
let change_queue: Promise<unknown> = Promise.resolve();

// `decide` gets the edits now in force and the config under them. It returns the edits to keep, or nothing to change nothing.
export function change_edits(decide: (current: SettingEdits, config: MergedConfig) => SettingEdits | undefined): Promise<void> {
  const change = change_queue.then(async () => {
    const config = await get_config();
    const before = await load_edits();
    const next = decide(before, config);
    if (next === undefined) return;
    try {
      // Inside the try: the saved and temp layers are two writes, and one can land while the other fails.
      await store_edits(next);
      // Assigned after the publish succeeds, so a failed one leaves the readers the last good config.
      const { config: published } = await publish(await (load_step as Promise<LoadStep>), next);
      current_config = Promise.resolve(published);
      const saved_changed = JSON.stringify(next.saved) !== JSON.stringify(before.saved);
      if (saved_changed) void autoconfig.mirror(next.saved);
    } catch (error) {
      // Pages read the stored edits themselves, so a failed publish must not leave them ahead of the config.
      // Best effort, so a failed rollback never hides the error that caused it.
      await store_edits(before).catch(() => undefined);
      // Best effort: the failed publish may have written the keymap and status for `next` already.
      await publish(await (load_step as Promise<LoadStep>), before).catch(() => undefined);
      throw error;
    }
  });
  change_queue = change.catch(() => undefined);
  return change;
}

// Publishes again under the current edits, for a change that is not an edit: the toolbar switch. It runs in the change queue like the edits.
export function republish(): Promise<void> {
  const again = change_queue.then(async () => {
    await get_config();
    await publish(await (load_step as Promise<LoadStep>), await load_edits());
  });
  change_queue = again.catch(() => undefined);
  return again;
}

// Rereads the files through the native host and swaps the config in place. Nothing restarts, so the edits and the modes stay.
// It runs in the change queue, so a reload and a `:set` never publish over each other.
export function reload_config(): Promise<{ config_dir: string; warnings: number }> {
  const reload = change_queue.then(async () => {
    await get_config();
    const current_step = await (load_step as Promise<LoadStep>);
    const reply = await native_host.read_config().catch((error: unknown) => {
      throw error instanceof NativeHostError ? new ConfigReloadError(`${KEPT_CURRENT} ${error.message}`) : error;
    });
    // The build checks snippet ids against the built-in commands, so the snippets of the last load stay out.
    const built_in_commands = commands_of_registry(registry).filter((command) => !snippets.is_snippet(command.id));
    const { stored, loaded } = build_files_config(reply, built_in_commands);
    const edits = await load_edits();
    // From here the registry holds the new snippets while the tabs still run the old keymap.
    // Readers wait on `get_config` until the swap commits, so no command runs against half of it.
    const config_before = current_config as Promise<MergedConfig>;
    let commit!: (config: MergedConfig | Promise<MergedConfig>) => void;
    current_config = new Promise<MergedConfig>((resolve) => (commit = resolve));
    try {
      // Before the publish, so a key bound to a snippet resolves.
      const snippet_warnings = snippets.register(loaded.config.snippets);
      // No slots: the new keymap can move the browser chords, so the publish plans them again.
      const step: LoadStep = { loaded, load_warnings: [...loaded.warnings, ...snippet_warnings] };
      const published = await publish(step, edits);
      await browser.storage.local.set({ [FILES_CONFIG_STORAGE_KEY]: stored });
      load_step = Promise.resolve(step);
      commit(published.config);
      return { config_dir: reply.config_dir, warnings: published.warnings.length };
    } catch (error) {
      // The failed publish may have written the new keymap and status already.
      // Each step is best effort, so a failed rollback never hides the error that caused it.
      try {
        snippets.register(current_step.loaded.config.snippets);
      } catch {
        // The publish below still puts the old keymap back.
      }
      await publish({ loaded: current_step.loaded, load_warnings: current_step.load_warnings }, edits).catch(() => undefined);
      commit(config_before);
      throw error;
    }
  });
  change_queue = reload.catch(() => undefined);
  return reload;
}

async function tell_tabs_tree_changed(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? undefined : browser.tabs.sendMessage(tab.id, { type: "tree_updated" }).catch(() => undefined))),
  );
}

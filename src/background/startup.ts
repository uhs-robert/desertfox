// Loads the config, compiles the keymap and publishes the result.

import type { MergedConfig, SettingOverrides } from "../shared/config.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import { registry } from "../shared/registry/index.ts";
import { container_names, make_router_deps, snippet_deps } from "./browser_deps.ts";
import { compile_config } from "./compile.ts";
import { build_config_status, load_config, load_overrides, with_overrides } from "./config_load.ts";
import type { LoadedConfig } from "./config_load.ts";
import { DEFAULT_KEYMAP } from "./default_keymap.ts";
import { CONFIG_STATUS_STORAGE_KEY, SETTING_OVERRIDES_STORAGE_KEY, SLOT_TABLE_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "./storage_keys.ts";
import { apply_slot_plan, plan_slots, slot_table } from "./slots.ts";
import { no_repeat_memory } from "./repeat_memory.ts";
import { create_snippets } from "./snippets.ts";

export const snippets = create_snippets(registry, snippet_deps, make_router_deps(get_config, no_repeat_memory));

// Everything the first load works out and `publish` reuses. Overrides are not part of it: they change while this stays.
type LoadStep = {
  loaded: LoadedConfig;
  // Warnings of the load itself. A publish adds the compile warnings to them.
  load_warnings: string[];
  // Found on the first publish. The slot plan cannot change later: `:set` refuses the prefix settings, the only ones that move keys.
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
  return publish(step, await load_overrides());
}

// Compiles the loaded config under the overrides, stores the result and tells the tabs.
async function publish(step: LoadStep, overrides: SettingOverrides): Promise<MergedConfig> {
  const config = with_overrides(step.loaded.config, overrides);
  const { compiled, warnings } = compile_config({
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
  for (const warning of all_warnings) console.warn(`oasisfox: ${warning}`);

  await browser.storage.local.set({
    [COMPILED_KEYMAP_STORAGE_KEY]: compiled,
    [WARNINGS_STORAGE_KEY]: all_warnings,
    [CONFIG_STATUS_STORAGE_KEY]: build_config_status(step.loaded.source, step.loaded.config.settings, overrides, `~/.mozilla/managed-storage/${browser.runtime.id}.json`),
    [SLOT_TABLE_STORAGE_KEY]: step.slots.table,
  });
  await tell_tabs_tree_changed();
  return config;
}

// `:set` and `:unset` change overrides one at a time, so two of them in a row never read the same stored value.
let change_queue: Promise<unknown> = Promise.resolve();

// `decide` gets the overrides now in force and the config under them. It returns the overrides to keep, or nothing to change nothing.
export function change_overrides(decide: (current: SettingOverrides, config: MergedConfig) => SettingOverrides | undefined): Promise<void> {
  const change = change_queue.then(async () => {
    const config = await get_config();
    const before = await load_overrides();
    const next = decide(before, config);
    if (next === undefined) return;
    await browser.storage.session.set({ [SETTING_OVERRIDES_STORAGE_KEY]: next });
    try {
      // Assigned after the publish succeeds, so a failed one leaves the readers the last good config.
      const published = await publish(await (load_step as Promise<LoadStep>), next);
      current_config = Promise.resolve(published);
    } catch (error) {
      // Pages read the stored overrides themselves, so a failed publish must not leave them ahead of the config.
      await browser.storage.session.set({ [SETTING_OVERRIDES_STORAGE_KEY]: before });
      throw error;
    }
  });
  change_queue = change.catch(() => undefined);
  return change;
}

async function tell_tabs_tree_changed(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? undefined : browser.tabs.sendMessage(tab.id, { type: "tree_updated" }).catch(() => undefined))),
  );
}

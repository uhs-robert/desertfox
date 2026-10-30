// Loads the config, compiles the keymap and publishes the result.

import type { MergedConfig } from "../shared/config.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import { registry } from "../shared/registry/index.ts";
import { container_names } from "./browser_deps.ts";
import { compile_config } from "./compile.ts";
import { load_config } from "./config_load.ts";
import { DEFAULT_KEYMAP } from "./default_keymap.ts";
import { SLOT_TABLE_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "./storage_keys.ts";
import { apply_slot_plan, plan_slots, slot_table } from "./slots.ts";

// Derived from storage on every start, so a restart loses nothing.
let loaded_config: Promise<MergedConfig> | undefined;

export function get_config(): Promise<MergedConfig> {
  return (loaded_config ??= initialize());
}

export async function get_search_engine_names(): Promise<string[]> {
  return Object.keys((await get_config()).search_engines);
}

async function initialize(): Promise<MergedConfig> {
  const loaded = await load_config();
  const { compiled, warnings } = compile_config({
    config: loaded.config,
    default_keymap: DEFAULT_KEYMAP,
    get_command: (command_id) => registry.get(command_id),
    enum_sources: { search_engines: Object.keys(loaded.config.search_engines), containers: await container_names() },
  });

  const plan = plan_slots(compiled.modes.browser);
  const all_warnings = [...loaded.warnings, ...warnings, ...plan.warnings, ...(await apply_slot_plan(plan, browser.commands))];
  for (const warning of all_warnings) console.warn(`oasisfox: ${warning}`);

  await browser.storage.local.set({
    [COMPILED_KEYMAP_STORAGE_KEY]: compiled,
    [WARNINGS_STORAGE_KEY]: all_warnings,
    [SLOT_TABLE_STORAGE_KEY]: slot_table(plan),
  });
  await tell_tabs_tree_changed();
  return loaded.config;
}

async function tell_tabs_tree_changed(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? undefined : browser.tabs.sendMessage(tab.id, { type: "tree_updated" }).catch(() => undefined))),
  );
}

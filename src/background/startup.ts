// Loads the config, compiles the keymap and publishes the result.

import { DEFAULT_SETTINGS } from "../shared/config.ts";
import type { MergedConfig } from "../shared/config.ts";
import type { Mode } from "../shared/command.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../shared/prefix_tree.ts";
import { registry } from "../shared/registry/index.ts";
import { container_names } from "./browser_deps.ts";
import { compile_config } from "./compile.ts";
import { load_config } from "./config_load.ts";
import { DEFAULT_KEYMAP } from "./default_keymap.ts";
import { CONFIG_STATUS_STORAGE_KEY, SLOT_TABLE_STORAGE_KEY, WARNINGS_STORAGE_KEY } from "./storage_keys.ts";
import { recall_reported_mode } from "./tab_modes.ts";
import { apply_toolbar_badge, badge_for_config, refresh_toolbar_badges } from "./toolbar_badge.ts";
import type { ColorScheme } from "./toolbar_badge.ts";
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
  const applied_slots = await apply_slot_plan(plan, browser.commands);
  const all_warnings = [...loaded.warnings, ...warnings, ...plan.warnings, ...applied_slots.warnings];
  for (const warning of all_warnings) console.warn(`oasisfox: ${warning}`);

  await browser.storage.local.set({
    [COMPILED_KEYMAP_STORAGE_KEY]: compiled,
    [WARNINGS_STORAGE_KEY]: all_warnings,
    [CONFIG_STATUS_STORAGE_KEY]: {
      source: loaded.source,
      settings: { ...DEFAULT_SETTINGS, ...loaded.config.settings },
      managed_file_hint: `~/.mozilla/managed-storage/${browser.runtime.id}.json`,
    },
    [SLOT_TABLE_STORAGE_KEY]: slot_table({ ...plan, assignments: applied_slots.applied }),
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

// The toolbar cannot restyle itself, so the system theme is read when a badge is applied.
const light_scheme_query = (): MediaQueryList => window.matchMedia("(prefers-color-scheme: light)");

const current_scheme = (): ColorScheme => (light_scheme_query().matches ? "light" : "dark");

export async function show_toolbar_badge(tab_id: number, mode: Mode): Promise<void> {
  const config = await get_config();
  await apply_toolbar_badge(browser.browserAction, tab_id, badge_for_config(mode, config, current_scheme()));
}

export async function clear_toolbar_badge(tab_id: number): Promise<void> {
  await apply_toolbar_badge(browser.browserAction, tab_id, undefined);
}

export async function refresh_all_toolbar_badges(): Promise<void> {
  const config = await get_config();
  await refresh_toolbar_badges(
    {
      api: browser.browserAction,
      tab_ids: async () => (await browser.tabs.query({})).flatMap((tab) => (tab.id === undefined ? [] : [tab.id])),
      reported_mode: (tab_id) => recall_reported_mode(browser.storage.local, tab_id),
    },
    config,
    current_scheme(),
  );
}

export function on_color_scheme_change(listener: () => void): void {
  light_scheme_query().addEventListener("change", listener);
}

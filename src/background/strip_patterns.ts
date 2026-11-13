// The `strip_tracking_params` names that apply to an address: the global list when the site's `strip_tracking` is on, none when it is off.

import { CONFIG_STATUS_STORAGE_KEY } from "./storage_keys.ts";
import { site_columns_for, site_value } from "./page_keymap.ts";
import { DEFAULT_SETTINGS, DEFAULT_STRIP_TRACKING_PARAMS } from "../shared/default_settings.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../shared/prefix_tree.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";

type Storage = Pick<typeof browser.storage.local, "get">;

// A resolver reads the stored config once, so a tab list resolves each tab without a read per tab.
export async function strip_resolver(storage: Storage): Promise<(address: string) => readonly string[]> {
  // One `get` for both keys, off the keymap cache, so the status and the keymap come from one version.
  const stored = await storage.get([CONFIG_STATUS_STORAGE_KEY, COMPILED_KEYMAP_STORAGE_KEY]);
  const chosen = (stored[CONFIG_STATUS_STORAGE_KEY] as { settings?: Record<string, unknown> } | undefined)?.settings?.strip_tracking_params;
  const patterns = Array.isArray(chosen) && chosen.every((entry) => typeof entry === "string") ? (chosen as string[]) : DEFAULT_STRIP_TRACKING_PARAMS;
  const keymap = current_keymap(stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined);
  return (address) => {
    const global_on = keymap?.frame_site_globals?.strip_tracking ?? DEFAULT_SETTINGS.strip_tracking;
    return site_value(site_columns_for(keymap, [address]), "strip_tracking", global_on) ? patterns : [];
  };
}

export async function strip_patterns_for(storage: Storage, address: string): Promise<readonly string[]> {
  return (await strip_resolver(storage))(address);
}

// The `zoom` setting: a host's zoom is set the first time a tab reaches it in a browser session, so a manual zoom after it sticks.
// Firefox remembers zoom per host and `tabs.setZoom` writes that memory, so one set carries the level to every later tab of the host.
// docs/firefox-behavior.md has the measured details.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap, type CompiledKeymap } from "../shared/prefix_tree.ts";
import { site_columns_for, site_value } from "./page_keymap.ts";
import { SITE_ZOOM_PRIVATE_STORAGE_KEY, SITE_ZOOM_STORAGE_KEY } from "./storage_keys.ts";
import { create_write_queue } from "./store_turns.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export type SiteZoomDeps = {
  session: SessionStorage;
  // The level the address starts at, or undefined to leave the zoom alone.
  level_for: (address: string) => Promise<number | undefined>;
  // The tab's address now, or undefined when the tab is gone.
  address_of: (tab_id: number) => Promise<string | undefined>;
  set_zoom: (tab_id: number, level: number) => Promise<void>;
};

// Host to the level set there. Private windows keep a zoom memory of their own in Firefox, so they keep a record of their own too.
type SetLevels = Record<string, number>;
const key_of = (is_private: boolean) => (is_private ? SITE_ZOOM_PRIVATE_STORAGE_KEY : SITE_ZOOM_STORAGE_KEY);

// Firefox keys its zoom memory by host: ports share it, subdomains do not. An address with no host (file:) keys by its scheme.
export function zoom_site_of(address: string): string | undefined {
  try {
    const url = new URL(address);
    return url.hostname === "" ? url.protocol : url.hostname;
  } catch {
    return undefined;
  }
}

export function create_site_zoom(deps: SiteZoomDeps) {
  const levels_set = async (is_private: boolean): Promise<SetLevels> => ((await deps.session.get(key_of(is_private)))[key_of(is_private)] as SetLevels | undefined) ?? {};
  // One navigation fires several updates, so the work runs one after another and the second update finds the level already set.
  const in_turn = create_write_queue();
  return {
    // A level that changed since it was set (a config edit, `:set`) is set again.
    navigated: (tab_id: number, address: string, is_private: boolean): Promise<void> =>
      in_turn(async () => {
        const site = zoom_site_of(address);
        if (site === undefined) return;
        const level = await deps.level_for(address);
        if (level === undefined) return;
        const set_before = await levels_set(is_private);
        if (set_before[site] === level) return;
        // The tab may have moved on while the level was read. Setting it now would write another site's zoom memory.
        const now = await deps.address_of(tab_id);
        if (now === undefined || zoom_site_of(now) !== site) return;
        await deps.set_zoom(tab_id, level);
        await deps.session.set({ [key_of(is_private)]: { ...set_before, [site]: level } });
      }).catch(() => undefined),
    // Firefox forgets the private zoom memory with the last private window, so the record goes too.
    clear_private_without_window: (has_private_window: () => Promise<boolean>): Promise<void> =>
      in_turn(async () => {
        if (!(await has_private_window())) await deps.session.remove(key_of(true));
      }),
  };
}

type KeymapStorage = Pick<typeof browser.storage.local, "get">;

// The site value comes from the stored keymap, which holds the compiled site table. The switch off stores a keymap with no site table, so only the global level is left then, and `is_disabled` drops that too.
export function make_level_for(local: KeymapStorage, global_level: () => Promise<number | undefined>, is_disabled: () => Promise<boolean>) {
  return async (address: string): Promise<number | undefined> => {
    if (await is_disabled()) return undefined;
    const stored = await local.get(COMPILED_KEYMAP_STORAGE_KEY);
    const keymap = current_keymap(stored[COMPILED_KEYMAP_STORAGE_KEY] as CompiledKeymap | undefined);
    return site_value(site_columns_for(keymap, [address]), "zoom", await global_level());
  };
}

// The `zoom` setting: a tab's zoom is set once when the tab first reaches a site, so a manual zoom after it sticks.
// Firefox remembers zoom per host and `tabs.setZoom` writes that memory, so the level is set only when it is new for this tab and site.
// docs/firefox-behavior.md has the measured details.

import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap, type CompiledKeymap } from "../shared/prefix_tree.ts";
import { site_columns_for, site_value } from "./page_keymap.ts";
import { SITE_ZOOM_STORAGE_PREFIX } from "./storage_keys.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export type SiteZoomDeps = {
  session: SessionStorage;
  // The level the address starts at, or undefined to leave the zoom alone.
  level_for: (address: string) => Promise<number | undefined>;
  // The tab's address now, or undefined when the tab is gone.
  address_of: (tab_id: number) => Promise<string | undefined>;
  set_zoom: (tab_id: number, level: number) => Promise<void>;
};

// Site key to the level set there, per tab.
type AppliedLevels = Record<string, number>;

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
  const key_of = (tab_id: number) => SITE_ZOOM_STORAGE_PREFIX + tab_id;
  const applied_in = async (tab_id: number): Promise<AppliedLevels> => ((await deps.session.get(key_of(tab_id)))[key_of(tab_id)] as AppliedLevels | undefined) ?? {};
  // One navigation fires several updates, so the work runs one after another and the second update finds the level already set.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch(() => {});
    return queue;
  };
  return {
    // A level that changed since this tab last set it (a config edit, `:set`) is set again.
    navigated: (tab_id: number, address: string): Promise<void> =>
      enqueue(async () => {
        const site = zoom_site_of(address);
        if (site === undefined) return;
        const level = await deps.level_for(address);
        if (level === undefined) return;
        const applied = await applied_in(tab_id);
        if (applied[site] === level) return;
        // The tab may have moved on while the level was read. Setting it now would write another site's zoom memory.
        const now = await deps.address_of(tab_id);
        if (now === undefined || zoom_site_of(now) !== site) return;
        await deps.set_zoom(tab_id, level);
        await deps.session.set({ [key_of(tab_id)]: { ...applied, [site]: level } });
      }),
    closed: (tab_id: number): Promise<void> => enqueue(() => deps.session.remove(key_of(tab_id))),
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

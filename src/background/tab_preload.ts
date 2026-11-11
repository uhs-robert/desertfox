import { effective_settings } from "../shared/config.ts";
import { browser_discard_deps, set_unloaded } from "./tab_discard.ts";
import { get_config } from "./startup.ts";
import type { DiscardDeps } from "./tab_discard.ts";

// After a tab switch, gets the next tab in the direction of travel ready: a discarded one is loaded (it stays inactive),
// a loaded one is warmed. A tab this module loaded and the user never visited is unloaded again after a delay.
// The timers live in memory only. A restart of the background loses them, and the loaded tabs then stay loaded: the
// failure costs memory, never a tab the user wanted.

export type Direction = 1 | -1;

export type PreloadSettings = { tab_preload: boolean; tab_preload_unload_ms: number };

export type PreloadDeps = {
  discard: DiscardDeps;
  warmup: (tab_id: number) => Promise<void>;
  settings: () => Promise<PreloadSettings>;
  // Runs `run` once after `delay_ms`. The returned function cancels it.
  after: (run: () => void, delay_ms: number) => () => void;
};

// `loading` is a reload in flight. `waiting` holds the cancel of the unload timer.
type Preloaded = { state: "loading" } | { state: "waiting"; cancel: () => void };

export function create_tab_preload(deps: PreloadDeps) {
  const preloaded = new Map<number, Preloaded>();

  function forget(tab_id: number): void {
    const entry = preloaded.get(tab_id);
    if (entry?.state === "waiting") entry.cancel();
    preloaded.delete(tab_id);
  }

  async function unload_if_untouched(tab_id: number): Promise<void> {
    if (!preloaded.delete(tab_id)) return;
    const tab = await deps.discard.read_tab(tab_id);
    if (!tab || tab.discarded || tab.active || tab.pinned || tab.audible) return;
    await set_unloaded(deps.discard, [tab_id], true);
  }

  async function load(tab_id: number): Promise<void> {
    preloaded.set(tab_id, { state: "loading" });
    const { changed } = await set_unloaded(deps.discard, [tab_id], false).catch(() => ({ changed: [] }));
    // `forget` ran meanwhile when the user activated or closed the tab: it is theirs now.
    if (preloaded.get(tab_id)?.state !== "loading") return;
    const tab = changed.length > 0 ? await deps.discard.read_tab(tab_id) : undefined;
    if (!tab || tab.active || preloaded.get(tab_id)?.state !== "loading") return forget(tab_id);
    const { tab_preload_unload_ms } = await deps.settings();
    // Zero keeps the tab loaded.
    if (tab_preload_unload_ms <= 0) return forget(tab_id);
    preloaded.set(tab_id, { state: "waiting", cancel: deps.after(() => void unload_if_untouched(tab_id).catch(() => undefined), tab_preload_unload_ms) });
  }

  // The next tab after `landed_id` going `direction`. It wraps, as `tab.next` and `tab.prev` do.
  async function after_switch(window_id: number, landed_id: number, direction: Direction): Promise<void> {
    if (!(await deps.settings()).tab_preload) return;
    const tabs = await deps.discard.tabs_in_window(window_id);
    const landed = tabs.find((tab) => tab.id === landed_id);
    if (!landed || tabs.length < 2) return;
    const target = tabs[(landed.index + direction + tabs.length) % tabs.length];
    if (!target || target.id === landed.id || target.active || preloaded.has(target.id)) return;
    if (target.discarded) await load(target.id);
    else await deps.warmup(target.id).catch(() => undefined);
  }

  return {
    after_switch,
    // Fire and forget: a failure of the preload must never reach the switch that started it.
    preload: (window_id: number, landed_id: number, direction: Direction): void => void after_switch(window_id, landed_id, direction).catch(() => undefined),
    // The user took the tab, so nothing may unload it.
    activated: forget,
    removed: forget,
  };
}

export type TabPreload = ReturnType<typeof create_tab_preload>;

export const browser_tab_preload = create_tab_preload({
  discard: browser_discard_deps,
  warmup: (tab_id) => browser.tabs.warmup(tab_id),
  settings: async () => effective_settings((await get_config()).settings),
  after: (run, delay_ms) => {
    const timer = setTimeout(run, delay_ms);
    return () => clearTimeout(timer);
  },
});

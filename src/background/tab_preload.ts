import { effective_settings } from "../shared/config.ts";
import { browser_discard_deps, set_unloaded } from "./tab_discard.ts";
import type { DiscardDeps } from "./tab_discard.ts";
import { get_config } from "./startup.ts";
import { TAB_PRELOAD_STORAGE_KEY } from "./storage_keys.ts";

// After a tab switch, gets the next tab in the direction of travel ready: an unloaded one is loaded (it stays inactive),
// a loaded one is warmed. A tab this module loaded is unloaded again after a delay that starts when the user leaves
// the place next to it, unless the user visited it first. A tab that was loaded before this module touched it is
// never unloaded. The loaded tabs and their deadlines sit in `storage.session` and the deadline fires an alarm, so a
// restart or suspension of the background loses nothing.

export type Direction = 1 | -1;

export type PreloadSettings = { tab_preload: boolean; tab_preload_unload_ms: number };

// `direction` is the travel that loaded the tab: the tab is next to the active one when it lies `direction` places after it. No `deadline` means it is next to the active tab now.
export type Preloaded = { window_id: number; direction: Direction; url: string; deadline?: number };

export type PreloadDeps = {
  discard: DiscardDeps;
  warmup: (tab_id: number) => Promise<void>;
  settings: () => Promise<PreloadSettings>;
  read: () => Promise<Record<string, Preloaded>>;
  write: (entries: Record<string, Preloaded>) => Promise<void>;
  // An alarm per tab id, replaced when set again.
  set_alarm: (tab_id: number, when: number) => void;
  clear_alarm: (tab_id: number) => void;
  now_ms: () => number;
};

export const PRELOAD_ALARM_PREFIX = "desertfox_tab_preload:";

export function create_tab_preload(deps: PreloadDeps) {
  // Changes to the stored entries run one after another, so two events cannot each write over the other's change.
  let queue: Promise<unknown> = Promise.resolve();
  const in_turn = <T>(work: () => Promise<T>): Promise<T> => {
    const turn = queue.then(work);
    queue = turn.catch(() => undefined);
    return turn;
  };
  // In memory on purpose: each lives for one browser call. `activated` and `removed` flip `touched` at once, before their turn comes, so work already under way sees it.
  const in_flight = new Map<number, { touched: boolean }>();

  const touch = (tab_id: number) => {
    const work = in_flight.get(tab_id);
    if (work) work.touched = true;
  };

  function drop(entries: Record<string, Preloaded>, tab_id: number): void {
    deps.clear_alarm(tab_id);
    delete entries[tab_id];
  }

  async function load(window_id: number, tab_id: number, direction: Direction): Promise<void> {
    const work = { touched: false };
    in_flight.set(tab_id, work);
    try {
      const { changed } = await set_unloaded(deps.discard, [tab_id], false).catch(() => ({ changed: [] }));
      // The user took or closed the tab meanwhile: it is theirs now.
      if (changed.length === 0 || work.touched) return;
      const tab = await deps.discard.read_tab(tab_id);
      if (!tab || tab.active || work.touched) return;
      await in_turn(async () => {
        const entries = await deps.read();
        entries[tab_id] = { window_id, direction, url: tab.url ?? "" };
        await deps.write(entries);
        // The user may have moved on while the tab loaded, so the countdown is decided now.
        const active = (await deps.discard.tabs_in_window(window_id)).find((candidate) => candidate.active);
        if (active) await settle(window_id, active.id);
      });
    } finally {
      in_flight.delete(tab_id);
    }
  }

  // The next tab after `landed_id` going `direction`. It wraps, as `tab.next` and `tab.prev` do.
  async function after_switch(window_id: number, landed_id: number, direction: Direction): Promise<void> {
    if (!(await deps.settings()).tab_preload) return;
    const tabs = await deps.discard.tabs_in_window(window_id);
    const landed = tabs.find((tab) => tab.id === landed_id);
    if (!landed || tabs.length < 2) return;
    const target = tabs[(landed.index + direction + tabs.length) % tabs.length];
    if (!target || target.id === landed.id || target.active || in_flight.has(target.id)) return;
    const known = (await deps.read())[target.id];
    if (known && !target.discarded) return void (await in_turn(() => keep_next_to(target.id, direction)));
    // The user unloaded a tracked tab: the old entry goes and the tab loads again.
    if (known) await in_turn(() => forget(target.id));
    if (target.discarded) await load(window_id, target.id, direction);
    else await deps.warmup(target.id).catch(() => undefined);
  }

  // The tab is next to the active one again: its countdown stops.
  async function keep_next_to(tab_id: number, direction: Direction): Promise<void> {
    const entries = await deps.read();
    const entry = entries[tab_id];
    if (!entry) return;
    deps.clear_alarm(tab_id);
    entries[tab_id] = { window_id: entry.window_id, direction, url: entry.url };
    await deps.write(entries);
  }

  // The user switched to `tab_id`. Every tab this module loaded in that window is either the one visited, next to it (no countdown) or left behind (countdown).
  async function settle(window_id: number, tab_id: number): Promise<void> {
    const entries = await deps.read();
    // The visited tab is the user's, whichever window it was loaded for: it may have moved windows since.
    const visited = Boolean(entries[tab_id]);
    if (visited) drop(entries, tab_id);
    const in_window = Object.entries(entries).filter(([, entry]) => entry.window_id === window_id);
    if (in_window.length === 0) {
      if (visited) await deps.write(entries);
      return;
    }
    const tabs = await deps.discard.tabs_in_window(window_id);
    const active = tabs.find((tab) => tab.id === tab_id);
    const { tab_preload_unload_ms } = await deps.settings();
    for (const [key, entry] of in_window) {
      const id = Number(key);
      if (id === tab_id) continue;
      const next_to_active = active !== undefined && tabs[(active.index + entry.direction + tabs.length) % tabs.length]?.id === id;
      if (next_to_active) {
        deps.clear_alarm(id);
        entries[id] = { window_id, direction: entry.direction, url: entry.url };
      } else if (tab_preload_unload_ms <= 0) {
        drop(entries, id);
      } else if (entry.deadline === undefined) {
        const deadline = deps.now_ms() + tab_preload_unload_ms;
        entries[id] = { ...entry, deadline };
        deps.set_alarm(id, deadline);
      }
    }
    await deps.write(entries);
  }

  async function unload_if_untouched(tab_id: number): Promise<void> {
    const work = { touched: false };
    in_flight.set(tab_id, work);
    try {
      const entries = await deps.read();
      const entry = entries[tab_id];
      // A stale alarm, or one for a countdown that stopped.
      if (!entry || entry.deadline === undefined) return;
      // An alarm can fire a few milliseconds early. The entry would then wait for an alarm that never comes.
      if (deps.now_ms() < entry.deadline) return void deps.set_alarm(tab_id, entry.deadline);
      // The user may have come back next to the tab while the alarm waited for its turn.
      const tabs = await deps.discard.tabs_in_window(entry.window_id);
      const active = tabs.find((tab) => tab.active);
      if (active && tabs[(active.index + entry.direction + tabs.length) % tabs.length]?.id === tab_id) {
        entries[tab_id] = { window_id: entry.window_id, direction: entry.direction, url: entry.url };
        return void (await deps.write(entries));
      }
      drop(entries, tab_id);
      await deps.write(entries);
      const tab = await deps.discard.read_tab(tab_id);
      if (!tab || tab.discarded || tab.active || tab.pinned || tab.audible || work.touched) return;
      // `set_unloaded` reads the tab again before it discards. The flag is checked at the last step, so a visit during that read still stops the discard.
      const unless_touched: DiscardDeps = { ...deps.discard, discard: async (id) => void (!work.touched && (await deps.discard.discard(id))) };
      await set_unloaded(unless_touched, [tab_id], true);
    } finally {
      in_flight.delete(tab_id);
    }
  }

  async function forget(tab_id: number): Promise<void> {
    const entries = await deps.read();
    if (!entries[tab_id]) return;
    drop(entries, tab_id);
    await deps.write(entries);
  }

  return {
    // Fire and forget: a failure of the preload must never reach the switch that started it.
    preload: (window_id: number, landed_id: number, direction: Direction): void => void after_switch(window_id, landed_id, direction).catch(() => undefined),
    after_switch,
    // The user took the tab. A load or unload under way for it stops at its next check.
    activated: (window_id: number, tab_id: number): Promise<void> => {
      touch(tab_id);
      return in_turn(() => settle(window_id, tab_id));
    },
    removed: (tab_id: number): Promise<void> => {
      touch(tab_id);
      return in_turn(() => forget(tab_id));
    },
    // The tab's url changed. The preload's own reload reports its url too, so only a different url ends the tracking. This does not touch work under way: `load` stores the url it finds after the reload.
    navigated: (tab_id: number, url: string): Promise<void> =>
      in_turn(async () => {
        if ((await deps.read())[tab_id]?.url !== url) await forget(tab_id);
      }),
    // An alarm fired for the tab.
    alarm: (tab_id: number): Promise<void> => in_turn(() => unload_if_untouched(tab_id)),
    // At each start of the background: the alarms do not outlive an extension reload, the entries may.
    resume: (): Promise<void> =>
      in_turn(async () => {
        for (const [key, entry] of Object.entries(await deps.read())) if (entry.deadline !== undefined) deps.set_alarm(Number(key), entry.deadline);
      }),
  };
}

export type TabPreload = ReturnType<typeof create_tab_preload>;

export const browser_tab_preload = create_tab_preload({
  discard: browser_discard_deps,
  warmup: (tab_id) => browser.tabs.warmup(tab_id),
  settings: async () => effective_settings((await get_config()).settings),
  read: async () => ((await browser.storage.session.get(TAB_PRELOAD_STORAGE_KEY))[TAB_PRELOAD_STORAGE_KEY] as Record<string, Preloaded> | undefined) ?? {},
  write: (entries) => browser.storage.session.set({ [TAB_PRELOAD_STORAGE_KEY]: entries }),
  set_alarm: (tab_id, when) => void browser.alarms.create(PRELOAD_ALARM_PREFIX + tab_id, { when }),
  clear_alarm: (tab_id) => void browser.alarms.clear(PRELOAD_ALARM_PREFIX + tab_id),
  now_ms: () => Date.now(),
});

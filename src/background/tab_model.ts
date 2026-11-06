// The live tab model: one map of tab rows, kept current from tab events and served over the port `desertfox_tab_model`.
// A cache, not state: one `tabs.query` rebuilds it, so nothing is stored.
//
// A port gets a snapshot, then patches. Each port counts its own `rev` (the snapshot carries the current one, each patch is one more),
// because a port sees only the tabs of its own privacy and a global count would show it gaps. A client that sees a gap sends `resync`.
// A patch applies `removed` first, then `upserts`. Upserts carry every row whose index shifted, so a client never recomputes indexes.

import type { TabModelMessage, TabModelRequest, TabRow } from "../shared/messages.ts";
import { site_key } from "../shared/site_key.ts";
import { listed_favicon } from "./complete_items.ts";

// The plain name states no privacy, so a page with no sender tab (a sidebar) connects as `:normal` or `:private`.
// The page knows its own context, and the background cannot read it from such a port.
export const TAB_MODEL_PORT_NAME = "desertfox_tab_model";
const PORT_PRIVACY: Record<string, boolean | undefined> = { [TAB_MODEL_PORT_NAME]: undefined, [`${TAB_MODEL_PORT_NAME}:normal`]: false, [`${TAB_MODEL_PORT_NAME}:private`]: true };
export const FLUSH_DELAY_MS = 30;

type Entry = { row: TabRow; incognito: boolean };
type Tab = browser.tabs.Tab;
type Listener<Args extends unknown[]> = { addListener: (listener: (...args: Args) => void) => void };

export type TabModelPort = {
  name: string;
  sender?: { url?: string; tab?: { incognito?: boolean } };
  postMessage: (message: TabModelMessage) => void;
  onMessage: Listener<[unknown]>;
  onDisconnect: Listener<[]>;
};

export type TabModelDeps = {
  query: () => Promise<Tab[]>;
  events: {
    onCreated: Listener<[Tab]>;
    onRemoved: Listener<[number, { windowId: number; isWindowClosing: boolean }]>;
    onUpdated: Listener<[number, unknown, Tab]>;
    onMoved: Listener<[number, { windowId: number; fromIndex: number; toIndex: number }]>;
    onAttached: Listener<[number, { newWindowId: number; newPosition: number }]>;
    onDetached: Listener<[number, { oldWindowId: number; oldPosition: number }]>;
    onActivated: Listener<[{ tabId: number; windowId: number }]>;
  };
  on_connect: Listener<[TabModelPort]>;
  // Only an extension page may read the tab list. A content script reports the page's URL as its sender.
  is_extension_page: (port: TabModelPort) => boolean;
  set_timer: (callback: () => void, delay_ms: number) => unknown;
  clear_timer: (handle: unknown) => void;
};

function entry_of(tab: Tab): Entry | undefined {
  if (tab.id === undefined || tab.windowId === undefined) return undefined;
  const url = tab.url ?? "";
  return {
    incognito: tab.incognito === true,
    row: {
      id: tab.id,
      window_id: tab.windowId,
      index: tab.index,
      title: tab.title ?? "",
      url,
      favicon_url: listed_favicon(tab.favIconUrl) ?? "",
      site: site_key(url).key,
      pinned: tab.pinned === true,
      muted: tab.mutedInfo?.muted === true,
      audible: tab.audible === true,
      discarded: tab.discarded === true,
      active: tab.active === true,
      container: tab.cookieStoreId ?? "",
    },
  };
}

// The fields an update may change. Position and `active` stay the model's own, because their events arrive in order and the tab object in an update can be stale.
const UPDATABLE = ["title", "url", "favicon_url", "site", "pinned", "muted", "audible", "discarded", "container"] as const;

export function create_tab_model(deps: TabModelDeps) {
  const entries = new Map<number, Entry>();
  // A tab between `onDetached` and `onAttached`. Ports see it as removed until it attaches.
  const detached = new Map<number, Entry>();
  // `incognito` is undefined when the port stated nothing and has no sender tab. Such a port matches no row.
  type PortState = { port: TabModelPort; incognito: boolean | undefined; rev: number; ready: boolean };
  const ports = new Set<PortState>();

  // The batch waiting for the flush. `created` holds the ids no port has heard of yet, so create then remove sends nothing.
  let upserts = new Set<number>();
  let removed = new Map<number, boolean>();
  let created = new Set<number>();
  let timer: unknown;

  let loaded = false;
  let loading: Promise<void> | undefined;
  let raced = false;

  const rows_for = (incognito: boolean | undefined) =>
    [...entries.values()]
      .filter((entry) => entry.incognito === incognito)
      .map((entry) => entry.row)
      .sort((a, b) => a.window_id - b.window_id || a.index - b.index);

  const send = (state: PortState, message: TabModelMessage) => {
    try {
      state.port.postMessage(message);
    } catch {
      ports.delete(state);
    }
  };
  const send_snapshot = (state: PortState) => send(state, { type: "snapshot", rev: state.rev, tabs: rows_for(state.incognito) });

  const flush = () => {
    if (timer !== undefined) deps.clear_timer(timer);
    timer = undefined;
    const batch = { upserts, removed, created };
    upserts = new Set();
    removed = new Map();
    created = new Set();
    for (const state of [...ports]) {
      if (!state.ready) continue;
      const rows = [...batch.upserts].flatMap((id) => {
        const entry = entries.get(id);
        return entry && entry.incognito === state.incognito ? [entry.row] : [];
      });
      const gone = [...batch.removed].filter(([, incognito]) => incognito === state.incognito).map(([id]) => id);
      if (rows.length === 0 && gone.length === 0) continue;
      state.rev += 1;
      send(state, { type: "patch", rev: state.rev, upserts: rows, removed: gone });
    }
  };
  const schedule = () => {
    if (timer === undefined) timer = deps.set_timer(flush, FLUSH_DELAY_MS);
  };
  const touch = (id: number) => {
    upserts.add(id);
    schedule();
  };
  const forget = (id: number, incognito: boolean) => {
    upserts.delete(id);
    if (!created.delete(id)) removed.set(id, incognito);
    schedule();
  };

  const shift_window = (window_id: number, from_index: number, delta: number, skip_id?: number) => {
    for (const entry of entries.values()) {
      if (entry.row.window_id === window_id && entry.row.id !== skip_id && entry.row.index >= from_index) {
        entry.row.index += delta;
        touch(entry.row.id);
      }
    }
  };
  const activate = (window_id: number, tab_id: number) => {
    for (const entry of entries.values()) {
      if (entry.row.window_id !== window_id) continue;
      const active = entry.row.id === tab_id;
      if (entry.row.active !== active) {
        entry.row.active = active;
        touch(entry.row.id);
      }
    }
  };

  // Events that arrive while the model is loading are dropped: the load notices them and queries again.
  const when_loaded = <Args extends unknown[]>(handle: (...args: Args) => void) => (...args: Args) => {
    if (!loaded) {
      raced = true;
      void load();
      return;
    }
    handle(...args);
  };

  const load = (): Promise<void> => {
    loading ??= (async () => {
      try {
        for (;;) {
          raced = false;
          let tabs: Tab[];
          try {
            tabs = await deps.query();
          } catch (error) {
            // An event that raced a failed query is the only trigger left to query again.
            if (raced) continue;
            throw error;
          }
          if (raced) continue;
          entries.clear();
          detached.clear();
          for (const tab of tabs) {
            const entry = entry_of(tab);
            if (entry) entries.set(entry.row.id, entry);
          }
          upserts = new Set();
          removed = new Map();
          created = new Set();
          loaded = true;
          for (const state of ports) {
            state.ready = true;
            send_snapshot(state);
          }
          return;
        }
      } catch {
        // The next event tries again.
      } finally {
        loading = undefined;
      }
    })();
    return loading;
  };

  const { events } = deps;
  events.onCreated.addListener(
    when_loaded((tab) => {
      const entry = entry_of(tab);
      if (!entry) return;
      if (!entries.has(entry.row.id)) {
        shift_window(entry.row.window_id, entry.row.index, 1);
        created.add(entry.row.id);
      }
      entries.set(entry.row.id, entry);
      if (entry.row.active) activate(entry.row.window_id, entry.row.id);
      touch(entry.row.id);
    }),
  );
  events.onRemoved.addListener(
    when_loaded((tab_id) => {
      const entry = entries.get(tab_id);
      if (entry) {
        entries.delete(tab_id);
        shift_window(entry.row.window_id, entry.row.index + 1, -1);
        forget(tab_id, entry.incognito);
      } else detached.delete(tab_id);
    }),
  );
  events.onUpdated.addListener(
    when_loaded((tab_id, _change, tab) => {
      const current = entries.get(tab_id) ?? detached.get(tab_id);
      const fresh = entry_of(tab);
      if (!current || !fresh) return;
      let changed = false;
      for (const field of UPDATABLE) {
        if (current.row[field] !== fresh.row[field]) {
          (current.row as Record<string, unknown>)[field] = fresh.row[field];
          changed = true;
        }
      }
      if (changed && entries.has(tab_id)) touch(tab_id);
    }),
  );
  events.onMoved.addListener(
    when_loaded((tab_id, { windowId, fromIndex, toIndex }) => {
      const entry = entries.get(tab_id);
      if (!entry) return;
      if (fromIndex < toIndex) {
        for (const other of entries.values()) {
          if (other.row.window_id === windowId && other.row.id !== tab_id && other.row.index > fromIndex && other.row.index <= toIndex) {
            other.row.index -= 1;
            touch(other.row.id);
          }
        }
      } else if (toIndex < fromIndex) {
        for (const other of entries.values()) {
          if (other.row.window_id === windowId && other.row.id !== tab_id && other.row.index >= toIndex && other.row.index < fromIndex) {
            other.row.index += 1;
            touch(other.row.id);
          }
        }
      }
      entry.row.index = toIndex;
      touch(tab_id);
    }),
  );
  events.onDetached.addListener(
    when_loaded((tab_id, { oldWindowId }) => {
      const entry = entries.get(tab_id);
      if (!entry) return;
      entries.delete(tab_id);
      detached.set(tab_id, entry);
      shift_window(oldWindowId, entry.row.index + 1, -1);
      // Ports drop the row now and take it back at its new place on attach.
      upserts.delete(tab_id);
      if (!created.has(tab_id)) removed.set(tab_id, entry.incognito);
      schedule();
    }),
  );
  events.onAttached.addListener(
    when_loaded((tab_id, { newWindowId, newPosition }) => {
      const entry = detached.get(tab_id) ?? entries.get(tab_id);
      if (!entry) return;
      detached.delete(tab_id);
      if (entries.has(tab_id)) shift_window(entry.row.window_id, entry.row.index + 1, -1, tab_id);
      shift_window(newWindowId, newPosition, 1, tab_id);
      entry.row.window_id = newWindowId;
      entry.row.index = newPosition;
      entry.row.active = ![...entries.values()].some((other) => other.row.window_id === newWindowId && other.row.active);
      entries.set(tab_id, entry);
      removed.delete(tab_id);
      touch(tab_id);
    }),
  );
  events.onActivated.addListener(
    when_loaded(({ tabId, windowId }) => {
      if (entries.has(tabId)) activate(windowId, tabId);
    }),
  );

  deps.on_connect.addListener((port) => {
    if (!Object.hasOwn(PORT_PRIVACY, port.name) || !deps.is_extension_page(port)) return;
    const sender_tab = port.sender?.tab;
    const state: PortState = { port, incognito: sender_tab ? sender_tab.incognito === true : PORT_PRIVACY[port.name], rev: 0, ready: false };
    ports.add(state);
    port.onDisconnect.addListener(() => ports.delete(state));
    port.onMessage.addListener((message) => {
      if (!state.ready || (message as TabModelRequest | undefined)?.type !== "resync") return;
      flush();
      send_snapshot(state);
    });
    if (loaded) {
      // Pending changes go to the ports first, so the snapshot holds nothing a later patch repeats.
      flush();
      state.ready = true;
      send_snapshot(state);
    } else void load();
  });

  return {
    // A second call must not query again: a query after the load would wipe the live rows.
    start: async () => {
      if (!loaded) await load();
    },
    // Waits for the load, then flushes now. For a reader that needs the current state.
    settled: async () => {
      if (!loaded) await load();
      flush();
    },
  };
}

export function browser_tab_model_deps(): TabModelDeps {
  const extension_root = browser.runtime.getURL("");
  return {
    query: () => browser.tabs.query({}),
    events: browser.tabs as unknown as TabModelDeps["events"],
    on_connect: browser.runtime.onConnect as unknown as TabModelDeps["on_connect"],
    is_extension_page: (port) => port.sender?.url?.startsWith(extension_root) === true,
    set_timer: (callback, delay_ms) => setTimeout(callback, delay_ms),
    clear_timer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

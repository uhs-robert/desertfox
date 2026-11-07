// The live tab model: one map of tab rows, kept current from tab events and served over the port `desertfox_tab_model`.
// A cache, not state: one `tabs.query` rebuilds it, so nothing is stored.
//
// A port gets a snapshot, then patches. Each port counts its own `rev` (the snapshot carries the current one, each patch is one more),
// because a port sees only the tabs of its own privacy and a global count would show it gaps. A client that sees a gap sends `resync`.
// A patch applies `removed` first, then `upserts`. Upserts carry every row whose index shifted, so a client never recomputes indexes.

import type { TabModelMessage, TabModelRequest, TabRow } from "../shared/messages.ts";
import { site_key } from "../shared/site_key.ts";
import { TAB_MODEL_PORT_NAME, TAB_MODEL_PORT_NORMAL, TAB_MODEL_PORT_PRIVATE } from "../shared/tab_model_port.ts";
import { listed_favicon, numbered_windows, read_container_identities } from "./complete_items.ts";
import type { ContainerIdentity, WindowLike } from "./complete_items.ts";

const PORT_PRIVACY: Record<string, boolean | undefined> = { [TAB_MODEL_PORT_NAME]: undefined, [TAB_MODEL_PORT_NORMAL]: false, [TAB_MODEL_PORT_PRIVATE]: true };
export const FLUSH_DELAY_MS = 30;
// A reconcile that keeps seeing events gives up, and the model stays as the events left it until the next one.
const RECONCILE_ATTEMPTS = 3;

type Entry = { row: TabRow; incognito: boolean };
type Tab = browser.tabs.Tab;
type Listener<Args extends unknown[]> = { addListener: (listener: (...args: Args) => void) => void };
type Containers = ReadonlyMap<string, ContainerIdentity>;
// Window id to its number, as `numbered_windows` counts them.
type WindowNumbers = ReadonlyMap<number, number>;

export type TabModelPort = {
  name: string;
  sender?: { url?: string; frameId?: number; tab?: { id?: number; incognito?: boolean } };
  postMessage: (message: TabModelMessage) => void;
  disconnect: () => void;
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
    onActivated: Listener<[{ tabId: number; windowId: number; previousTabId?: number | undefined }]>;
  };
  windows: () => Promise<WindowLike[]>;
  window_events: { onCreated: Listener<[unknown]>; onRemoved: Listener<[number]> };
  // Rejects or answers empty when containers are off.
  containers: () => Promise<Containers>;
  // Absent when the browser has no container API.
  container_events?: { onCreated: Listener<[unknown]>; onUpdated: Listener<[unknown]>; onRemoved: Listener<[unknown]> } | undefined;
  // The stored previous tab of a window (`previous_tab.ts`), read at load only. Afterwards the model follows `onActivated` itself,
  // because tab events reach it in order and the stored value lags behind its write queue.
  previous_of: (window_id: number) => Promise<number | undefined>;
  on_connect: Listener<[TabModelPort]>;
  // Only an extension page may read the tab list. A content script reports the page's URL as its sender.
  is_extension_page: (port: TabModelPort) => boolean;
  // A web page can frame a web-accessible page (`cmdline.html`), and the frame is still an extension page, so such a port must be the line that redeemed its tab's ticket.
  is_web_accessible_page: (port: TabModelPort) => boolean;
  is_opener: (tab_id: number, frame_id: number) => Promise<boolean>;
  set_timer: (callback: () => void, delay_ms: number) => unknown;
  clear_timer: (handle: unknown) => void;
};

function entry_of(tab: Tab, window_numbers: WindowNumbers, containers: Containers): Entry | undefined {
  if (tab.id === undefined || tab.windowId === undefined) return undefined;
  const url = tab.url ?? "";
  const container = containers.get(tab.cookieStoreId ?? "");
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
      previous: false,
      window_number: window_numbers.get(tab.windowId) ?? 0,
      container: tab.cookieStoreId ?? "",
      container_name: container?.name ?? "",
      container_color: container?.color ?? "",
      container_icon: container?.icon ?? "",
    },
  };
}

// The fields an update may change. Position, `active`, `previous` and `window_number` stay the model's own, because their events arrive in order and the tab object in an update can be stale.
const UPDATABLE = ["title", "url", "favicon_url", "site", "pinned", "muted", "audible", "discarded", "container", "container_name", "container_color", "container_icon"] as const;
// A tab unloaded while it still loads reads about:blank with no title. The row keeps the address it had.
const ADDRESS_FIELDS: ReadonlySet<keyof TabRow> = new Set(["title", "url", "site"]);
const is_unloaded_blank = (row: TabRow) => row.discarded && row.url === "about:blank";

// Runs `read`, and applies its answer only when no later call started meanwhile, so an older answer never overwrites a newer one.
function latest_only<T>(read: () => Promise<T>, apply: (value: T) => void) {
  let calls = 0;
  return async () => {
    const call = ++calls;
    const value = await read();
    if (call === calls) apply(value);
  };
}

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
  let events_seen = 0;
  let reconciles = 0;
  let newest_reconcile: Promise<void> = Promise.resolve();
  let window_numbers: WindowNumbers = new Map();
  let containers: Containers = new Map();

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
  const set_field = <Field extends keyof TabRow>(entry: Entry, field: Field, value: TabRow[Field]) => {
    if (entry.row[field] === value) return;
    entry.row[field] = value;
    touch(entry.row.id);
  };
  // `previous_tab.ts` keeps the same rule: a window's first activation has none, and the active tab is never the previous one.
  const mark_previous = (window_id: number, previous_id: number | undefined) => {
    for (const entry of entries.values()) {
      if (entry.row.window_id === window_id) set_field(entry, "previous", entry.row.id === previous_id && !entry.row.active);
    }
  };
  // Detached rows too, or an attach after a re-read would send stale marks.
  const relabel_rows = () => {
    for (const entry of [...entries.values(), ...detached.values()]) {
      set_field(entry, "window_number", window_numbers.get(entry.row.window_id) ?? 0);
      const container = containers.get(entry.row.container);
      set_field(entry, "container_name", container?.name ?? "");
      set_field(entry, "container_color", container?.color ?? "");
      set_field(entry, "container_icon", container?.icon ?? "");
    }
  };
  const number_windows = (windows: readonly WindowLike[]): WindowNumbers => new Map(numbered_windows(windows).map((window) => [window.id, window.number]));
  const reread_windows = latest_only(
    () => deps.windows().then(number_windows, () => undefined),
    (numbers) => {
      if (!numbers) return;
      window_numbers = numbers;
      relabel_rows();
    },
  );
  const reread_containers = latest_only(
    () => deps.containers().catch((): Containers => new Map()),
    (read) => {
      containers = read;
      relabel_rows();
    },
  );

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
    events_seen += 1;
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
          let windows: WindowLike[];
          let loaded_containers: Containers;
          let previous_by_window: Map<number, number | undefined>;
          try {
            [tabs, windows, loaded_containers] = await Promise.all([deps.query(), deps.windows(), deps.containers().catch((): Containers => new Map())]);
            const window_ids = windows.flatMap((window) => (window.id === undefined ? [] : [window.id]));
            previous_by_window = new Map(await Promise.all(window_ids.map(async (id) => [id, await deps.previous_of(id).catch(() => undefined)] as const)));
          } catch (error) {
            // An event that raced a failed query is the only trigger left to query again.
            if (raced) continue;
            throw error;
          }
          if (raced) continue;
          window_numbers = number_windows(windows);
          containers = loaded_containers;
          entries.clear();
          detached.clear();
          for (const tab of tabs) {
            const entry = entry_of(tab, window_numbers, containers);
            if (!entry) continue;
            entry.row.previous = !entry.row.active && previous_by_window.get(entry.row.window_id) === entry.row.id;
            entries.set(entry.row.id, entry);
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

  const same_entry = (a: Entry, b: Entry) => a.incognito === b.incognito && (Object.keys(a.row) as (keyof TabRow)[]).every((field) => a.row[field] === b.row[field]);
  // The event handlers shift indexes by hand, so one stale or missed event leaves rows wrong until Firefox is asked again.
  // The diff goes through `touch` and `forget`, so ports get patches, not snapshots. `previous` stays the model's own, as in `UPDATABLE`.
  const repair_from = (tabs: Tab[]) => {
    const fresh = new Map<number, Entry>();
    for (const tab of tabs) {
      const entry = entry_of(tab, window_numbers, containers);
      if (entry) fresh.set(entry.row.id, entry);
    }
    for (const [id, entry] of entries) {
      if (fresh.has(id)) continue;
      entries.delete(id);
      forget(id, entry.incognito);
    }
    for (const [id, entry] of fresh) {
      const current = entries.get(id);
      if (current && is_unloaded_blank(entry.row)) for (const field of ADDRESS_FIELDS) (entry.row as Record<string, unknown>)[field] = current.row[field];
      entry.row.previous = !entry.row.active && (current?.row.previous ?? false);
      if (current && same_entry(current, entry)) continue;
      // A listed tab is attached. A detach still in progress is safe to adopt, because `onAttached` also moves a tab that sits in `entries`.
      // Without this, a missed `onAttached` would hide the tab until restart.
      const was_detached = detached.delete(id);
      if (!current && !was_detached) created.add(id);
      entries.set(id, entry);
      touch(id);
    }
  };
  // Like the startup load, an event during the query makes the answer stale, so it queries again. An overlapped call waits for the newest one.
  const reconcile = (): Promise<void> => {
    const call = ++reconciles;
    newest_reconcile = (async () => {
      for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt += 1) {
        const seen = events_seen;
        // Windows and containers too, so a missed window or container event heals the labels as well.
        const [tabs, numbers, read_containers] = await Promise.all([
          deps.query().catch(() => undefined),
          deps.windows().then(number_windows, () => undefined),
          deps.containers().catch((): Containers => new Map()),
        ]);
        if (call !== reconciles) return newest_reconcile;
        if (tabs === undefined) return;
        if (events_seen !== seen) continue;
        if (numbers) window_numbers = numbers;
        containers = read_containers;
        repair_from(tabs);
        // `repair_from` labels the listed rows. This reaches the detached ones.
        relabel_rows();
        return;
      }
    })();
    return newest_reconcile;
  };

  const { events } = deps;
  events.onCreated.addListener(
    when_loaded((tab) => {
      const entry = entry_of(tab, window_numbers, containers);
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
      const fresh = entry_of(tab, window_numbers, containers);
      if (!current || !fresh) return;
      let changed = false;
      const unloaded_blank = is_unloaded_blank(fresh.row);
      for (const field of UPDATABLE) {
        if (unloaded_blank && ADDRESS_FIELDS.has(field)) continue;
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
      // The old window's `previous_tab.ts` value may still name it, but the tab list marks `#` only inside that window.
      entry.row.previous = false;
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
      entry.row.window_number = window_numbers.get(newWindowId) ?? 0;
      entry.row.index = newPosition;
      entry.row.active = ![...entries.values()].some((other) => other.row.id !== tab_id && other.row.window_id === newWindowId && other.row.active);
      entries.set(tab_id, entry);
      removed.delete(tab_id);
      touch(tab_id);
    }),
  );
  events.onActivated.addListener(
    when_loaded(({ tabId, windowId, previousTabId }) => {
      if (entries.has(tabId)) activate(windowId, tabId);
      mark_previous(windowId, previousTabId);
    }),
  );
  // A window opening or closing shifts the numbers of the windows after it.
  deps.window_events.onCreated.addListener(when_loaded(() => void reread_windows()));
  deps.window_events.onRemoved.addListener(when_loaded(() => void reread_windows()));
  for (const event of [deps.container_events?.onCreated, deps.container_events?.onUpdated, deps.container_events?.onRemoved]) {
    event?.addListener(when_loaded(() => void reread_containers()));
  }

  deps.on_connect.addListener((port) => {
    if (!Object.hasOwn(PORT_PRIVACY, port.name) || !deps.is_extension_page(port)) return;
    const sender_tab = port.sender?.tab;
    const state: PortState = { port, incognito: sender_tab ? sender_tab.incognito === true : PORT_PRIVACY[port.name], rev: 0, ready: false };
    let disconnected = false;
    port.onDisconnect.addListener(() => {
      disconnected = true;
      ports.delete(state);
    });
    port.onMessage.addListener((message) => {
      if (!state.ready || (message as TabModelRequest | undefined)?.type !== "resync") return;
      void reconcile().then(() => {
        if (!ports.has(state)) return;
        flush();
        send_snapshot(state);
      });
    });
    // The port joins `ports` only once admitted, so neither a load nor a flush reaches it before.
    const admit = () => {
      ports.add(state);
      if (loaded) {
        void reconcile().then(() => {
          if (!ports.has(state)) return;
          // Pending changes go to the ports first, so the snapshot holds nothing a later patch repeats.
          flush();
          state.ready = true;
          send_snapshot(state);
        });
      } else void load();
    };
    // A web page can frame only a web-accessible page, so only that page needs the ticket. Any other extension page is extension code.
    // The opener mark clears when the tab navigates, and that also ends the frame and its port, so one check at connect is enough.
    if (!deps.is_web_accessible_page(port)) return admit();
    const tab_id = sender_tab?.id;
    const frame_id = port.sender?.frameId;
    const opener_check = tab_id === undefined || frame_id === undefined ? Promise.resolve(false) : deps.is_opener(tab_id, frame_id).catch(() => false);
    void opener_check.then((opener) => {
      if (disconnected) return;
      if (opener) return admit();
      try {
        port.disconnect();
      } catch {
        // Already gone.
      }
    });
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
    // For a ticketed action message that names tabs: a copy, so a caller cannot change the model.
    row_of: (id: number): TabRow | undefined => {
      const entry = entries.get(id);
      return entry ? { ...entry.row } : undefined;
    },
    ids_of_privacy: (incognito: boolean): number[] => [...entries.values()].filter((entry) => entry.incognito === incognito).map((entry) => entry.row.id),
  };
}

export function browser_tab_model_deps(from_services: Pick<TabModelDeps, "previous_of" | "is_opener">): TabModelDeps {
  const extension_root = browser.runtime.getURL("");
  // Manifest V2 lists plain file names. A Manifest V3 entry is an object and needs reading here after a move.
  const web_accessible_urls = new Set((browser.runtime.getManifest().web_accessible_resources ?? []).flatMap((resource) => (typeof resource === "string" ? [browser.runtime.getURL(resource)] : [])));
  const page_url_of = (url: string) => url.replace(/[?#].*$/, "");
  return {
    ...from_services,
    query: () => browser.tabs.query({}),
    events: browser.tabs as unknown as TabModelDeps["events"],
    windows: () => browser.windows.getAll(),
    window_events: browser.windows as unknown as TabModelDeps["window_events"],
    containers: () => read_container_identities(() => browser.contextualIdentities.query({})),
    container_events: browser.contextualIdentities as unknown as TabModelDeps["container_events"],
    on_connect: browser.runtime.onConnect as unknown as TabModelDeps["on_connect"],
    is_extension_page: (port) => port.sender?.url?.startsWith(extension_root) === true,
    is_web_accessible_page: (port) => web_accessible_urls.has(page_url_of(port.sender?.url ?? "")),
    set_timer: (callback, delay_ms) => setTimeout(callback, delay_ms),
    clear_timer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

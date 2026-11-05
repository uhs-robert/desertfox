// The tabs, bookmarks, engines and headings the list offers. The background hands out the first kinds and the host script the headings, once per kind, and the line keeps them, so
// ranking a keystroke never waits. Pure: the page passes in the asking and the redraw.

import type { BookmarkItem, CompleteItemsAnswer, EngineItem, HeadingItem, OpenItems, TabItem, WindowItem } from "../../shared/messages.ts";

export type LiveKind = "tabs" | "bookmarks" | "engines" | "open" | "windows" | "headings";
export type LiveItems = { tabs: TabItem[]; bookmarks: BookmarkItem[]; engines: EngineItem[]; open: OpenItems; windows: WindowItem[]; headings: HeadingItem[] };
export type LiveRead<Kind extends LiveKind> = { loading: true } | { loading: false; items: LiveItems[Kind] };

export type LiveDeps = {
  ask: (kind: LiveKind) => Promise<CompleteItemsAnswer | undefined>;
  // A fetch landed and the list can rank it.
  on_ready: () => void;
};

const empty_items = (kind: LiveKind): CompleteItemsAnswer["items"] => (kind === "open" ? { rows: [], history_max: 0 } : []);

export function create_live_source(deps: LiveDeps) {
  const cache: { [Kind in LiveKind]?: LiveItems[Kind] } = {};
  // Each kind has one fetch in flight at most, so kinds read in one pass do not drop each other. A reply lands only while its own request is the one recorded.
  let latest = 0;
  const pending = new Map<LiveKind, number>();

  const land = (kind: LiveKind, request: number, items: CompleteItemsAnswer["items"]) => {
    if (pending.get(kind) !== request) return;
    pending.delete(kind);
    (cache as Record<LiveKind, unknown>)[kind] = items;
    deps.on_ready();
  };

  const start = (kind: LiveKind) => {
    const request = ++latest;
    pending.set(kind, request);
    // The background answers nothing for a line it did not open, and a failed call looks the same. Either way the line has no candidates.
    deps.ask(kind).then(
      (answer) => land(kind, request, answer?.items ?? empty_items(kind)),
      () => land(kind, request, empty_items(kind)),
    );
  };

  return {
    read: <Kind extends LiveKind>(kind: Kind): LiveRead<Kind> => {
      const items = cache[kind] as LiveItems[Kind] | undefined;
      if (items) return { loading: false, items };
      if (!pending.has(kind)) start(kind);
      return { loading: true };
    },
    // A tab changed after the list was fetched: later rankings show it too.
    patch_tab: (item: TabItem) => {
      if (cache.tabs) cache.tabs = cache.tabs.map((tab) => (tab.id === item.id ? item : tab));
    },
    // The line closed: a reply still on its way lands nowhere.
    close: () => {
      pending.clear();
    },
  };
}

export type LiveSource = ReturnType<typeof create_live_source>;

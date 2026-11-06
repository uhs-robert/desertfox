// The tabs, bookmarks, engines and headings the list offers. The background hands out the bookmarks, engines, open rows and windows and the host script the headings, once per kind, and the line keeps them, so
// ranking a keystroke never waits. The tabs are not fetched: the live tab model keeps them current. Pure: the page passes in the asking and the redraw.

import type { BookmarkItem, CompleteItemsAnswer, EngineItem, HeadingItem, OpenItems, TabItem, WindowItem } from "../../shared/messages.ts";

export type LiveKind = "tabs" | "bookmarks" | "engines" | "open" | "windows" | "headings";
export type LiveItems = { tabs: TabItem[]; bookmarks: BookmarkItem[]; engines: EngineItem[]; open: OpenItems; windows: WindowItem[]; headings: HeadingItem[] };
export type LiveRead<Kind extends LiveKind> = { loading: true } | { loading: false; items: LiveItems[Kind] };

type FetchedKind = Exclude<LiveKind, "tabs">;

export type LiveDeps = {
  ask: (kind: FetchedKind) => Promise<CompleteItemsAnswer | undefined>;
  // The model's tab rows, undefined until its first snapshot. The first call is the page's cue to connect.
  tabs: () => TabItem[] | undefined;
  // A fetch landed and the list can rank it.
  on_ready: () => void;
};

const empty_items = (kind: FetchedKind): CompleteItemsAnswer["items"] => (kind === "open" ? { rows: [], history_max: 0 } : []);

export function create_live_source(deps: LiveDeps) {
  const cache: { [Kind in FetchedKind]?: LiveItems[Kind] } = {};
  // Each kind has one fetch in flight at most, so kinds read in one pass do not drop each other. A reply lands only while its own request is the one recorded.
  let latest = 0;
  const pending = new Map<FetchedKind, number>();

  const land = (kind: FetchedKind, request: number, items: CompleteItemsAnswer["items"]) => {
    if (pending.get(kind) !== request) return;
    pending.delete(kind);
    (cache as Record<FetchedKind, unknown>)[kind] = items;
    deps.on_ready();
  };

  const start = (kind: FetchedKind) => {
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
      if (kind === "tabs") {
        const tabs = deps.tabs();
        return (tabs ? { loading: false, items: tabs } : { loading: true }) as LiveRead<Kind>;
      }
      const items = cache[kind as FetchedKind] as LiveItems[Kind] | undefined;
      if (items) return { loading: false, items };
      if (!pending.has(kind as FetchedKind)) start(kind as FetchedKind);
      return { loading: true };
    },
    // The line closed: a reply still on its way lands nowhere.
    close: () => {
      pending.clear();
    },
  };
}

export type LiveSource = ReturnType<typeof create_live_source>;

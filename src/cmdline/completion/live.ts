// The tabs, bookmarks and engines the list offers. The background hands them out once per kind and the line keeps them, so
// ranking a keystroke never waits. Pure: the page passes in the asking and the redraw.

import type { BookmarkItem, CompleteItemsAnswer, EngineItem, TabItem, WindowItem } from "../../shared/messages.ts";

export type LiveKind = "tabs" | "bookmarks" | "engines" | "windows";
export type LiveItems = { tabs: TabItem[]; bookmarks: BookmarkItem[]; engines: EngineItem[]; windows: WindowItem[] };
export type LiveRead<Kind extends LiveKind> = { loading: true } | { loading: false; items: LiveItems[Kind] };

export type LiveDeps = {
  ask: (kind: LiveKind) => Promise<CompleteItemsAnswer | undefined>;
  // A fetch landed and the list can rank it.
  on_ready: () => void;
};

export function create_live_source(deps: LiveDeps) {
  const cache: { [Kind in LiveKind]?: LiveItems[Kind] } = {};
  // Only the newest fetch may land. Switching to the other kind starts a new one and drops the older reply, which asks again if its kind comes back.
  let latest = 0;
  let pending: { kind: LiveKind; request: number } | undefined;

  const land = (kind: LiveKind, request: number, items: CompleteItemsAnswer["items"]) => {
    if (pending?.request !== request) return;
    pending = undefined;
    (cache as Record<LiveKind, unknown>)[kind] = items;
    deps.on_ready();
  };

  const start = (kind: LiveKind) => {
    const request = ++latest;
    pending = { kind, request };
    // The background answers nothing for a line it did not open, and a failed call looks the same. Either way the line has no candidates.
    deps.ask(kind).then(
      (answer) => land(kind, request, answer?.items ?? []),
      () => land(kind, request, []),
    );
  };

  return {
    read: <Kind extends LiveKind>(kind: Kind): LiveRead<Kind> => {
      const items = cache[kind] as LiveItems[Kind] | undefined;
      if (items) return { loading: false, items };
      if (pending?.kind !== kind) start(kind);
      return { loading: true };
    },
    // The line closed: a reply still on its way lands nowhere.
    close: () => {
      pending = undefined;
    },
  };
}

export type LiveSource = ReturnType<typeof create_live_source>;

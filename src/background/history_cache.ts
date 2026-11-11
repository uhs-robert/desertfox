// The newest history rows, kept in the background so history completion reaches pages older than one `history.search` answer holds.
// Derived state: the browser's history is the truth, so every start of the background refills it with one search. A future event page refills on each wake, and a line that asks before the fill ends gets the plain search.

export const HISTORY_CACHE_MAX = 8000;

type Row = { url: string; title: string; last_visit: number; visit_count: number };
type Visit = { url?: string | undefined; title?: string | undefined; lastVisitTime?: number | undefined; visitCount?: number | undefined };
type Change = { kind: "visited"; visit: Visit } | { kind: "title"; url: string; title: string } | { kind: "removed"; urls: readonly string[] } | { kind: "cleared" };

export type HistoryCacheDeps = {
  search: (max: number) => Promise<readonly Visit[]>;
  // Whether `history.search` lists the address. `onVisited` also fires for hidden pages (redirect sources, framed links) that the search leaves out.
  listed: (url: string) => Promise<boolean>;
  max: number;
};

const row_of = (visit: Visit): Row | undefined => (visit.url ? { url: visit.url, title: visit.title ?? "", last_visit: visit.lastVisitTime ?? 0, visit_count: visit.visitCount ?? 1 } : undefined);

export function create_history_cache(deps: HistoryCacheDeps) {
  // Newest first. `by_url` holds the same rows, so an event finds its row without a scan.
  let rows: Row[] = [];
  const by_url = new Map<string, Row>();
  let state: "empty" | "filling" | "ready" = "empty";
  // Events that arrive while the fill runs. The fill result is older than they are, so they apply after it, in arrival order.
  let pending: Change[] = [];
  // True while `drain` runs. Events that arrive then queue behind it, so the order holds across the awaits.
  let draining: Promise<void> | undefined;

  const drop = (url: string) => {
    const old = by_url.get(url);
    if (!old) return;
    by_url.delete(url);
    rows.splice(rows.indexOf(old), 1);
  };

  const apply = (change: Change) => {
    if (change.kind === "cleared") {
      rows = [];
      by_url.clear();
    } else if (change.kind === "removed") change.urls.forEach(drop);
    else if (change.kind === "title") {
      const row = by_url.get(change.url);
      if (row) row.title = change.title;
    } else {
      const fresh = row_of(change.visit);
      if (!fresh) return;
      const old = by_url.get(fresh.url);
      // A visit the fill already holds, or an older one that arrives late, must not push the row back.
      if (old && old.last_visit > fresh.last_visit) return;
      if (old) {
        if (!change.visit.title) fresh.title = old.title;
        drop(fresh.url);
      }
      // The newest visit lands at the front, so the scan ends at once.
      let index = rows.findIndex((row) => row.last_visit <= fresh.last_visit);
      if (index < 0) index = rows.length;
      rows.splice(index, 0, fresh);
      by_url.set(fresh.url, fresh);
      if (rows.length > deps.max) drop(rows[rows.length - 1]!.url);
    }
  };

  const fill = async () => {
    state = "filling";
    try {
      const found = await deps.search(deps.max);
      rows = [];
      by_url.clear();
      for (const visit of found) {
        const row = row_of(visit);
        if (row && !by_url.has(row.url)) {
          rows.push(row);
          by_url.set(row.url, row);
        }
      }
      rows.sort((left, right) => right.last_visit - left.last_visit);
      await drain();
      state = "ready";
    } catch {
      // A failed search leaves the next read to try again. The events held are lost with it, and the new search sees their pages.
      pending = [];
      state = "empty";
    }
  };

  // An address the cache has not seen waits for the search to list it. A search that fails leaves the page out until the next start.
  const needs_check = (change: Change) => change.kind === "visited" && !!change.visit.url && !by_url.has(change.visit.url);

  const drain = (): Promise<void> => {
    draining ??= (async () => {
      while (pending.length > 0) {
        const change = pending.shift()!;
        if (needs_check(change) && !(await deps.listed((change as { visit: { url: string } }).visit.url).catch(() => false))) continue;
        apply(change);
      }
    })().finally(() => (draining = undefined));
    return draining;
  };

  const on = (change: Change) => {
    if (state === "empty") return; // The fill that comes next reads the browser after this event.
    if (state === "filling" || draining || needs_check(change)) {
      pending.push(change);
      if (state === "ready") void drain();
    } else apply(change);
  };

  return {
    // Fills the cache. A call during a fill or after it does nothing.
    start: async (): Promise<void> => {
      if (state === "empty") await fill();
    },
    // The rows, newest first, or undefined while the fill has not ended. A read before then starts a fill when none runs.
    read: (): readonly Row[] | undefined => {
      if (state === "empty") void fill();
      return state === "ready" ? rows : undefined;
    },
    // Resolves when the events held so far have applied.
    idle: async (): Promise<void> => {
      await draining;
    },
    visited: (visit: Visit) => on({ kind: "visited", visit }),
    title_changed: ({ url, title }: { url: string; title: string }) => on({ kind: "title", url, title }),
    visit_removed: ({ allHistory, urls }: { allHistory: boolean; urls: readonly string[] }) => on(allHistory ? { kind: "cleared" } : { kind: "removed", urls }),
  };
}

// Marked pure so a bundle that never reads the cache (the new tab page) drops it.
export const history_cache = /* @__PURE__ */ create_history_cache({
  search: (max) => browser.history.search({ text: "", startTime: 0, maxResults: max }),
  max: HISTORY_CACHE_MAX,
  listed: async (url) => (await browser.history.search({ text: url, startTime: 0, maxResults: 20 })).some((item) => item.url === url),
});

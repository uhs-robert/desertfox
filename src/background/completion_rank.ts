// The rows of `open`, `history` and the finder, built from one line's inputs and the history, then ranked for each word. Pure: the rank Worker runs it (`rank_index.ts`), and so do the tests.
// A snapshot builds its candidate rows once per line and list, so a keystroke only ranks.

import { encode_ref } from "../shared/anything_ref.ts";
import type { AnythingRef } from "../shared/anything_ref.ts";
import type { AnythingItems, BookmarkItem, Boosted, ClosedTabRow, HistoryItem, HistoryItems, OpenItems, OpenRow, SiteItem } from "../shared/messages/content.ts";
import { MAX_SITE_ROWS, RECENT_BOOKMARKS, RECENT_CLOSED } from "../shared/rank_port.ts";
import type { FinderExtras, WireRow } from "../shared/rank_port.ts";
import { one_line, SKIPPED_SCHEMES } from "../shared/completion/tab_rows.ts";
import { MAX_BOOST, rank_top, score_candidate } from "../shared/score.ts";

export type HistoryNode = { title?: string | undefined; url?: string | undefined; visit_count?: number | undefined; last_visit?: number | undefined };

// The usage boost: half from how often a page was visited and half from how recently. Firefox gives only the count and the last visit per page, not the visit list its own frecency reads.
// The count weighs by its log, so the 50th visit adds little over the 10th, and the recency halves every two weeks.
const COUNT_WEIGHT = MAX_BOOST / 2;
const RECENCY_WEIGHT = MAX_BOOST / 2;
const FULL_COUNT = 50;
const RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
// An open tab is a page in use now. Its own visits add to this, up to `MAX_BOOST`.
export const OPEN_TAB_BOOST = 0.3;

// Two decimals: the rank needs no more, and the page gets only the top rows of each answer.
export const rounded_boost = (boost: number) => Math.round(Math.min(MAX_BOOST, boost) * 100) / 100;

export function usage_boost(visit_count: number, last_visit: number, now: number): number {
  const count = Math.min(1, Math.log1p(Math.max(0, visit_count)) / Math.log1p(FULL_COUNT));
  // A last visit of 0 is unknown, so its recency is 0. A clock set back must not raise it past 1.
  const recency = last_visit > 0 ? 0.5 ** (Math.max(0, now - last_visit) / RECENCY_HALF_LIFE_MS) : 0;
  return rounded_boost(COUNT_WEIGHT * count + RECENCY_WEIGHT * recency);
}

export const boosted = (boost: number | undefined): Boosted => (boost ? { boost } : {});

// The boost of each visited address, for rows from other sources that show the same page.
export type Usage = ReadonlyMap<string, number>;

export const usage_by_url = (history: readonly HistoryItem[]): Usage => new Map(history.flatMap((item) => (item.boost ? [[item.url, item.boost]] : [])));

export const with_usage = <Item extends { url: string }>(items: readonly Item[], usage: Usage): (Item & Boosted)[] => items.map((item) => ({ ...item, ...boosted(usage.get(item.url)) }));

// Newest first, as `history.search` gives them. Skipped schemes drop out.
export function history_items(nodes: readonly HistoryNode[], now = Date.now()): HistoryItem[] {
  return nodes
    .filter((node): node is HistoryNode & { url: string } => !!node.url && !SKIPPED_SCHEMES.test(node.url))
    .map((node) => ({ title: one_line(node.title || node.url), url: node.url, ...boosted(usage_boost(node.visit_count ?? 0, node.last_visit ?? 0, now)) }));
}

const WEB_ADDRESS = /^(https?):\/\/([^/?#]+)/i;

// The home page of every visited web host, with the visits of all its pages, the busiest first. http and https pages of a host count as one, at the scheme of its newest page.
// A host whose home page is already in `listed`, at either scheme, is left out: that row stands for it.
export function site_items(nodes: readonly HistoryNode[], listed: ReadonlySet<string>, now = Date.now()): SiteItem[] {
  const hosts = new Map<string, { scheme: string; visit_count: number; last_visit: number }>();
  for (const node of nodes) {
    const [, scheme, host] = node.url?.match(WEB_ADDRESS) ?? [];
    if (!scheme || !host) continue;
    const key = host.toLowerCase();
    const last_visit = node.last_visit ?? 0;
    const known = hosts.get(key) ?? { scheme: scheme.toLowerCase(), visit_count: 0, last_visit };
    hosts.set(key, {
      scheme: last_visit > known.last_visit ? scheme.toLowerCase() : known.scheme,
      visit_count: known.visit_count + (node.visit_count ?? 1),
      last_visit: Math.max(known.last_visit, last_visit),
    });
  }
  return [...hosts]
    .filter(([host]) => !listed.has(`https://${host}/`) && !listed.has(`http://${host}/`))
    .map(([host, site]) => ({ url: `${site.scheme}://${host}/`, boost: usage_boost(site.visit_count, site.last_visit, now) }))
    .sort((left, right) => right.boost - left.boost);
}

export type OpenSource = "bookmarks" | "history";

export type OpenSettings = { sources: readonly OpenSource[]; history_max: number };

// Rows in the order of `sources`. A history row whose address is a bookmark drops out, so the address shows once, as the bookmark, which takes the history row's boost.
export function open_rows(sources: readonly OpenSource[], bookmarks: readonly BookmarkItem[], history: readonly HistoryItem[]): OpenRow[] {
  const bookmarked = new Set(bookmarks.map((bookmark) => bookmark.url));
  const groups: Record<OpenSource, OpenRow[]> = {
    bookmarks: with_usage(bookmarks, usage_by_url(history)).map((bookmark) => ({ ...bookmark, tag: "bm" })),
    history: history.filter((item) => !bookmarked.has(item.url)).map((item) => ({ ...item, tag: "hist" })),
  };
  return sources.flatMap((source) => groups[source]);
}


// What the background reads for one line's list: everything but the history, which only the Worker holds.
// The bookmarks are `bookmark_items` rows, and the tabs are the open tabs of the line's privacy.
export type RankInputs =
  | { source: "open"; incognito: boolean; sources: readonly OpenSource[]; history_max: number; bookmarks: BookmarkItem[] }
  | { source: "history"; incognito: boolean; max: number }
  | { source: "anything"; incognito: boolean; quickmarks: Record<string, string>; bookmarks: BookmarkItem[]; closed: ClosedTabRow[]; tabs: { id: number; url: string }[]; tab_used: Record<number, number>; history_max: number };

// The inputs of a list whose read failed: the history alone.
export const no_inputs = (source: RankInputs["source"], incognito: boolean): RankInputs =>
  source === "open" ? { source, incognito, sources: ["history"], history_max: 0, bookmarks: [] } : source === "history" ? { source, incognito, max: 0 } : { source, incognito, quickmarks: {}, bookmarks: [], closed: [], tabs: [], tab_used: {}, history_max: 0 };

// Firefox records no private visit, so a private line ranks none of the normal history.
export const reads_history = (inputs: RankInputs): boolean => !inputs.incognito && (inputs.source !== "open" || inputs.sources.includes("history"));

// The history rows only: bookmarks claim their addresses, and the rest of the visited hosts become site rows.
export function open_items(inputs: Extract<RankInputs, { source: "open" }>, visits: readonly HistoryNode[]): OpenItems {
  const rows = open_rows(inputs.sources, inputs.bookmarks, history_items(visits));
  return { rows, history_max: inputs.history_max, sites: site_items(visits, new Set(rows.map((row) => row.url))) };
}

export const history_list = (inputs: Extract<RankInputs, { source: "history" }>, visits: readonly HistoryNode[]): HistoryItems => ({ rows: history_items(visits), max: inputs.max });

// Everything the finder lists but the open tabs, which the page takes from the tab model.
export function anything_items(inputs: Extract<RankInputs, { source: "anything" }>, visits: readonly HistoryNode[]): AnythingItems {
  const history = history_items(visits);
  const usage = usage_by_url(history);
  const quickmark_rows = Object.entries(inputs.quickmarks).sort(([left], [right]) => (left < right ? -1 : 1)).map(([key, url]) => ({ key, url }));
  const listed = new Set([...quickmark_rows, ...inputs.bookmarks, ...history].map((row) => row.url));
  return {
    tab_used: inputs.tab_used,
    tab_boost: Object.fromEntries(inputs.tabs.map((tab) => [tab.id, rounded_boost(OPEN_TAB_BOOST + (usage.get(tab.url) ?? 0))])),
    sites: site_items(visits, listed),
    quickmarks: with_usage(quickmark_rows, usage),
    bookmarks: with_usage(inputs.bookmarks, usage),
    history,
    closed: with_usage(inputs.closed, usage),
    history_max: inputs.history_max,
  };
}

const MIN_SITE_WORD = 2;

// `https://github.com/` gives `github.com`.
export const host_of = (site: SiteItem): string => site.url.slice(site.url.indexOf("//") + 2, -1);

// The bare-site rows: the home page of a visited host, so `git` offers github.com before any one page of it.
// The word must start a label of the host, so `git` finds github.com and not digital.com, and one word only, as a host has no space. The sites come busiest first, so the cap keeps those.
export function matching_sites(word: string, sites: readonly SiteItem[], listed: (url: string) => boolean, max = MAX_SITE_ROWS): SiteItem[] {
  const typed = word.trim().toLowerCase();
  if (typed.length < MIN_SITE_WORD || /\s/.test(typed)) return [];
  const found: SiteItem[] = [];
  for (const site of sites) {
    if (found.length >= max) break;
    if (`.${host_of(site)}`.includes(`.${typed}`) && !listed(site.url)) found.push(site);
  }
  return found;
}

// A candidate row as the page will build it: `description` is the address.
type CandidateRow = { name: string; description: string; tag?: string; ref?: string; boost?: number; also_named?: string[] };

// `boost` and `also_named` go along only when the row has them, so the page rebuilds the row it would have built itself.
const wire = (row: CandidateRow & { positions: number[]; score: number }): WireRow => ({
  name: row.name,
  url: row.description,
  score: row.score,
  positions: row.positions,
  ...(row.tag === undefined ? {} : { tag: row.tag }),
  ...(row.ref === undefined ? {} : { ref: row.ref }),
  ...("boost" in row ? { boost: row.boost as number } : {}),
  ...(row.also_named === undefined ? {} : { also_named: row.also_named }),
});

const unranked = (rows: readonly CandidateRow[]): WireRow[] => rows.map((row) => wire({ ...row, positions: [], score: 0 }));

export type Ranking = { rows: WireRow[]; finder?: FinderExtras };

export type Snapshot = { partial: boolean; rank: (word: string, limit: number, over_fetch: number) => Ranking };

const has_word = (word: string) => word.trim() !== "";

function open_snapshot(items: OpenItems): Snapshot["rank"] {
  const rows = items.rows.map((row): CandidateRow => ({ name: row.title, description: row.url, tag: row.tag, ...(row.boost ? { boost: row.boost } : {}) }));
  // An equal score keeps the group order of the setting, with the site rows last.
  const group_order: (string | undefined)[] = [...new Set(rows.map((row) => row.tag)), "site"];
  return (word, limit) => {
    if (has_word(word)) {
      // The background already left out a site whose home page is a row.
      const sites = matching_sites(word, items.sites, () => false).map((site): CandidateRow => ({ name: host_of(site), description: site.url, tag: "site", boost: site.boost }));
      return { rows: rank_top(word, [...rows, ...sites], (row) => group_order.indexOf(row.tag), limit).map(wire) };
    }
    // With no word, each group keeps its newest rows: 20 bookmarks and the history cap of the setting.
    const caps: Record<string, number> = { bm: RECENT_BOOKMARKS, hist: items.history_max };
    const shown: Record<string, number> = {};
    return { rows: unranked(rows.filter((row) => (shown[row.tag!] = (shown[row.tag!] ?? 0) + 1) <= (caps[row.tag!] ?? Infinity)).slice(0, limit)) };
  };
}

function history_snapshot(items: HistoryItems): Snapshot["rank"] {
  const rows = items.rows.map((row): CandidateRow => ({ name: row.title, description: row.url, ...(row.boost ? { boost: row.boost } : {}) }));
  return (word, limit) => ({ rows: has_word(word) ? rank_top(word, rows, () => 0, limit).map(wire) : unranked(rows.slice(0, Math.min(items.max, limit))) });
}

// The order an equal score keeps. A tab row, which the page ranks, has no tag.
const FOUND_GROUPS = [undefined, "qm", "bm", "hist", "closed", "site"];

const url_row = (title: string, url: string, tag: string, ref: AnythingRef, boost?: number): CandidateRow => ({ name: title, description: url, tag, ref: encode_ref(ref), ...(boost ? { boost } : {}) });

function anything_snapshot(items: AnythingItems): Snapshot["rank"] {
  // An address shows once, in the first group that holds it. A closed tab wins over the history row of its address, because Enter restores the tab with its state.
  // The open tabs are the page's, so a row an open tab holds still comes, and the page drops it.
  const seen = new Set<string>();
  const fresh = <Entry extends { url: string }>(entries: readonly Entry[]): Entry[] => entries.filter((entry) => !seen.has(entry.url) && seen.add(entry.url));
  // A quickmark's name is its key, so it takes the title of the bookmark or history row its address hides. Else a quickmarked page would match only by its address and sink below every title hit.
  // Bookmarks first, so a bookmark's own title wins over the history title.
  const marked = new Set(items.quickmarks.map((mark) => mark.url));
  const titles = new Map<string, string>();
  for (const entry of [...items.bookmarks, ...items.history]) if (marked.has(entry.url) && !titles.has(entry.url)) titles.set(entry.url, entry.title);
  const quickmarks = fresh(items.quickmarks).map((mark): CandidateRow => {
    const title = titles.get(mark.url);
    return { ...url_row(mark.key, mark.url, "qm", { kind: "page", url: mark.url }, mark.boost), ...(title === undefined ? {} : { also_named: [title] }) };
  });
  const bookmarks = fresh(items.bookmarks).map((bookmark) => url_row(bookmark.title, bookmark.url, "bm", { kind: "page", url: bookmark.url }, bookmark.boost));
  const closed = fresh(items.closed).map((entry) => url_row(entry.title, entry.url, "closed", { kind: "closed", session_id: entry.session_id }, entry.boost));
  const history = fresh(items.history).map((entry) => url_row(entry.title, entry.url, "hist", { kind: "page", url: entry.url }, entry.boost));
  const found = [...quickmarks, ...bookmarks, ...history, ...closed];
  const base = { tab_boost: items.tab_boost, tab_used: items.tab_used };
  return (word, limit, over_fetch) => {
    if (!has_word(word)) {
      // The page's recent rows skip an address a tab, a quickmark or a shown closed tab holds, so each group comes with that many more.
      const skipped = over_fetch + items.quickmarks.length;
      const recent = { quickmarks: items.quickmarks, closed: items.closed.slice(0, RECENT_CLOSED + skipped), history: items.history.slice(0, items.history_max + skipped + RECENT_CLOSED), history_max: items.history_max };
      return { rows: [], finder: { ...base, sites: [], recent } };
    }
    // The page drops a site a tab holds, then keeps the first `MAX_SITE_ROWS`.
    const sites = matching_sites(word, items.sites, (url) => seen.has(url), MAX_SITE_ROWS + over_fetch).flatMap((site) => {
      const row = url_row(host_of(site), site.url, "site", { kind: "page", url: site.url }, site.boost);
      const hit = score_candidate(word, row);
      return hit ? [wire({ ...row, ...hit })] : [];
    });
    return { rows: rank_top(word, found, (row) => FOUND_GROUPS.indexOf(row.tag), limit + over_fetch).map(wire), finder: { ...base, sites } };
  };
}

export type SourceItems = { source: "open"; items: OpenItems } | { source: "history"; items: HistoryItems } | { source: "anything"; items: AnythingItems };

// Builds the candidate rows of one list once. The ranking it returns runs per word.
export const ranking_of = (built: SourceItems): Snapshot["rank"] => (built.source === "open" ? open_snapshot(built.items) : built.source === "history" ? history_snapshot(built.items) : anything_snapshot(built.items));

// `partial` marks a snapshot built from the fallback rows while the history loaded.
export function snapshot_of(inputs: RankInputs, visits: readonly HistoryNode[], partial: boolean): Snapshot {
  const built: SourceItems =
    inputs.source === "open" ? { source: "open", items: open_items(inputs, visits) } : inputs.source === "history" ? { source: "history", items: history_list(inputs, visits) } : { source: "anything", items: anything_items(inputs, visits) };
  return { partial, rank: ranking_of(built) };
}

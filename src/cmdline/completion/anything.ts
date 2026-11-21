// The rows of the finder (`,,`): open tabs, quickmarks, bookmarks, history, recently closed tabs and visited sites, ranked as one list between the search rows.
// The strongest hit leads whatever its group, with use (visits, an open tab) raising a score. An equal score keeps that group order.
// The background ranks every group but the tabs (`background/completion_rank.ts`). The tabs come from the page's tab model, so they rank here and merge in by score. Pure.

import { encode_ref } from "../../shared/anything_ref.ts";
import type { AnythingRef } from "../../shared/anything_ref.ts";
import type { AnythingItems, EngineItem } from "../../shared/messages/content.ts";
import { MAX_SITE_ROWS, RANKED_ROWS, RECENT_CLOSED } from "../../shared/rank_port.ts";
import type { FinderExtras, RankedReply, WireRow } from "../../shared/rank_port.ts";
import { score_candidate } from "../../shared/score.ts";
import type { Ranked } from "../../shared/score.ts";
import type { Row } from "./sources.ts";
import { quote_word } from "./tokenize.ts";

// With no query the list shows every quickmark, then this many recent tabs, `history_max` history rows and `RECENT_CLOSED` closed tabs.
const RECENT_TABS = 8;

// The order an equal score keeps. A tab row has no tag.
const FOUND_GROUPS = [undefined, "qm", "bm", "hist", "closed", "site"];

export type FinderTab = { row: Row; url: string; id: number; last_used: number; current: boolean };

export type FinderInput = {
  word: string;
  usage: string;
  tabs: readonly FinderTab[];
  reply: RankedReply;
  engines: readonly EngineItem[];
};

// The row the list shows for a ranked row from the background. The name, positions, tag, reference and boost carry over as they are.
export const row_of_wire = ({ url, score, also_named, ...kept }: WireRow, usage: string): Ranked<Row> => ({ ...kept, insert: `${quote_word(url)} `, description: url, args: "", also_named: also_named ?? [], keywords: [], usage });

const url_row = (title: string, url: string, tag: string, ref: AnythingRef, usage: string, boost?: number): Row => ({
  name: title,
  insert: `${quote_word(url)} `,
  description: url,
  args: "",
  also_named: [],
  keywords: [],
  usage,
  tag,
  ref: encode_ref(ref),
  ...(boost ? { boost } : {}),
});

// The first word is an engine's keyword and a space and more text follow. The comparison is case-sensitive, as the keyword is.
function keyword_engine(word: string, engines: readonly EngineItem[]): { engine: EngineItem; query: string } | undefined {
  const [first, ...rest] = word.split(/\s+/);
  const query = word.slice(word.indexOf(first as string) + (first as string).length).trim();
  if (rest.length === 0 || query === "") return undefined;
  const engine = engines.find((candidate) => candidate.available && candidate.keyword !== undefined && candidate.keyword === first);
  return engine && { engine, query };
}

function search_rows(word: string, engines: readonly EngineItem[], usage: string): { keyword?: Row; fallback: Row } {
  const typed = word.trim();
  const keyword = keyword_engine(word.trimStart(), engines);
  const base = { insert: word, args: "", also_named: [], keywords: [], usage, tag: "search" };
  return {
    ...(keyword ? { keyword: { ...base, name: `${keyword.engine.label}: ${keyword.query}`, description: keyword.engine.name, ref: encode_ref({ kind: "engine", engine: keyword.engine.name, query: keyword.query }) } } : {}),
    fallback: { ...base, name: `Search: ${typed}`, description: "default engine", ref: encode_ref({ kind: "web", query: typed }) },
  };
}

const tab_with_ref = (tab: FinderTab, boost?: number): Row => ({ ...tab.row, ref: encode_ref({ kind: "tab", id: tab.id }), ...(boost ? { boost } : {}) });
const closed_row = (entry: AnythingItems["closed"][number], usage: string) => url_row(entry.title, entry.url, "closed", { kind: "closed", session_id: entry.session_id }, usage, entry.boost);
const history_row = (entry: AnythingItems["history"][number], usage: string) => url_row(entry.title, entry.url, "hist", { kind: "page", url: entry.url }, usage, entry.boost);
const quickmark_row = (mark: AnythingItems["quickmarks"][number], usage: string) => url_row(mark.key, mark.url, "qm", { kind: "page", url: mark.url }, usage, mark.boost);

// Only the rows the list shows claim an address, so a page that a hidden group also holds still shows. The line's own tab claims its address, so its page is not offered again.
// A closed tab claims its address before history, so it wins over the history row.
function recent_rows(usage: string, tabs: readonly FinderTab[], items: NonNullable<FinderExtras["recent"]>): Row[] {
  const seen = new Set(tabs.filter((tab) => tab.current).map((tab) => tab.url));
  // Stops at `limit`, so a row past the cap claims nothing.
  const shown = <Entry extends { url: string }>(entries: readonly Entry[], limit: number): Entry[] => {
    const kept: Entry[] = [];
    for (const entry of entries) {
      if (kept.length >= limit) break;
      if (!seen.has(entry.url)) kept.push(entry) && seen.add(entry.url);
    }
    return kept;
  };
  const claim = <Entry extends { url: string }>(entries: readonly Entry[]) => entries.forEach((entry) => seen.add(entry.url));
  const recent_tabs = tabs.filter((tab) => !tab.current).sort((left, right) => right.last_used - left.last_used).slice(0, RECENT_TABS);
  claim(recent_tabs);
  const quickmarks = shown(items.quickmarks, Infinity);
  const closed = shown(items.closed, RECENT_CLOSED);
  const history = shown(items.history, items.history_max);
  return [...quickmarks.map((mark) => quickmark_row(mark, usage)), ...recent_tabs.map(tab_with_ref), ...history.map((entry) => history_row(entry, usage)), ...closed.map((entry) => closed_row(entry, usage))];
}

const NO_RECENT: NonNullable<FinderExtras["recent"]> = { quickmarks: [], closed: [], history: [], history_max: 0 };

type Merged = { row: Ranked<Row>; score: number; group: number; order: number };

export function anything_ranked({ word, usage, tabs, reply, engines }: FinderInput): Ranked<Row>[] {
  const as_ranked = (rows: Row[]): Ranked<Row>[] => rows.map((row) => ({ ...row, positions: [] }));
  const finder = reply.finder ?? { tab_boost: {}, tab_used: {}, sites: [] };
  if (word.trim() === "") return as_ranked(recent_rows(usage, tabs, finder.recent ?? NO_RECENT));

  // An address shows once, and an open tab holds it first. The background sent enough more rows to make up for the ones dropped here.
  const tab_urls = new Set(tabs.map((tab) => tab.url));
  const found: Merged[] = tabs.flatMap((tab, order) => {
    const row = tab_with_ref(tab, finder.tab_boost[tab.id]);
    const hit = score_candidate(word, row);
    return hit ? [{ row: { ...row, positions: hit.positions }, score: hit.score, group: 0, order }] : [];
  });
  const from_background = (rows: readonly WireRow[]): Merged[] => rows.filter((wire) => !tab_urls.has(wire.url)).map((wire, order) => ({ row: row_of_wire(wire, usage), score: wire.score, group: FOUND_GROUPS.indexOf(wire.tag), order }));
  found.push(...from_background(reply.rows), ...from_background(finder.sites).slice(0, MAX_SITE_ROWS));
  // As `rank` breaks ties: the group, then the shorter name, then the order each group came in.
  found.sort((left, right) => right.score - left.score || left.group - right.group || left.row.name.length - right.row.name.length || left.order - right.order);
  // The keyword row goes first, so the highlighted row and Enter search the engine the user named.
  const { keyword, fallback } = search_rows(word, engines, usage);
  return [...as_ranked(keyword ? [keyword] : []), ...found.slice(0, RANKED_ROWS).map((merged) => merged.row), ...as_ranked([fallback])];
}

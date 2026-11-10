// The rows of the finder (`,,`): open tabs, quickmarks, bookmarks, history, recently closed tabs, then the search rows, in that order.
// Each group ranks on its own and the groups stay in that order, so a weak hit in a higher group sits above a strong hit in a lower one. Pure.

import { encode_ref } from "../../shared/anything_ref.ts";
import type { AnythingRef } from "../../shared/anything_ref.ts";
import type { AnythingItems, EngineItem } from "../../shared/messages.ts";
import { rank } from "../../shared/score.ts";
import type { Ranked } from "../../shared/score.ts";
import type { Row } from "./sources.ts";
import { quote_word } from "./tokenize.ts";

// With no query the list shows every quickmark, then this many recent tabs, `history_max` history rows and this many closed tabs.
const RECENT_TABS = 8;
const RECENT_CLOSED = 5;

export type FinderTab = { row: Row; url: string; id: number; last_used: number; current: boolean };

export type FinderInput = {
  word: string;
  usage: string;
  tabs: readonly FinderTab[];
  items: AnythingItems;
  engines: readonly EngineItem[];
};

const url_row = (title: string, url: string, tag: string, ref: AnythingRef, usage: string): Row => ({
  name: title,
  insert: `${quote_word(url)} `,
  description: url,
  args: "",
  also_named: [],
  keywords: [],
  usage,
  tag,
  ref: encode_ref(ref),
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

const tab_with_ref = (tab: FinderTab): Row => ({ ...tab.row, ref: encode_ref({ kind: "tab", id: tab.id }) });
const closed_row = (entry: AnythingItems["closed"][number], usage: string) => url_row(entry.title, entry.url, "closed", { kind: "closed", session_id: entry.session_id }, usage);
const history_row = (entry: AnythingItems["history"][number], usage: string) => url_row(entry.title, entry.url, "hist", { kind: "page", url: entry.url }, usage);
const quickmark_row = (mark: AnythingItems["quickmarks"][number], usage: string) => url_row(mark.key, mark.url, "qm", { kind: "page", url: mark.url }, usage);

// Only the rows the list shows claim an address, so a page that a hidden group also holds still shows. The line's own tab claims its address, so its page is not offered again.
// A closed tab claims its address before history, so it wins over the history row.
function recent_rows({ usage, tabs, items }: Omit<FinderInput, "word" | "engines">): Row[] {
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

export function anything_ranked({ word, usage, tabs, items, engines }: FinderInput): Ranked<Row>[] {
  const as_ranked = (rows: Row[]): Ranked<Row>[] => rows.map((row) => ({ ...row, positions: [] }));
  if (word.trim() === "") return as_ranked(recent_rows({ usage, tabs, items }));

  // An address shows once, in the first group that holds it. A closed tab wins over the history row of its address, because Enter restores the tab with its state.
  const seen = new Set(tabs.map((tab) => tab.url));
  const fresh = <Entry extends { url: string }>(entries: readonly Entry[]): Entry[] => entries.filter((entry) => !seen.has(entry.url) && seen.add(entry.url));
  const quickmarks = fresh(items.quickmarks).map((mark) => quickmark_row(mark, usage));
  const bookmarks = fresh(items.bookmarks).map((bookmark) => url_row(bookmark.title, bookmark.url, "bm", { kind: "page", url: bookmark.url }, usage));
  const closed = fresh(items.closed).map((entry) => closed_row(entry, usage));
  const history = fresh(items.history).map((entry) => history_row(entry, usage));
  // The keyword row goes first, so the highlighted row and Enter search the engine the user named.
  const { keyword, fallback } = search_rows(word, engines, usage);
  return [...as_ranked(keyword ? [keyword] : []), ...rank(word, tabs.map(tab_with_ref)), ...rank(word, quickmarks), ...rank(word, bookmarks), ...rank(word, history), ...rank(word, closed), ...as_ranked([fallback])];
}

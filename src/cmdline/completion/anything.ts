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

function search_rows(word: string, engines: readonly EngineItem[], usage: string): Row[] {
  const typed = word.trim();
  if (typed === "") return [];
  const keyword = keyword_engine(word.trimStart(), engines);
  const base = { insert: word, args: "", also_named: [], keywords: [], usage, tag: "search" };
  return [
    ...(keyword ? [{ ...base, name: `${keyword.engine.label}: ${keyword.query}`, description: keyword.engine.name, ref: encode_ref({ kind: "engine", engine: keyword.engine.name, query: keyword.query }) }] : []),
    { ...base, name: `Search: ${typed}`, description: "default engine", ref: encode_ref({ kind: "web", query: typed }) },
  ];
}

export function anything_ranked({ word, usage, tabs, items, engines }: FinderInput): Ranked<Row>[] {
  // An address shows once, in the first group that holds it. The line's own tab keeps its address in the set, so its page is not offered again.
  const seen = new Set(tabs.map((tab) => tab.url));
  const fresh = <Entry extends { url: string }>(entries: readonly Entry[]): Entry[] => entries.filter((entry) => !seen.has(entry.url) && seen.add(entry.url));
  const quickmarks = fresh(items.quickmarks).map((mark) => url_row(mark.key, mark.url, "qm", { kind: "page", url: mark.url }, usage));
  const bookmarks = fresh(items.bookmarks).map((bookmark) => url_row(bookmark.title, bookmark.url, "bm", { kind: "page", url: bookmark.url }, usage));
  const history = fresh(items.history).map((entry) => url_row(entry.title, entry.url, "hist", { kind: "page", url: entry.url }, usage));
  const closed = fresh(items.closed).map((entry) => url_row(entry.title, entry.url, "closed", { kind: "closed", session_id: entry.session_id }, usage));
  const as_ranked = (rows: Row[]): Ranked<Row>[] => rows.map((row) => ({ ...row, positions: [] }));

  if (word.trim() === "") {
    const recent_tabs = tabs.filter((tab) => !tab.current).sort((left, right) => right.last_used - left.last_used).slice(0, RECENT_TABS);
    return as_ranked([...quickmarks, ...recent_tabs.map((tab) => ({ ...tab.row, ref: encode_ref({ kind: "tab", id: tab.id }) })), ...history.slice(0, items.history_max), ...closed.slice(0, RECENT_CLOSED)]);
  }
  const tab_rows = tabs.map((tab) => ({ ...tab.row, ref: encode_ref({ kind: "tab", id: tab.id }) }));
  return [...rank(word, tab_rows), ...rank(word, quickmarks), ...rank(word, bookmarks), ...rank(word, history), ...rank(word, closed), ...as_ranked(search_rows(word, engines, usage))];
}

// The port between the command line page and the background for the lists that rank the history: `open`, `history` and the finder.
// The page sends the typed word and gets back only the top rows, ranked where the history lives.
import type { AnythingItems } from "./messages.ts";

export const RANK_PORT_NAME = "desertfox_rank";

// The rows a reply holds at most. The finder asks for more by `over_fetch`, see `RankRequest`.
export const RANKED_ROWS = 100;

// The bare-site rows a list shows at most.
export const MAX_SITE_ROWS = 3;

// With no word typed, `open` and `bookmark` show this many of the newest bookmarks, and the finder this many closed tabs.
export const RECENT_BOOKMARKS = 20;
export const RECENT_CLOSED = 5;

export type RankSource = "open" | "history" | "anything";

// `seq` counts up per line, so the page can drop a reply it no longer waits for.
// `over_fetch` is the finder's count of distinct open-tab addresses: the page drops a ranked row that an open tab holds, so the background sends that many more.
export type RankRequest = { type: "rank"; seq: number; source: RankSource; word: string; limit: number; over_fetch: number };

// One ranked row. `url` fills the description and the inserted text. `score` lets the finder merge its tab rows in exactly.
// `boost`, `tag`, `ref` and `also_named` are present only on rows that have them.
export type WireRow = { name: string; url: string; score: number; positions: number[]; tag?: string; ref?: string; boost?: number; also_named?: string[] };

// What the finder ranks in the page: the open tabs, by their use, and the empty query's recent rows, which depend on the tabs.
export type FinderExtras = {
  tab_boost: AnythingItems["tab_boost"];
  tab_used: AnythingItems["tab_used"];
  // The site rows that match, in site order and not ranked: the page drops those a tab holds and keeps the first `MAX_SITE_ROWS`.
  sites: WireRow[];
  // With no word typed, the newest of each group, enough of them that the page's own dedup against the tabs still fills its caps.
  recent?: Pick<AnythingItems, "quickmarks" | "closed" | "history" | "history_max">;
};

// `partial`: the history was still loading, so the rows came from the newest 1000 pages. A `stale` push follows once it has loaded.
// `skipped`: a newer request from the line replaced this one before it ran.
// `failed`: building or ranking the list threw. The rows are empty, so the line stops waiting for them, and the page does not keep the answer.
export type RankedReply = { type: "ranked"; seq: number; rows: WireRow[]; partial: boolean; skipped?: true; failed?: true; finder?: FinderExtras };

export type RankPush = RankedReply | { type: "stale" };

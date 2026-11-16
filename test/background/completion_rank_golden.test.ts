// The ranked rows of `open`, `history` and the finder over a seeded 8000-row history, pinned as hashes. A change to where or how
// these lists rank must give the same first 100 rows, positions and boosts included. UPDATE_GOLDEN=1 rewrites the file after an intended change.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mock, test } from "node:test";
import { create_complete_items } from "../../src/background/complete_items.ts";
import type { CompleteItemsDeps } from "../../src/background/complete_items.ts";
import { create_live_source } from "../../src/cmdline/completion/live.ts";
import { create_completer } from "../../src/cmdline/completion/sources.ts";
import type { Row } from "../../src/cmdline/completion/sources.ts";
import { create_word_lookup } from "../../src/cmdline/word_lookup.ts";
import type { CommandMeta } from "../../src/shared/command.ts";
import type { CompleteItemsAnswer, EngineItem, TabItem } from "../../src/shared/messages.ts";
import { FIXTURE_NOW, history_fixture } from "../support/history_fixture.ts";
import { rank_pipeline, visit_of } from "../support/rank_pipeline.ts";

const GOLDEN_PATH = new URL("./completion_rank_golden.json", import.meta.url);
const SHOWN = 100;

const WHERE = { name: "where", type: "enum", values: ["here", "tab", "background", "window"], default: "here" } as const;
const COMMANDS: CommandMeta[] = [
  { id: "open.url", name: "open", label: "Open", intent: "Open a page.", params: [{ name: "url", type: "string", rest: true, main: true, values: { from: "open" } }, WHERE] },
  { id: "history.open", name: "history", label: "History", intent: "Open a history entry.", params: [{ name: "entry", type: "string", rest: true, main: true, values: { from: "history" } }, WHERE] },
  { id: "open.anything", name: "anything", label: "Find anything", intent: "Find a page.", params: [{ name: "query", type: "string", rest: true, main: true, values: { from: "anything" } }, WHERE] },
];
const ENGINES: EngineItem[] = [
  { name: "duck", label: "DuckDuckGo", available: true },
  { name: "github", label: "GitHub", available: true, keyword: "gh" },
];

// Single letters, prefixes typed one key at a time, several terms, misses, exact names, case, a final dot, quickmark keys, addresses and a keyword engine.
const QUERIES = [
  "", " ", "f", "fi", "fir", "fire", "firef", "firefox", "g", "gi", "git", "github", "github rust", "rust async", "mdn async iter", "zzzq", "qqqqqq", "rust.", "Rust", "RUST",
  "docs", "docs.rs", "Docs.rs", "GitHub", "https", "github.com/", "bm", "bookmark 12", "closed", "tab", "tab close", "café", "zürich", "z", "m", "r", "worker port", "hist", "gh rust", "wiki arch linux",
];
const SOURCES = ["open", "history", "anything"] as const;

// Sorted keys, so the hash pins the content and not the order fields were written in.
const canonical = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1)).map(([key, inner]) => [key, canonical(inner)])) : value;

// The list shows at most the first 100 rows, so only those are pinned.
const digest = (rows: readonly Row[]): { count: number; sha256: string } => {
  const shown = rows.slice(0, SHOWN);
  return { count: shown.length, sha256: createHash("sha256").update(JSON.stringify(canonical(shown))).digest("hex") };
};

const fixture = history_fixture();
const LINE = { tab_id: 1, frame_id: 0, window_id: 1, incognito: false };
const TAB_ITEMS: TabItem[] = fixture.tabs.map((tab, index) => ({ id: tab.id, number: index + 1, title: tab.title, url: tab.url, window_number: 1, ...(tab.active ? { active: true as const } : {}) }));

function items_service() {
  const deps = {
    query_tabs: async () => fixture.tabs.map((tab, index) => ({ id: tab.id, index, windowId: 1, title: tab.title, url: tab.url, incognito: false, lastAccessed: tab.last_used })),
    all_bookmarks: async () => fixture.bookmarks,
    quickmark_table: async () => fixture.quickmarks,
    closed_tabs: async () => fixture.closed,
    open_settings: async () => ({ sources: ["bookmarks", "history"] as const, history_max: 10 }),
    history_list_max: async () => 20,
    is_opener: async () => true,
    search_engines: async () => ({}),
    page_of: async () => undefined,
  } as unknown as CompleteItemsDeps;
  return create_complete_items(deps);
}

// The page ranks nothing of these lists: it asks the background, which relays to the Worker that holds the history.
async function rank_all(): Promise<Record<string, { count: number; sha256: string }>> {
  const service = items_service();
  const pipeline = rank_pipeline({ history: () => fixture.history.map(visit_of), inputs: service.rank_inputs });
  pipeline.service.start();
  const live = create_live_source({
    ask: async () => ({ items: ENGINES }) as CompleteItemsAnswer,
    tabs: () => TAB_ITEMS,
    all_tabs: () => TAB_ITEMS,
    groups: () => [],
    on_ready: () => {},
  });
  const complete = create_completer(create_word_lookup(COMMANDS, {}), COMMANDS, {}, { search_engines: [], containers: [] }, "normal", live, [], pipeline.line().client);
  const result: Record<string, { count: number; sha256: string }> = {};
  // The history fills first, so no answer comes from the partial fallback.
  await pipeline.settle();
  for (const source of SOURCES) {
    for (const word of QUERIES) {
      const line = `${source} ${word}`;
      for (let tries = 0; complete(line, line.length).loading; tries++) {
        assert.ok(tries < 3, `the ${line} rows never landed`);
        await pipeline.settle();
      }
      result[`${source} ${JSON.stringify(word)}`] = digest(complete(line, line.length).rows);
    }
  }
  return result;
}

test("open, history and the finder rank the seeded history as pinned", async () => {
  mock.timers.enable({ apis: ["Date"], now: FIXTURE_NOW });
  try {
    const ranked = await rank_all();
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN_PATH, `${JSON.stringify(ranked, null, 1)}\n`);
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as typeof ranked;
    assert.deepEqual(Object.keys(ranked), Object.keys(golden));
    for (const [query, pinned] of Object.entries(golden)) assert.deepEqual(ranked[query], pinned, `ranking changed for ${query}`);
  } finally {
    mock.timers.reset();
  }
});

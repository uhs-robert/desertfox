// Ranking at the history cap. The Worker ranks off the page, but a first key over 20,000 rows still has to stay a fraction of a second, and the cost has to grow with the rows and no faster.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { history_items, snapshot_of, usage_by_url } from "../../src/background/completion_rank.ts";
import { HISTORY_CACHE_MAX } from "../../src/background/history_cache.ts";
import { create_rank_index } from "../../src/background/rank_index.ts";
import type { FromWorker } from "../../src/background/rank_index.ts";
import { pick_entry } from "../../src/commands/open_target.ts";
import { rank, rank_top } from "../../src/shared/score.ts";
import { FIXTURE_NOW, history_fixture } from "../support/history_fixture.ts";
import { rank_pipeline, visit_of } from "../support/rank_pipeline.ts";

mock.timers.enable({ apis: ["Date"], now: FIXTURE_NOW });

const FIRST_KEY_MS = 80;
const LATER_KEY_MS = 60;
const MAX_GROWTH = 30;
const SHOWN = 100;

const median = (values: number[]) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!;

// Each word is ranked after a warm-up, so the compile of the scorer is not in the sample. CPU time rises under load too, so the limits sit at about 4 times the idle numbers and the ratio test is the main guard. The least of three medians drops a pass that a busy machine slowed.
const median_ms = (rank_word: (word: string) => unknown, words: readonly string[]): number => {
  rank_word(words[0]!);
  const one_pass = () =>
    median(
      words.map((word) => {
        const began = process.cpuUsage();
        rank_word(word);
        const used = process.cpuUsage(began);
        return (used.user + used.system) / 1000;
      }),
    );
  return Math.min(one_pass(), one_pass(), one_pass());
};

const history_snapshot = (rows: number) => snapshot_of({ source: "history", incognito: false, max: 20 }, history_fixture(rows).history, false);
const FIRST_KEYS = ["f", "g", "r", "t", "s", "m", "d"];
const LATER_KEYS = ["fi", "git", "rus", "tab", "sear", "mdn a", "docs"];

test("the cap is 20000 rows", () => assert.equal(HISTORY_CACHE_MAX, 20000));

test("rank_top gives the first rows of rank, in the same order", () => {
  const rows = history_fixture(2000).history.map((node) => ({ name: node.title ?? "", description: node.url ?? "" }));
  for (const word of [...FIRST_KEYS, ...LATER_KEYS]) {
    assert.deepEqual(
      rank_top(word, rows, () => 0, SHOWN).map(({ score: _score, ...row }) => row),
      rank(word, rows).slice(0, SHOWN),
    );
  }
});

test("a first key over 20000 rows stays under the first-key limit and the later keys under theirs", () => {
  const snapshot = history_snapshot(20000);
  assert.ok(snapshot.rank("f", SHOWN, 0).rows.length === SHOWN);
  const first = median_ms((word) => snapshot.rank(word, SHOWN, 0), FIRST_KEYS);
  const later = median_ms((word) => snapshot.rank(word, SHOWN, 0), LATER_KEYS);
  assert.ok(first < FIRST_KEY_MS, `first keys took ${first.toFixed(1)} ms`);
  assert.ok(later < LATER_KEY_MS, `later keys took ${later.toFixed(1)} ms`);
});

test("ten times the rows cost less than 30 times the time", () => {
  const small = history_snapshot(2000);
  const large = history_snapshot(20000);
  const words = [...FIRST_KEYS, ...LATER_KEYS];
  const ratio = median_ms((word) => large.rank(word, SHOWN, 0), words) / Math.max(median_ms((word) => small.rank(word, SHOWN, 0), words), 0.05);
  assert.ok(ratio < MAX_GROWTH, `ratio ${ratio.toFixed(1)}`);
});

// The two requests that keep the 20000 rows in the Worker answer what the background computed over a copy of them.
const PICK_WORDS = ["github", "rust", "Zürich", "https://github.com/", "https://docs.rs/", "docs.rs", "zzzzqqq", "fuzzy match", "tab", "mail example", "GitHub", "a"];

function worker_pipeline(rows: number) {
  const nodes = history_fixture(rows).history;
  const pipeline = rank_pipeline({ history: () => nodes.map(visit_of), inputs: async (source, asker) => ({ source: "history", incognito: asker.incognito, max: 20 }) as never });
  return { nodes, pipeline };
}

const expect_pick = (items: ReturnType<typeof history_items>, word: string) => {
  try {
    return { row: pick_entry(items, word, "history entry") };
  } catch (error) {
    return { refusal: (error as Error).message };
  }
};

test("pick_history gives the row pick_entry gives over the same rows: exact, best match, tie and none alike", async () => {
  const { nodes, pipeline } = worker_pipeline(3000);
  // Two rows with one title and no use make an equal tie.
  nodes.push({ url: "https://twin-a.test/", title: "Twinned page", visit_count: 1, last_visit: 1 }, { url: "https://twin-b.test/", title: "Twinned page", visit_count: 1, last_visit: 1 });
  pipeline.service.start();
  await pipeline.settle();
  const items = history_items(nodes);
  const words = [...PICK_WORDS, "twinned", "https://twin-a.test/", ...items.slice(0, 40).map((item) => item.title)];
  const kinds = new Set<string>();
  for (const word of words) {
    const expected = expect_pick(items, word);
    assert.deepEqual(await pipeline.service.pick_history(word), expected, word);
    kinds.add("row" in expected ? (expected.row.url === word ? "exact" : "match") : expected.refusal.includes("equally") ? "tie" : "none");
  }
  assert.deepEqual([...kinds].sort(), ["exact", "match", "none", "tie"]);
});

test("usage_for gives the boosts usage_by_url gives over the same rows, for the addresses asked and no others", async () => {
  const { nodes, pipeline } = worker_pipeline(3000);
  pipeline.service.start();
  await pipeline.settle();
  const urls = [...nodes.filter((_, index) => index % 7 === 0).map((node) => node.url as string), "https://never-visited.test/"];
  const expected = usage_by_url(history_items(nodes));
  const got = new Map((await pipeline.service.usage_for(urls))!);
  assert.deepEqual([...got].sort(), [...expected].filter(([url]) => urls.includes(url)).sort());
  assert.equal(got.has("https://never-visited.test/"), false);
});

// The worker side alone, with the fill answered at once, so the cost of each request shows without the message hops.
function filled_index(rows: number) {
  const nodes = history_fixture(rows).history;
  const replies = new Map<number, unknown>();
  let index!: ReturnType<typeof create_rank_index>;
  const post = (message: FromWorker) => {
    if (message.type === "ask") queueMicrotask(() => index.receive({ type: "answer", id: message.id, value: nodes.map(visit_of) }));
    else if (message.type === "reply") replies.set(message.id, message.value);
  };
  index = create_rank_index(post);
  return { index, replies };
}

test("at the cap, pick_history and usage_for answer within the time of one clone of the rows", async () => {
  const { index, replies } = filled_index(20000);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const rows = history_fixture(20000).history.map(visit_of);
  const urls = history_fixture(20000).bookmarks.map((bookmark) => bookmark.url);
  const time = (run: () => void) => {
    run();
    const times = Array.from({ length: 5 }, () => {
      const began = process.cpuUsage();
      run();
      const used = process.cpuUsage(began);
      return (used.user + used.system) / 1000;
    });
    return median(times);
  };
  const clone_ms = time(() => void structuredClone(rows));
  let id = 0;
  const usage_ms = time(() => index.receive({ type: "usage_for", id: ++id, urls }));
  const pick_ms = time(() => index.receive({ type: "pick_history", id: ++id, text: "github" }));
  assert.equal(replies.size, 12);
  assert.ok(Array.isArray(replies.get(1)) && (replies.get(1) as unknown[]).length > 0);
  // What each request sends back is one small answer, where the old path sent the whole copy.
  assert.ok(usage_ms < 20, `usage_for took ${usage_ms.toFixed(1)} ms`);
  assert.ok(pick_ms < 150, `pick_history took ${pick_ms.toFixed(1)} ms (a clone took ${clone_ms.toFixed(1)} ms)`);
});

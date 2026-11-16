// Ranking at the history cap. The Worker ranks off the page, but a first key over 20,000 rows still has to stay a fraction of a second, and the cost has to grow with the rows and no faster.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { snapshot_of } from "../../src/background/completion_rank.ts";
import { HISTORY_CACHE_MAX } from "../../src/background/history_cache.ts";
import { rank, rank_top } from "../../src/shared/score.ts";
import { FIXTURE_NOW, history_fixture } from "../support/history_fixture.ts";

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

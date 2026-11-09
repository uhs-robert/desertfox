import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { create_timings, merge_reports, summary_text, write_report } = await import(join(import.meta.dirname, "timings.mjs"));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a finished piece is recorded without the in_flight flag", async () => {
  const timings = create_timings();
  await timings.time_piece("p1", async () => {});
  timings.finish_active_piece();
  const { pieces } = timings.report();
  assert.deepEqual(pieces.map((piece: { name: string }) => piece.name), ["p1"]);
  assert.equal(pieces[0].in_flight, undefined);
});

test("finish_active_piece records the running piece as in flight, once, with its running case", async () => {
  const timings = create_timings();
  const hung = timings.time_piece("p2", () => timings.time_case("slow case", {}, () => sleep(30).then(() => new Promise(() => {}))));
  void hung;
  await sleep(60);
  timings.finish_active_case();
  timings.finish_active_piece();
  timings.finish_active_piece();
  const { pieces } = timings.report();
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].name, "p2");
  assert.equal(pieces[0].in_flight, true);
  assert.ok(pieces[0].case_ms > 0);
});

test("finish_active_piece does nothing between pieces", () => {
  const timings = create_timings();
  timings.finish_active_piece();
  assert.deepEqual(timings.report().pieces, []);
});

const shard_report = (name: string) => ({
  total_ms: 999,
  cases_ms: 10,
  outside_cases_ms: 5,
  categories: { keys: { ms: 4, count: 2 } },
  outside_cases: { driver: { ms: 3, count: 1 } },
  pieces: [{ name, wall_ms: 9, case_ms: 8 }],
  tab_samples: [{ label: name, at_ms: 1, tab_count: 1 }],
  cases: [{ name: "(setup)", wall_ms: 8, categories: {} }],
});

test("merge_reports takes the coordinator's wall time, adds the rest and tags every entry with its shard", () => {
  const shards = [
    { shard: 1, name: "oka", startup_ms: 5, busy_ms: 9, idle_ms: 20, finished_ms: 80, pieces: ["a.mjs"], exit: { code: 0, signal: null } },
    { shard: 2, name: "okb", startup_ms: 6, busy_ms: 9, idle_ms: 0, finished_ms: 100, pieces: ["b.mjs"], exit: { code: 0, signal: null } },
  ];
  const merged = merge_reports([{ shard: 1, report: shard_report("a.mjs") }, { shard: 2, report: shard_report("b.mjs") }], { total_ms: 100, shards });
  assert.equal(merged.total_ms, 100);
  assert.equal(merged.cases_ms, 20);
  assert.equal(merged.outside_cases_ms, 10);
  assert.deepEqual(merged.categories, { keys: { ms: 8, count: 4 } });
  assert.deepEqual(merged.outside_cases, { driver: { ms: 6, count: 2 } });
  assert.deepEqual(merged.pieces.map((piece: { name: string; shard: number }) => [piece.name, piece.shard]), [["a.mjs", 1], ["b.mjs", 2]]);
  assert.deepEqual(merged.cases.map((entry: { name: string; shard: number }) => [entry.name, entry.shard]), [["(setup)", 1], ["(setup)", 2]]);
  assert.deepEqual(merged.tab_samples.map((sample: { shard: number }) => sample.shard), [1, 2]);
  assert.deepEqual(merged.shards, shards);
  assert.equal(merged.critical_shard, 2);
  assert.equal("incomplete" in merged, false);
});

test("merge_reports skips a shard that wrote nothing and keeps the incomplete record", () => {
  const incomplete = { reason: "received SIGTERM", in_flight: ["b.mjs"], not_started: ["c.mjs"] };
  const merged = merge_reports([{ shard: 1, report: shard_report("a.mjs") }, { shard: 2, report: undefined }], {
    total_ms: 50,
    shards: [{ shard: 1, finished_ms: 40 }, { shard: 2, finished_ms: 45 }],
    incomplete,
  });
  assert.equal(merged.pieces.length, 1);
  assert.equal(merged.critical_shard, 2);
  assert.deepEqual(merged.incomplete, incomplete);
});

test("merge_reports of no reports is an empty report", () => {
  assert.deepEqual(merge_reports([], { total_ms: 0 }), { total_ms: 0, cases_ms: 0, outside_cases_ms: 0, categories: {}, outside_cases: {}, pieces: [], tab_samples: [], lost_key_suspects: [], cases: [], shards: [], critical_shard: undefined });
});

test("summary_text of a merged report has one line per shard", () => {
  const merged = merge_reports([{ shard: 1, report: shard_report("a.mjs") }], { total_ms: 100, shards: [{ shard: 1, busy_ms: 9000, finished_ms: 100, pieces: ["a.mjs"] }] });
  assert.match(summary_text(merged), /s1 +9\.0 s busy +1 pieces +a\n/);
});

test("merge_reports records the KEY_TEST_ONLY filter of the run", () => {
  assert.equal(merge_reports([], { total_ms: 0, filter: "caret" }).filter, "caret");
  assert.equal("filter" in merge_reports([], { total_ms: 0 }), false);
});

test("a lost-key suspect names its case and piece, and the merged summary counts it per shard", async () => {
  const timings = create_timings();
  await timings.time_piece("p1.mjs", () => timings.time_case("j scrolls", {}, async () => timings.record_lost_key_suspect("scroll on c after j")));
  const report = timings.report();
  assert.deepEqual(report.lost_key_suspects, [{ case: "j scrolls", piece: "p1.mjs", what: "scroll on c after j" }]);
  const merged = merge_reports([{ shard: 3, report }], { total_ms: 10, shards: [] });
  assert.match(summary_text(merged), /lost-key suspects \(waits that timed out after a key press\): 1\n {2}s3 {2}j scrolls: scroll on c after j\n/);
});

test("write_report with create_dir false does not recreate a folder that is gone", () => {
  const root = mkdtempSync(join(tmpdir(), "timings-test-"));
  try {
    const gone = join(root, "run");
    write_report(join(gone, "shard-1.json"), { a: 1 }, { create_dir: false });
    assert.ok(!existsSync(gone));
    write_report(join(gone, "shard-1.json"), { a: 1 });
    assert.ok(existsSync(join(gone, "shard-1.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

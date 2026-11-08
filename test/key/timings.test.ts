import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { create_timings, merge_reports } = await import(join(import.meta.dirname, "timings.mjs"));

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

test("merge_reports takes the longest total and adds the rest", () => {
  const report = (total_ms: number, name: string) => ({
    total_ms,
    cases_ms: 10,
    outside_cases_ms: 5,
    categories: { keys: { ms: 4, count: 2 } },
    outside_cases: { driver: { ms: 3, count: 1 } },
    pieces: [{ name, wall_ms: 9, case_ms: 8 }],
    tab_samples: [{ label: name, at_ms: 1, tab_count: 1 }],
    cases: [{ name: `case ${name}`, wall_ms: 8, categories: {} }],
  });
  const merged = merge_reports([report(100, "a"), report(250, "b")]);
  assert.equal(merged.total_ms, 250);
  assert.equal(merged.cases_ms, 20);
  assert.equal(merged.outside_cases_ms, 10);
  assert.deepEqual(merged.categories, { keys: { ms: 8, count: 4 } });
  assert.deepEqual(merged.outside_cases, { driver: { ms: 6, count: 2 } });
  assert.deepEqual(merged.pieces.map((piece: { name: string }) => piece.name), ["a", "b"]);
  assert.equal(merged.tab_samples.length, 2);
  assert.equal(merged.cases.length, 2);
});

test("merge_reports of no reports is an empty report", () => {
  assert.deepEqual(merge_reports([]), { total_ms: 0, cases_ms: 0, outside_cases_ms: 0, categories: {}, outside_cases: {}, pieces: [], tab_samples: [], cases: [] });
});

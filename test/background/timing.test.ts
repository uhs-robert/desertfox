import assert from "node:assert/strict";
import { test } from "node:test";
import { create_timing_log, KEPT_TIMINGS } from "../../src/background/timing_log.ts";
import { format_timings, summarize_timings, toast_summary } from "../../src/background/timing_summary.ts";

function slow_storage() {
  const data: Record<string, unknown> = {};
  const turn = () => new Promise((resolve) => setImmediate(resolve));
  return {
    data,
    get: async (key: string) => {
      await turn();
      return { [key]: data[key] };
    },
    set: async (items: Record<string, unknown>) => {
      await turn();
      Object.assign(data, items);
    },
  };
}

test("records made at the same time are all kept, in order", async () => {
  const log = create_timing_log(slow_storage(), "t");
  void log.record("a", 1);
  void log.record("b", 2);
  void log.record("c", 3);
  assert.deepEqual(await log.read(), [["a", 1], ["b", 2], ["c", 3]]);
});

test("the log is a ring: only the newest entries stay", async () => {
  const log = create_timing_log(slow_storage(), "t");
  for (let index = 0; index < KEPT_TIMINGS + 5; index++) void log.record("a", index);
  const kept = await log.read();
  assert.equal(kept.length, KEPT_TIMINGS);
  assert.equal(kept[0]![1], 5);
});

test("a failing store never rejects a record", async () => {
  const log = create_timing_log({ get: async () => ({}), set: async () => Promise.reject(new Error("quota")) }, "t");
  await log.record("a", 1);
});

test("summary gives count, median, p95 and max per name", () => {
  const timings = Array.from({ length: 20 }, (_, index): [string, number] => ["x", index + 1]);
  const [row] = summarize_timings([...timings, ["y", 7]]);
  assert.deepEqual(row, { name: "x", count: 20, median: 10, p95: 19, max: 20 });
  assert.deepEqual(summarize_timings([["y", 7]]), [{ name: "y", count: 1, median: 7, p95: 7, max: 7 }]);
});

test("text and toast of no timings and of some", () => {
  assert.equal(format_timings([]), "No timings yet.");
  assert.equal(toast_summary([]), "No timings yet");
  const rows = summarize_timings([["a", 3], ["b", 120]]);
  assert.match(format_timings(rows), /^a {2}n=1 {2}median=3\.0ms/);
  assert.match(toast_summary(rows), /slowest p95 b 120 ms/);
});

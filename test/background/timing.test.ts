import assert from "node:assert/strict";
import { test } from "node:test";
import { accept_hint_timing, create_timing_log, KEPT_TIMINGS } from "../../src/background/timing_log.ts";
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

test("a record after a failed write still writes", async () => {
  const storage = slow_storage();
  let failing = true;
  const log = create_timing_log({ get: storage.get, set: async (items) => (failing ? Promise.reject(new Error("quota")) : storage.set(items)) }, "t");
  await log.record("a", 1);
  failing = false;
  await log.record("b", 2);
  assert.deepEqual(await log.read(), [["b", 2]]);
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

test("a burst is written once", async () => {
  const storage = slow_storage();
  let writes = 0;
  const log = create_timing_log({ get: storage.get, set: (items) => (writes++, storage.set(items)) }, "t");
  for (let index = 0; index < 50; index++) void log.record("a", index);
  assert.equal((await log.read()).length, 50);
  assert.equal(writes, 1);
});

test("only a hint.build time of zero or more is accepted", async () => {
  const seen: [string, number][] = [];
  const log = { record: async (name: string, ms: number) => void seen.push([name, ms]) };
  for (const request of [{ name: "hint.build", ms: 4 }, { name: "hint.build", ms: 0 }, { name: "other", ms: 4 }, { name: "hint.build", ms: -1 }, { name: "hint.build", ms: NaN }, { name: "hint.build", ms: "4" }, { name: 5, ms: 1 }, {}]) {
    accept_hint_timing(log, request);
  }
  assert.deepEqual(seen, [["hint.build", 4], ["hint.build", 0]]);
});

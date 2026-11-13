import assert from "node:assert/strict";
import { test } from "node:test";
import { clear_on_history_removed } from "../../src/background/history_clear.ts";

function holders() {
  const calls: string[] = [];
  return { calls, holders: { marks: { clear_normal: async () => void calls.push("marks") }, cmdline: { clear_history: async () => void calls.push("cmdline") } } };
}

test("a clear of all history clears the marks and the command line history", async () => {
  const { calls, holders: stores } = holders();
  await clear_on_history_removed({ allHistory: true }, stores);
  assert.deepEqual(calls.sort(), ["cmdline", "marks"]);
});

test("a partial clear keeps both", async () => {
  const { calls, holders: stores } = holders();
  await clear_on_history_removed({ allHistory: false }, stores);
  assert.deepEqual(calls, []);
});

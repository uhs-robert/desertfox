import assert from "node:assert/strict";
import { test } from "node:test";
import { clear_on_history_removed } from "../../src/background/history_clear.ts";

function holders() {
  const calls: string[] = [];
  return { calls, holders: { marks: { clear_normal: async () => void calls.push("marks") }, cmdline: { clear_history: async () => void calls.push("cmdline") }, favicons: { clear: async () => void calls.push("favicons") } } };
}

test("a clear of all history clears the marks, the command line history and the favicon cache", async () => {
  const { calls, holders: stores } = holders();
  await clear_on_history_removed({ allHistory: true }, stores);
  assert.deepEqual(calls.sort(), ["cmdline", "favicons", "marks"]);
});

test("a partial clear keeps all three", async () => {
  const { calls, holders: stores } = holders();
  await clear_on_history_removed({ allHistory: false }, stores);
  assert.deepEqual(calls, []);
});

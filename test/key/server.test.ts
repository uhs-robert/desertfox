import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { create_event_log } = await import(join(import.meta.dirname, "server.mjs"));

type Report = { type: string; n?: number };
const is_type = (type: string) => (event: Report) => event.type === type;

// Whether the promise settled before one turn of the event loop ran out. A wake on the push settles it within that turn. A poll waits for its next timer, which comes later.
async function settles_within_one_turn(promise: Promise<unknown>) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(setImmediate);
  return settled;
}

test("a report pushed in the same step that starts the wait wakes it", async () => {
  const log = create_event_log();
  const waiting = log.wait_for(0, is_type("hit"), 1000);
  log.push({ type: "hit" });
  assert.ok(await settles_within_one_turn(waiting), "the push did not wake the wait");
  assert.deepEqual(await waiting, { type: "hit" });
});

test("a report that came later wakes the wait at once, not on a poll step", async () => {
  const log = create_event_log();
  const waiting = log.wait_for(0, is_type("hit"), 1000);
  await new Promise((resolve) => setTimeout(resolve, 20));
  log.push({ type: "hit" });
  assert.ok(await settles_within_one_turn(waiting), "the push did not wake the wait");
});

test("a report already in the log answers at once, and reports before the mark do not count", async () => {
  const log = create_event_log();
  log.push({ type: "hit", n: 1 });
  log.push({ type: "miss" });
  log.push({ type: "hit", n: 3 });
  assert.deepEqual(await log.wait_for(0, is_type("hit"), 1000), { type: "hit", n: 1 });
  assert.deepEqual(await log.wait_for(1, is_type("hit"), 1000), { type: "hit", n: 3 });
  assert.equal(await log.wait_for(3, is_type("hit"), 30), undefined);
});

// The predicate runs once per check, so a call after the wait ended shows a listener that stayed.
const counting = (type: string) => {
  const calls = { count: 0 };
  return { calls, predicate: (event: Report) => { calls.count++; return event.type === type; } };
};

test("a wait that timed out stops listening", async () => {
  const log = create_event_log();
  const { calls, predicate } = counting("hit");
  assert.equal(await log.wait_for(0, predicate, 30), undefined);
  const after_timeout = calls.count;
  log.push({ type: "hit" });
  assert.equal(calls.count, after_timeout);
});

test("a wait that found its report stops listening", async () => {
  const log = create_event_log();
  const { calls, predicate } = counting("hit");
  const waiting = log.wait_for(0, predicate, 1000);
  log.push({ type: "hit" });
  await waiting;
  const after_found = calls.count;
  log.push({ type: "other" });
  assert.equal(calls.count, after_found);
});

test("a predicate that throws fails the wait and stops listening", async () => {
  const log = create_event_log();
  let calls = 0;
  const waiting = log.wait_for(0, (event: Report) => { calls++; if (event.type === "bad") throw new Error("bad report"); return false; }, 1000);
  log.push({ type: "bad" });
  await assert.rejects(waiting, /bad report/);
  const after_throw = calls;
  log.push({ type: "other" });
  assert.equal(calls, after_throw);
});

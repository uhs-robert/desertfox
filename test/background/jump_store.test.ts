import assert from "node:assert/strict";
import { test } from "node:test";
import { create_jump_store } from "../../src/background/jump_store.ts";
import type { JumpArea } from "../../src/background/jump_store.ts";
import { MAX_JUMPS } from "../../src/shared/jump_names.ts";

function fake_area(delay_ms = 0) {
  const values = new Map<string, unknown>();
  const sleep = () => new Promise((resolve) => setTimeout(resolve, delay_ms));
  const writes: unknown[] = [];
  const area = {
    get: async (key: string) => (await sleep(), Object.fromEntries(values.has(key) ? [[key, structuredClone(values.get(key))]] : [])),
    set: async (items: Record<string, unknown>) => {
      await sleep();
      Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value)));
      writes.push(structuredClone(items));
    },
    remove: async (key: string) => void values.delete(key),
  } as unknown as JumpArea;
  return { area, values, writes };
}

const make = (delay_ms = 0) => {
  const session = fake_area(delay_ms);
  return { ...session, store: create_jump_store({ session: () => session.area }) };
};
const at = (url: string, y: number) => ({ url, x: 0, y });
const A = "https://a.test/";
const B = "https://b.test/";

test("a step back from the present keeps where you are, so a step forward comes back", async () => {
  const { store } = make();
  await store.push(1, false, at(A, 500));
  assert.deepEqual(await store.step(1, false, -1, at(A, 0)), at(A, 500));
  assert.deepEqual(await store.step(1, false, 1, at(A, 500)), at(A, 0));
});

test("a step past either end refuses and changes nothing", async () => {
  const { store, writes } = make();
  await assert.rejects(store.step(1, false, -1, at(A, 0)), /No older jump/);
  await assert.rejects(store.step(1, false, 1, at(A, 0)), /No newer jump/);
  assert.equal(writes.length, 0);
  await store.push(1, false, at(A, 500));
  await store.step(1, false, -1, at(A, 0));
  const before = writes.length;
  await assert.rejects(store.step(1, false, -1, at(A, 500)), /No older jump/);
  assert.equal(writes.length, before);
  await store.step(1, false, 1, at(A, 500));
  await assert.rejects(store.step(1, false, 1, at(A, 0)), /No newer jump/);
  // The refusal did not move the cursor.
  assert.deepEqual(await store.step(1, false, -1, at(A, 0)), at(A, 500));
});

test("a count past the end refuses whole instead of stopping at the end", async () => {
  const { store } = make();
  await store.push(1, false, at(A, 100));
  await store.push(1, false, at(A, 900));
  await assert.rejects(store.step(1, false, -5, at(A, 0)), /No older jump/);
  assert.deepEqual(await store.step(1, false, -2, at(A, 0)), at(A, 100));
});

test("the step must be a whole number that is not zero", async () => {
  const { store } = make();
  await assert.rejects(store.step(1, false, 0, at(A, 0)), /not zero/);
  await assert.rejects(store.step(1, false, 1.5, at(A, 0)), /whole number/);
});

test("a jump after a step back drops the newer entries", async () => {
  const { store } = make();
  await store.push(1, false, at(A, 100));
  await store.push(1, false, at(A, 900));
  await store.push(1, false, at(B, 300));
  await store.step(1, false, -2, at(B, 0));
  await store.push(1, false, at(A, 200));
  await assert.rejects(store.step(1, false, 1, at(A, 0)), /No newer jump/);
  assert.deepEqual(await store.step(1, false, -1, at(A, 0)), at(A, 200));
  assert.deepEqual(await store.step(1, false, -1, at(A, 200)), at(A, 100));
});

test("a place within a few pixels of the last one is the same place", async () => {
  const { store, values } = make();
  await store.push(1, false, at(A, 500));
  await store.push(1, false, at(A, 502));
  await store.push(1, false, at(B, 502));
  await store.push(1, false, at(B, 700));
  const list = (values.get("desertfox_jumps") as { windows: Record<string, { entries: unknown[] }> }).windows["1"]!;
  assert.deepEqual(list.entries, [at(A, 502), at(B, 502), at(B, 700)]);
});

test("a place at the same height but far to the side is another place", async () => {
  const { store, values } = make();
  await store.push(1, false, { url: A, x: 1000, y: 0 });
  await store.push(1, false, { url: A, x: 1002, y: 0 });
  assert.deepEqual(await store.step(1, false, -1, { url: A, x: 0, y: 0 }), { url: A, x: 1002, y: 0 }, "<C-o> from x 0 returns to x 1000");
  const list = (values.get("desertfox_jumps") as { windows: Record<string, { entries: unknown[] }> }).windows["1"]!;
  assert.equal(list.entries.length, 2);
});

test("a step from the present on the last place does not add it twice", async () => {
  const { store } = make();
  await store.push(1, false, at(A, 500));
  await assert.rejects(store.step(1, false, -2, at(A, 501)), /No older jump/);
  assert.deepEqual(await store.step(1, false, -1, at(A, 0)), at(A, 500));
});

test("the list keeps the newest hundred entries and the cursor goes with them", async () => {
  const { store, values } = make();
  for (let index = 0; index < MAX_JUMPS + 5; index++) await store.push(1, false, at(A, index * 100));
  const list = (values.get("desertfox_jumps") as { windows: Record<string, { entries: { y: number }[] }> }).windows["1"]!;
  assert.equal(list.entries.length, MAX_JUMPS);
  assert.equal(list.entries[0]!.y, 500);
  assert.deepEqual(await store.step(1, false, -1, at(B, 0)), at(A, (MAX_JUMPS + 4) * 100));
  // The place you step from joined the list and pushed the oldest entry out, so the cursor stands one before the end.
  assert.deepEqual(await store.step(1, false, -(MAX_JUMPS - 2), at(B, 0)), at(A, 600));
  await assert.rejects(store.step(1, false, -1, at(B, 0)), /No older jump/);
});

test("each window keeps its own list", async () => {
  const { store } = make();
  await store.push(1, false, at(A, 100));
  await store.push(2, false, at(B, 200));
  assert.deepEqual(await store.step(2, false, -1, at(B, 0)), at(B, 200));
  assert.deepEqual(await store.step(1, false, -1, at(A, 0)), at(A, 100));
});

test("a private window keeps its list apart from a normal window of the same id", async () => {
  const { store, values } = make();
  await store.push(1, false, at(A, 100));
  await store.push(1, true, at(B, 200));
  assert.deepEqual(await store.step(1, true, -1, at(B, 0)), at(B, 200));
  assert.deepEqual(await store.step(1, false, -1, at(A, 0)), at(A, 100));
  assert.ok(values.has("desertfox_private_jumps") && values.has("desertfox_jumps"));
});

test("two presses in a row each see the cursor the other left, even when the storage is slow", async () => {
  const { store } = make(3);
  for (const y of [100, 200, 300]) await store.push(1, false, at(A, y));
  const presses = await Promise.all([store.step(1, false, -1, at(A, 0)), store.step(1, false, -1, at(A, 0)), store.step(1, false, -1, at(A, 0))]);
  assert.deepEqual(
    presses.map((entry) => entry.y),
    [300, 200, 100],
  );
  const mixed = await Promise.all([store.step(1, false, 1, at(A, 0)), store.step(1, false, 1, at(A, 0))]);
  assert.deepEqual(
    mixed.map((entry) => entry.y),
    [200, 300],
  );
});

test("a push racing a step lands in arrival order", async () => {
  const { store } = make(2);
  await store.push(1, false, at(A, 100));
  const [stepped] = await Promise.all([store.step(1, false, -1, at(A, 0)), store.push(1, false, at(B, 50))]);
  assert.deepEqual(stepped, at(A, 100));
  // The push came after the step: it dropped the entries after the cursor, which was on the one entry.
  await assert.rejects(store.step(1, false, 1, at(B, 0)), /No newer jump/);
});

test("a window that closed loses its list in both kinds", async () => {
  const { store } = make();
  await store.push(1, false, at(A, 100));
  await store.push(1, true, at(A, 100));
  await store.push(2, false, at(B, 100));
  await store.forget_window(1);
  await assert.rejects(store.step(1, false, -1, at(A, 0)), /No older jump/);
  await assert.rejects(store.step(1, true, -1, at(A, 0)), /No older jump/);
  assert.deepEqual(await store.step(2, false, -1, at(B, 0)), at(B, 100));
});

test("the private lists go when no private window is left, and stay while one is open", async () => {
  const { store } = make();
  await store.push(1, true, at(A, 100));
  await store.push(2, false, at(B, 100));
  await store.clear_private_without_window(async () => true);
  assert.deepEqual(await store.step(1, true, -1, at(A, 0)), at(A, 100));
  await store.clear_private_without_window(async () => false);
  await assert.rejects(store.step(1, true, -1, at(A, 0)), /No older jump/);
  assert.deepEqual(await store.step(2, false, -1, at(B, 0)), at(B, 100));
});

test("a damaged stored value reads as an empty list, and a bad entry is refused", async () => {
  const { store, values } = make();
  values.set("desertfox_jumps", { v: 1, windows: { 1: { entries: [{ url: 5 }], cursor: 9 } } });
  await assert.rejects(store.step(1, false, -1, at(A, 0)), /No older jump/);
  await assert.rejects(store.push(1, false, { url: "x".repeat(3000), x: 0, y: 0 }), /too long/);
  await assert.rejects(store.push(1, false, { url: A, x: NaN, y: 0 }), /scroll position/);
});

test("a count that reaches past the oldest entry of a full list refuses and keeps every list", async () => {
  const { store, values } = make();
  for (let index = 0; index < MAX_JUMPS; index++) await store.push(1, false, at(A, index * 100));
  await store.push(2, false, at(B, 100));
  await assert.rejects(store.step(1, false, -MAX_JUMPS, at(B, 0)), /No older jump/);
  const stored = values.get("desertfox_jumps") as { windows: Record<string, { entries: unknown[]; cursor: number }> };
  assert.equal(stored.windows["1"]!.entries.length, MAX_JUMPS);
  assert.equal(stored.windows["1"]!.cursor, MAX_JUMPS);
  assert.deepEqual(await store.step(2, false, -1, at(B, 0)), at(B, 100));
  // The oldest place that is still reachable once the place you are on has joined the list.
  assert.deepEqual(await store.step(1, false, -(MAX_JUMPS - 1), at(B, 0)), at(A, 100));
  const after = values.get("desertfox_jumps") as { windows: Record<string, { cursor: number }> };
  assert.ok(Object.values(after.windows).every((list) => list.cursor >= 0));
});

// A command that jumps records through the router, and the address change its scroll sets off can record the same place again through the page's leave watch.
test("a router push and a page push of the same place leave one entry, also after a step back", async () => {
  const { store, values } = make();
  const list = () => (values.get("desertfox_jumps") as { windows: Record<string, unknown> }).windows["1"];
  await store.push(1, false, at(A, 0));
  await store.push(1, false, at(A, 2));
  assert.deepEqual(list(), { entries: [at(A, 2)], cursor: 1 });
  await store.push(1, false, at(B, 100));
  await store.step(1, false, -1, at(B, 300));
  await store.push(1, false, at(B, 100));
  await store.push(1, false, at(B, 101));
  assert.deepEqual(list(), { entries: [at(A, 2), at(B, 101)], cursor: 2 });
});

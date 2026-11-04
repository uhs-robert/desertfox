import assert from "node:assert/strict";
import { test } from "node:test";
import { create_previous_tabs } from "../../src/background/previous_tab.ts";

function make() {
  const data = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => (data.has(key) ? { [key]: data.get(key) } : {}),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => data.set(key, value)),
    remove: async (key: string) => void data.delete(key),
  };
  return create_previous_tabs(storage as never);
}

test("switching back and forth swaps the previous tab", async () => {
  const tabs = make();
  await tabs.activated(1, 10);
  assert.equal(await tabs.previous_of(1), 10);
  await tabs.activated(1, 11);
  assert.equal(await tabs.previous_of(1), 11);
});

test("each window keeps its own previous tab, and a window's first activation has none", async () => {
  const tabs = make();
  await tabs.activated(1, 10);
  await tabs.activated(2, 20);
  assert.deepEqual([await tabs.previous_of(1), await tabs.previous_of(2)], [10, 20]);
  await tabs.activated(1, undefined);
  assert.equal(await tabs.previous_of(1), undefined);
});

test("closing the previous tab or its window clears it, and closing another tab does not", async () => {
  const tabs = make();
  await tabs.activated(1, 10);
  await tabs.removed(12, 1, false);
  assert.equal(await tabs.previous_of(1), 10);
  await tabs.removed(10, 1, false);
  assert.equal(await tabs.previous_of(1), undefined);
  await tabs.activated(1, 10);
  await tabs.removed(12, 1, true);
  assert.equal(await tabs.previous_of(1), undefined);
});

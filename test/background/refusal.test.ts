import assert from "node:assert/strict";
import { test } from "node:test";
import { deliver_refusal } from "../../src/background/refusal.ts";

const refusal = { id: "a.b", message: "no" };

test("a tab with a content script gets a toast", async () => {
  const sent: unknown[] = [];
  const path = await deliver_refusal({ send_to_tab: async (_id, m) => void sent.push(m), notify: async () => assert.fail() }, 4, refusal);
  assert.equal(path, "toast");
  assert.deepEqual(sent, [{ type: "refusal", refusal }]);
});

test("a rejected send falls back to a notification", async () => {
  let notified = 0;
  const path = await deliver_refusal(
    { send_to_tab: async () => Promise.reject(new Error("no receiver")), notify: async () => void notified++ },
    4,
    refusal,
  );
  assert.deepEqual([path, notified], ["notification", 1]);
});

test("no tab means a notification", async () => {
  const path = await deliver_refusal({ send_to_tab: async () => assert.fail(), notify: async () => undefined }, undefined, refusal);
  assert.equal(path, "notification");
});

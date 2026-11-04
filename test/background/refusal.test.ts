import assert from "node:assert/strict";
import { test } from "node:test";
import { deliver_refusal, deliver_toast } from "../../src/background/refusal.ts";

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

test("a toast kind other than error rides on the message, and an error leaves it out", async () => {
  const sent: unknown[] = [];
  const channels = { send_to_tab: async (_id: number, m: unknown) => void sent.push(m), notify: async () => assert.fail() };
  await deliver_toast(channels, 4, refusal, "success");
  await deliver_toast(channels, 4, refusal, "error");
  assert.deepEqual(sent, [{ type: "refusal", refusal, kind: "success" }, { type: "refusal", refusal }]);
});

test("a warning with no content script falls back to a notification", async () => {
  let notified = 0;
  const path = await deliver_toast({ send_to_tab: async () => Promise.reject(new Error("none")), notify: async () => void notified++ }, 4, refusal, "warning");
  assert.deepEqual([path, notified], ["notification", 1]);
});

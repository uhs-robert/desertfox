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

test("a tab with no content script shows the toast in the bar when one is up, and the bar is tried before a notification", async () => {
  const shown: unknown[] = [];
  const channels = {
    send_to_tab: async () => Promise.reject(new Error("none")),
    show_in_bar: async (tab_id: number, text: string, kind: string) => (shown.push([tab_id, text, kind]), true),
    notify: async () => assert.fail(),
  };
  assert.equal(await deliver_toast(channels, 4, refusal, "success"), "bar");
  assert.equal(await deliver_refusal(channels, 4, refusal), "bar");
  assert.deepEqual(shown, [[4, "no", "success"], [4, "no", "error"]]);
});

test("a bar that is not up leaves the notification, and a page toast never touches the bar", async () => {
  let notified = 0;
  const down = { send_to_tab: async () => Promise.reject(new Error("none")), show_in_bar: async () => false, notify: async () => void notified++ };
  assert.equal(await deliver_refusal(down, 4, refusal), "notification");
  assert.equal(await deliver_refusal({ send_to_tab: down.send_to_tab, notify: down.notify }, 4, refusal), "notification");
  assert.equal(notified, 2);
  const page = { send_to_tab: async () => undefined, show_in_bar: async () => assert.fail(), notify: async () => assert.fail() };
  assert.equal(await deliver_refusal(page, 4, refusal), "toast");
  assert.equal(await deliver_refusal({ ...down, show_in_bar: async () => assert.fail() }, undefined, refusal), "notification");
});

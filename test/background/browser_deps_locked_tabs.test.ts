import assert from "node:assert/strict";
import { test } from "node:test";

// A tab with a content script answers, and every other tab rejects as Firefox does when no listener exists.
const live_tabs = new Set([1]);
const sent: unknown[] = [];
(globalThis as unknown as { browser: unknown }).browser = {
  storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
  tabs: {
    sendMessage: async (tab_id: number, message: unknown) => {
      sent.push(message);
      if (live_tabs.has(tab_id)) return "from the content script";
      throw new Error("Could not establish connection. Receiving end does not exist.");
    },
  },
  runtime: { onMessage: { addListener() {} }, getURL: (path: string) => `moz-extension://test/${path}` },
};

// Imported after the stub, because browser_deps reads the global when it loads.
const { has_content_script, reach_locked_tabs, send_to_tab } = await import("../../src/background/browser_deps.ts");

const locked = { tabs: new Set([7]), fail_check: false, pushed: [] as unknown[][] };
reach_locked_tabs({
  is_locked_tab: async (tab_id) => {
    if (locked.fail_check) throw new Error("storage failed");
    return locked.tabs.has(tab_id);
  },
  send_to_locked_tab: async (tab_id, message, frame_id) => {
    locked.pushed.push([tab_id, message, frame_id]);
    return "from the locked page";
  },
});

test("a tab with a content script never reaches the locked page path", async () => {
  locked.pushed.length = 0;
  assert.equal(await send_to_tab(1, { type: "ping" }), "from the content script");
  assert.equal(await has_content_script(1), true);
  assert.deepEqual(locked.pushed, []);
});

test("a send to a locked tab goes to the module once tabs.sendMessage fails, with its frame", async () => {
  locked.pushed.length = 0;
  assert.equal(await send_to_tab(7, { type: "get_selection" }, 0), "from the locked page");
  assert.deepEqual(locked.pushed, [[7, { type: "get_selection" }, 0]]);
  assert.equal(await has_content_script(7), true);
});

test("a tab that is neither keeps the browser's own error, and a failed locked check counts as not locked", async () => {
  locked.pushed.length = 0;
  await assert.rejects(send_to_tab(9, { type: "ping" }), /Receiving end does not exist/);
  assert.equal(await has_content_script(9), false);
  locked.fail_check = true;
  await assert.rejects(send_to_tab(7, { type: "ping" }), /Receiving end does not exist/);
  assert.equal(await has_content_script(7), false);
  locked.fail_check = false;
  assert.deepEqual(locked.pushed, []);
});

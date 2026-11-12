import assert from "node:assert/strict";
import { test } from "node:test";
import { create_jump_leave } from "../../src/background/jump_leave.ts";
import { create_jump_store } from "../../src/background/jump_store.ts";
import type { JumpArea } from "../../src/background/jump_store.ts";

function fake_area() {
  const values = new Map<string, unknown>();
  return {
    get: async (key: string) => Object.fromEntries(values.has(key) ? [[key, structuredClone(values.get(key))]] : []),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value))),
    remove: async (key: string) => void values.delete(key),
  } as unknown as JumpArea;
}

const A = "https://a.test/";
const B = "https://b.test/";

function make(stepping = false, open = true) {
  const session = fake_area();
  const store = create_jump_store({ session: () => session });
  const state = { stepping };
  const leave = create_jump_leave({ store, is_stepping: () => state.stepping, is_open: async () => open });
  const sender = (url: string, extra = {}) => ({ incognito: false, id: 5, window_id: 1, url, frame_id: 0, ...extra });
  const tab = (incognito = false) => ({ tab_id: 5, window_id: 1, incognito, url: undefined });
  // The whole stored list of window 1, read without moving the cursor.
  const places = async (is_private = false) => {
    const key = is_private ? "desertfox_private_jumps" : "desertfox_jumps";
    const stored = (await session.get(key)) as Record<string, { windows?: Record<string, { entries: unknown[] }> }>;
    return stored[key]?.windows?.["1"]?.entries ?? [];
  };
  return { leave, store, state, sender, tab, places };
}

test("a page that left and then a tab on another address records the offset the page left", async () => {
  const { leave, sender, tab, places } = make();
  await leave.leave({ type: "jump_leave", x: 0, y: 700 }, sender(A), A);
  assert.deepEqual(await places(), [], "recorded before the address changed");
  await leave.updated(tab(), { url: B });
  assert.deepEqual(await places(), [{ url: A, x: 0, y: 700 }]);
});

test("the address changing first records when the page's report comes after", async () => {
  const { leave, sender, places } = make();
  await leave.leave({ type: "jump_leave", x: 0, y: 700 }, sender(B), A);
  assert.deepEqual(await places(), [{ url: A, x: 0, y: 700 }]);
});

test("a reload records nothing: the page loads again at its address", async () => {
  const { leave, sender, tab, places } = make();
  await leave.leave({ type: "jump_leave", x: 0, y: 700 }, sender(A), A);
  await leave.updated(tab(), { status: "complete" });
  await leave.updated(tab(), { url: B });
  assert.deepEqual(await places(), []);
});

test("a redirect chain records once, for the page the user left", async () => {
  const { leave, sender, tab, places } = make();
  await leave.leave({ type: "jump_leave", x: 0, y: 700 }, sender(A), A);
  await leave.updated(tab(), { url: B });
  await leave.updated(tab(), { url: "https://c.test/" });
  assert.deepEqual(await places(), [{ url: A, x: 0, y: 700 }]);
});

test("a jump step that takes the tab to another address records nothing", async () => {
  const { leave, sender, tab, places } = make(true);
  await leave.leave({ type: "jump_leave", x: 0, y: 700 }, sender(A), A);
  await leave.updated(tab(), { url: B });
  assert.deepEqual(await places(), []);
});

test("a child frame, and a tab that closed, record nothing", async () => {
  const { leave, sender, tab, places } = make();
  await leave.leave({ type: "jump_leave", x: 0, y: 700 }, sender(A, { frame_id: 2 }), A);
  await leave.updated(tab(), { url: B });
  assert.deepEqual(await places(), []);
  await leave.updated(tab(), { status: "complete" });
  await leave.leave({ type: "jump_leave", x: 0, y: 700 }, sender(A), A);
  await leave.forget(5);
  await leave.updated(tab(), { url: B });
  assert.deepEqual(await places(), []);
});

test("a private tab records in the private list only", async () => {
  const { leave, sender, tab, places } = make();
  await leave.leave({ type: "jump_leave", x: 0, y: 700 }, sender(A, { incognito: true }), A);
  await leave.updated(tab(true), { url: B });
  assert.deepEqual(await places(false), []);
  assert.deepEqual(await places(true), [{ url: A, x: 0, y: 700 }]);
});

test("a report that arrives after its tab closed leaves nothing held", async () => {
  const { leave, sender, tab, places } = make(false, false);
  await leave.leave({ type: "jump_leave", x: 0, y: 700 }, sender(A), A);
  await leave.updated(tab(), { url: B });
  assert.deepEqual(await places(), []);
});

test("the address change handled before the page's report still records, whatever address the report's tab shows", async () => {
  const { leave, sender, tab, places } = make();
  await leave.updated(tab(), { url: B });
  assert.deepEqual(await places(), []);
  await leave.leave({ type: "jump_leave", x: 0, y: 700 }, sender(A), A);
  assert.deepEqual(await places(), [{ url: A, x: 0, y: 700 }]);
});

test("a noted address change does not outlive its load, so a later reload records nothing", async () => {
  const { leave, sender, tab, places } = make();
  await leave.updated(tab(), { url: B });
  await leave.updated(tab(), { status: "complete" });
  await leave.leave({ type: "jump_leave", x: 0, y: 700 }, sender(B), B);
  await leave.updated(tab(), { status: "complete" });
  assert.deepEqual(await places(), []);
});

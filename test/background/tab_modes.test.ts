import assert from "node:assert/strict";
import { test } from "node:test";
import { create_tab_modes, shortcut_allowed } from "../../src/background/tab_modes.ts";

function fake_storage() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key: string | null) => (key === null ? { ...data } : key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
    remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => delete data[key]),
  } as unknown as Parameters<typeof create_tab_modes>[0] & { data: Record<string, unknown> };
}

const TOP = 0;
const CHILD = 7;
const OTHER_CHILD = 9;

test("a tab's mode is stored, defaults to normal and is removed with the tab", async () => {
  const storage = fake_storage();
  const modes = create_tab_modes(storage);
  assert.equal(await modes.recall(4), "normal");
  await modes.report(4, { frame_id: TOP, mode: "ignore" });
  assert.equal(await modes.recall(4), "ignore");
  await modes.forget(4);
  assert.deepEqual(storage.data, {});
});

test("in ignore mode only a shortcut that can run there goes through", () => {
  const commands = { "tab.next": { modes: ["normal"] }, "mode.leave": { modes: ["normal", "ignore"] } } as const;
  const get = (id: string) => (commands as Record<string, { modes: readonly ("normal" | "ignore")[] }>)[id];
  assert.equal(shortcut_allowed("ignore", [{ id: "tab.next" }], get), false);
  assert.equal(shortcut_allowed("ignore", [{ id: "mode.leave" }], get), true);
  assert.equal(shortcut_allowed("normal", [{ id: "tab.next" }], get), true);
});

test("loading a new page forgets the tab's mode and its focused frame, other updates keep them", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: "gained" });
  await modes.forget_on_navigation(4, { status: "complete" });
  assert.equal(await modes.recall(4), "insert");
  await modes.forget_on_navigation(4, { status: "loading" });
  assert.equal(await modes.recall(4), "normal");
  await modes.report(4, { frame_id: TOP, mode: "normal" });
  assert.equal(await modes.recall(4), "normal", "the old page's focused frame came back");
});

test("starting the background clears every tab mode and nothing else", async () => {
  const storage = fake_storage();
  const modes = create_tab_modes(storage);
  await modes.report(4, { frame_id: TOP, mode: "ignore" });
  await modes.report(9, { frame_id: CHILD, mode: "insert", focus: "gained" });
  await storage.set({ other_key: 1 });
  await modes.forget_all();
  assert.deepEqual(storage.data, { other_key: 1 });
});

test("a clear queued at start never removes a report that arrives during it", async () => {
  const storage = fake_storage();
  await storage.set({ desertfox_tab_mode_4: { top_mode: "ignore" } });
  const modes = create_tab_modes(storage);
  const cleared = modes.forget_all();
  const reported = modes.report(5, { frame_id: TOP, mode: "insert" });
  await Promise.all([cleared, reported]);
  assert.equal(await modes.recall(4), "normal");
  assert.equal(await modes.recall(5), "insert");
});

test("a child frame's mode stands for the tab only while its window holds focus", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "normal", focus: "gained" });
  await modes.report(4, { frame_id: CHILD, mode: "insert" });
  assert.equal(await modes.recall(4), "normal", "an unfocused child frame set the tab's mode");
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: "gained" });
  assert.equal(await modes.recall(4), "insert");
  await modes.report(4, { frame_id: CHILD, mode: "normal" });
  assert.equal(await modes.recall(4), "normal", "the focused child's later change was dropped");
});

test("focus moving to the top frame and back hands the tab's mode over each time", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "ignore", focus: "gained" });
  assert.equal(await modes.report(4, { frame_id: CHILD, mode: "insert", focus: "gained" }), "insert");
  assert.equal(await modes.recall(4), "insert");
  assert.equal(await modes.report(4, { frame_id: TOP, mode: "ignore", focus: "gained" }), undefined);
  assert.equal(await modes.recall(4), "ignore");
  assert.equal(await modes.report(4, { frame_id: CHILD, mode: "insert", focus: "gained" }), "insert");
  assert.equal(await modes.recall(4), "insert");
});

test("the frames' blur and focus can arrive in either order", async () => {
  const blur_first = create_tab_modes(fake_storage());
  await blur_first.report(4, { frame_id: CHILD, mode: "insert", focus: "gained" });
  await blur_first.report(4, { frame_id: CHILD, mode: "insert", focus: "lost" });
  assert.equal(await blur_first.report(4, { frame_id: OTHER_CHILD, mode: "caret", focus: "gained" }), "caret");
  assert.equal(await blur_first.recall(4), "caret");

  const focus_first = create_tab_modes(fake_storage());
  await focus_first.report(4, { frame_id: CHILD, mode: "insert", focus: "gained" });
  await focus_first.report(4, { frame_id: OTHER_CHILD, mode: "caret", focus: "gained" });
  assert.equal(await focus_first.report(4, { frame_id: CHILD, mode: "insert", focus: "lost" }), "caret", "a late blur of the old frame took the focus off the new one");
  assert.equal(await focus_first.recall(4), "caret");
});

test("a focused child frame that unloads gives the tab back to the top frame", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "normal" });
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: "gained" });
  assert.equal(await modes.report(4, { frame_id: CHILD, mode: "insert", focus: "lost" }), undefined);
  assert.equal(await modes.recall(4), "normal");
});

test("a focused child frame that navigates hands the tab to the new page's start report", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "normal" });
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: "gained" });
  // The old page's pagehide, then the new page in the same frame starts focused in normal mode.
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: "lost" });
  assert.equal(await modes.report(4, { frame_id: CHILD, mode: "normal", focus: "gained" }), "normal");
  assert.equal(await modes.recall(4), "normal");
});

test("a cross-site frame whose script starts on its first focus takes the tab with its start report", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "normal", focus: "gained" });
  await modes.report(4, { frame_id: TOP, mode: "normal", focus: "lost" });
  assert.equal(await modes.report(4, { frame_id: CHILD, mode: "insert", focus: "gained" }), "insert");
  assert.equal(await modes.recall(4), "insert");
});

test("the top frame losing focus keeps its mode for the tab", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "ignore", focus: "gained" });
  assert.equal(await modes.report(4, { frame_id: TOP, mode: "ignore", focus: "lost" }), undefined);
  assert.equal(await modes.recall(4), "ignore");
});

test("two tabs keep their own frames and modes", async () => {
  const modes = create_tab_modes(fake_storage());
  await Promise.all([
    modes.report(4, { frame_id: TOP, mode: "ignore" }),
    modes.report(5, { frame_id: TOP, mode: "normal" }),
    modes.report(5, { frame_id: CHILD, mode: "insert", focus: "gained" }),
    modes.report(4, { frame_id: CHILD, mode: "caret" }),
  ]);
  assert.equal(await modes.recall(4), "ignore");
  assert.equal(await modes.recall(5), "insert");
  await modes.forget_on_navigation(5, { status: "loading" });
  assert.equal(await modes.recall(4), "ignore");
  assert.equal(await modes.recall(5), "normal");
});

test("reports from two frames at once both land", async () => {
  const modes = create_tab_modes(fake_storage());
  await Promise.all([modes.report(4, { frame_id: TOP, mode: "ignore" }), modes.report(4, { frame_id: CHILD, mode: "insert", focus: "gained" })]);
  assert.equal(await modes.recall(4), "insert");
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: "lost" });
  assert.equal(await modes.recall(4), "ignore", "the top frame's report was overwritten");
});

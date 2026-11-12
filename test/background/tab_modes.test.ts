import assert from "node:assert/strict";
import { test } from "node:test";
import { create_tab_modes, shortcut_allowed, read_insert_hold, write_insert_hold } from "../../src/background/tab_modes.ts";

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
  await modes.report(4, { frame_id: TOP, mode: "ignore", focus: true });
  assert.equal(await modes.recall(4), "ignore");
  await modes.forget(4);
  assert.deepEqual(storage.data, {});
});

test("in ignore mode only a shortcut that can run there goes through", () => {
  const commands = { "tab.next": { modes: ["normal"] }, "mode.leave": { modes: ["normal", "ignore"] } } as const;
  const get = (id: string) => (commands as Record<string, { modes: readonly ("normal" | "ignore")[] }>)[id];
  assert.equal(shortcut_allowed("ignore", [{ id: "tab.next" }], get, false), false);
  assert.equal(shortcut_allowed("ignore", [{ id: "mode.leave" }], get, false), true);
  assert.equal(shortcut_allowed("normal", [{ id: "tab.next" }], get, false), true);
});

test("starting the background clears every tab mode and nothing else", async () => {
  const storage = fake_storage();
  const modes = create_tab_modes(storage);
  await modes.report(4, { frame_id: TOP, mode: "ignore", focus: true });
  await modes.report(9, { frame_id: CHILD, mode: "insert", focus: true });
  await storage.set({ other_key: 1 });
  await modes.forget_all();
  assert.deepEqual(storage.data, { other_key: 1 });
});

test("a clear queued at start never removes a report that arrives during it", async () => {
  const storage = fake_storage();
  await storage.set({ desertfox_tab_mode_4: { top_mode: "ignore" } });
  const modes = create_tab_modes(storage);
  const cleared = modes.forget_all();
  const reported = modes.report(5, { frame_id: TOP, mode: "insert", focus: true });
  await Promise.all([cleared, reported]);
  assert.equal(await modes.recall(4), "normal");
  assert.equal(await modes.recall(5), "insert");
});

// Focus moving between frames

test("a child frame's mode stands for the tab only while its document holds the focus", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "normal", focus: true });
  assert.equal((await modes.report(4, { frame_id: CHILD, mode: "insert", focus: false })).child_mode, undefined);
  assert.equal(await modes.recall(4), "normal", "an unfocused child frame set the tab's mode");
  assert.equal((await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true })).child_mode, "insert");
  assert.equal(await modes.recall(4), "insert");
  assert.equal((await modes.report(4, { frame_id: CHILD, mode: "normal", focus: true })).child_mode, "normal");
  assert.equal(await modes.recall(4), "normal", "the focused child's later change was dropped");
});

test("focus moving to the top frame and back hands the tab's mode over each time", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "caret", focus: true });
  assert.equal((await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true })).child_mode, "insert");
  assert.equal(await modes.recall(4), "insert");
  assert.equal((await modes.report(4, { frame_id: TOP, mode: "caret", focus: true })).child_mode, undefined);
  assert.equal(await modes.recall(4), "caret");
  assert.equal((await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true })).child_mode, "insert");
  assert.equal(await modes.recall(4), "insert");
});

test("the top frame reporting without the focus leaves the focused child frame in place", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true });
  // Showing the tab fires focus on the top window while the child frame holds the focus, and the toolbar can change the top frame's mode then.
  assert.equal((await modes.report(4, { frame_id: TOP, mode: "caret", focus: false })).child_mode, "insert");
  assert.equal(await modes.recall(4), "insert");
  await modes.report(4, { frame_id: TOP, mode: "caret", focus: true });
  assert.equal(await modes.recall(4), "caret", "the top frame's mode from the report without focus was lost");
});

test("a report from the frame that lost the focus can arrive after the claim of the frame that took it", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true });
  await modes.report(4, { frame_id: OTHER_CHILD, mode: "caret", focus: true });
  assert.equal((await modes.report(4, { frame_id: CHILD, mode: "normal", focus: false })).child_mode, "caret", "a late report of the old frame took the focus off the new one");
  assert.equal(await modes.recall(4), "caret");
});

test("a focused child frame that reports without the focus gives the tab back to the top frame", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "normal", focus: true });
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true });
  assert.equal((await modes.report(4, { frame_id: CHILD, mode: "insert", focus: false })).child_mode, undefined);
  assert.equal(await modes.recall(4), "normal");
});

test("ignore mode in the top frame beats a focused child frame, until the top frame leaves it", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "ignore", focus: true });
  assert.deepEqual(await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true }), { child_mode: undefined, tell_top: false });
  assert.equal(await modes.recall(4), "ignore", "a field in a child frame hid ignore mode");
  // Leaving ignore mode hands the tab to the frame that still holds the focus.
  assert.deepEqual(await modes.report(4, { frame_id: TOP, mode: "normal", focus: false }), { child_mode: "insert", tell_top: true });
  assert.equal(await modes.recall(4), "insert");
  assert.deepEqual(await modes.report(4, { frame_id: TOP, mode: "ignore", focus: false }), { child_mode: undefined, tell_top: true });
  assert.equal(await modes.recall(4), "ignore");
});

// Frames loading

test("reports from two frames at once both land", async () => {
  const modes = create_tab_modes(fake_storage());
  await Promise.all([modes.report(4, { frame_id: TOP, mode: "caret", focus: false }), modes.report(4, { frame_id: CHILD, mode: "insert", focus: true })]);
  assert.equal(await modes.recall(4), "insert");
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: false });
  assert.equal(await modes.recall(4), "caret", "the top frame's report was overwritten");
});

test("a child frame that starts before the top frame's start report keeps the tab when it holds the focus", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true });
  await modes.report(4, { frame_id: TOP, mode: "normal", focus: false });
  assert.equal(await modes.recall(4), "insert");
});

test("a top frame claim sent before the focus moved, and delivered after the child's, heals on the child's next report", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: CHILD, mode: "normal", focus: true });
  await modes.report(4, { frame_id: TOP, mode: "normal", focus: true });
  assert.equal((await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true })).child_mode, "insert");
  assert.equal(await modes.recall(4), "insert");
});

test("a focused child frame that navigates hands the tab to the new page's start report", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "normal", focus: false });
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true });
  assert.equal((await modes.report(4, { frame_id: CHILD, mode: "normal", focus: true })).child_mode, "normal");
  assert.equal(await modes.recall(4), "normal");
});

test("two tabs keep their own frames and modes", async () => {
  const modes = create_tab_modes(fake_storage());
  await Promise.all([
    modes.report(4, { frame_id: TOP, mode: "ignore", focus: true }),
    modes.report(5, { frame_id: TOP, mode: "normal", focus: false }),
    modes.report(5, { frame_id: CHILD, mode: "insert", focus: true }),
    modes.report(4, { frame_id: CHILD, mode: "caret", focus: false }),
  ]);
  assert.equal(await modes.recall(4), "ignore");
  assert.equal(await modes.recall(5), "insert");
  await modes.forget_on_navigation(5, { status: "loading" });
  assert.equal(await modes.recall(4), "ignore");
  assert.equal(await modes.recall(5), "normal");
});

test("a report that changes nothing writes nothing, and the top frame hears the child mode on each of its own reports", async () => {
  const storage = fake_storage();
  let writes = 0;
  const set = storage.set;
  storage.set = (items) => (writes++, set(items));
  const modes = create_tab_modes(storage);
  // A top frame shown again from the back-forward cache still draws the child mode it had, so it hears that no child frame holds the focus.
  assert.deepEqual(await modes.report(4, { frame_id: TOP, mode: "normal", focus: true }), { child_mode: undefined, tell_top: true });
  assert.equal((await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true })).tell_top, true);
  assert.equal(writes, 2);
  // The same reports again, as each focus and pageshow sends them.
  assert.equal((await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true })).tell_top, false);
  assert.equal((await modes.report(4, { frame_id: OTHER_CHILD, mode: "normal", focus: false })).tell_top, false);
  assert.equal(writes, 2);
  // A top frame that just started has not heard of the focused child frame.
  assert.deepEqual(await modes.report(4, { frame_id: TOP, mode: "normal", focus: false }), { child_mode: "insert", tell_top: true });
  assert.equal(writes, 2);
  assert.deepEqual(await modes.report(4, { frame_id: CHILD, mode: "insert", focus: false }), { child_mode: undefined, tell_top: true });
});

// Navigation clearing the stored mode

const NEW_PAGE = "https://example.org/new";

test("a load that starts forgets the tab's mode and its focused frame, other updates keep them", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true });
  await modes.forget_on_navigation(4, { status: "complete" });
  await modes.forget_on_navigation(4, { status: "complete", url: "https://example.org/pushed" });
  assert.equal(await modes.recall(4), "insert");
  await modes.forget_on_navigation(4, { status: "loading" });
  assert.equal(await modes.recall(4), "normal");
  await modes.report(4, { frame_id: TOP, mode: "normal", focus: false });
  assert.equal(await modes.recall(4), "normal", "the old page's focused frame came back");
});

test("a report the old page sends after the load started does not outlive it", async () => {
  const storage = fake_storage();
  const modes = create_tab_modes(storage);
  await modes.report(4, { frame_id: TOP, mode: "ignore", focus: true });
  await modes.forget_on_navigation(4, { status: "loading" });
  // The old page stays until the new one takes over. A page with no content script, an about: page, would never correct this.
  await modes.report(4, { frame_id: TOP, mode: "ignore", focus: true });
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true });
  await modes.forget_on_navigation(4, { status: "loading", url: NEW_PAGE });
  assert.equal(await modes.recall(4), "normal");
  assert.deepEqual(storage.data, {});
});

test("an address change by the page itself while it loads keeps the mode it reported at start", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.forget_on_navigation(4, { status: "loading" });
  await modes.forget_on_navigation(4, { status: "loading", url: NEW_PAGE });
  await modes.report(4, { frame_id: TOP, mode: "caret", focus: false });
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true });
  // history.replaceState during the load: Firefox reports it as loading with a url, as it does the new page taking over.
  await modes.forget_on_navigation(4, { status: "loading", url: `${NEW_PAGE}?tab=1` });
  assert.equal(await modes.recall(4), "insert");
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: false });
  assert.equal(await modes.recall(4), "caret");
});

test("a load that ends with no new page keeps the mode through the old page's next address change", async () => {
  const storage = fake_storage();
  const modes = create_tab_modes(storage);
  // A download link or a stopped load: the load starts and completes, and the page stays.
  await modes.forget_on_navigation(4, { status: "loading" });
  await modes.report(4, { frame_id: TOP, mode: "ignore", focus: true });
  await modes.forget_on_navigation(4, { status: "complete" });
  assert.deepEqual(storage.data, { desertfox_tab_mode_4: { top_mode: "ignore" } });
  await modes.forget_on_navigation(4, { status: "complete", url: "https://example.org/pushed" });
  await modes.forget_on_navigation(4, { status: "loading", url: "https://example.org/pushed" });
  assert.equal(await modes.recall(4), "ignore");
});

test("a start report that overtakes the new page's address change is lost, and the report at the end of the load brings it back", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.forget_on_navigation(4, { status: "loading" });
  await modes.report(4, { frame_id: TOP, mode: "ignore", focus: true });
  await modes.forget_on_navigation(4, { status: "loading", url: NEW_PAGE });
  assert.equal(await modes.recall(4), "normal");
  // The content script reports again on pageshow.
  await modes.report(4, { frame_id: TOP, mode: "ignore", focus: true });
  assert.equal(await modes.recall(4), "ignore");
});

test("a navigation and a report at once run in arrival order", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "ignore", focus: true });
  await Promise.all([modes.forget_on_navigation(4, { status: "loading" }), modes.forget_on_navigation(4, { status: "loading", url: NEW_PAGE }), modes.report(4, { frame_id: TOP, mode: "insert", focus: true })]);
  assert.equal(await modes.recall(4), "insert");
});

test("while off no shortcut runs, ignore-capable ones included", () => {
  const get = () => ({ modes: ["normal", "ignore"] as const });
  assert.equal(shortcut_allowed("normal", [{ id: "tab.next" }], get, true), false);
  assert.equal(shortcut_allowed("ignore", [{ id: "mode.leave" }], get, true), false);
});

test("a navigation ends the insert hold, and a page's own address change keeps it", async () => {
  const storage = fake_storage();
  const modes = create_tab_modes(storage);
  await write_insert_hold(storage, 4);
  await modes.forget_on_navigation(4, { status: "loading", url: NEW_PAGE });
  assert.equal(await read_insert_hold(storage, 4), true);
  await modes.forget_on_navigation(4, { status: "loading" });
  assert.equal(await read_insert_hold(storage, 4), false);
  await write_insert_hold(storage, 4);
  await modes.forget_on_navigation(4, { status: "loading", url: NEW_PAGE });
  assert.equal(await read_insert_hold(storage, 4), false, "a hold the old page set after the load started reached the new page");
});

// The back-forward cache and the end of a load

test("a focused child frame that claims during a load keeps its claim through the load's end", async () => {
  const storage = fake_storage();
  const modes = create_tab_modes(storage);
  await modes.forget_on_navigation(4, { status: "loading" });
  await modes.report(4, { frame_id: TOP, mode: "normal", focus: false });
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true });
  await modes.forget_on_navigation(4, { status: "complete" });
  assert.equal(await modes.recall(4), "insert", "the end of the load dropped the focused child frame");
  assert.deepEqual(storage.data, { desertfox_tab_mode_4: { top_mode: "normal", focused_child: { frame_id: CHILD, mode: "insert" } } });
});

test("a load start that arrives after the page's restore reports wipes the child claim, and the next top report tells the top frame", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: TOP, mode: "normal", focus: true });
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true });
  // A page restored from the back-forward cache reports on pageshow, and Firefox may send the load start after it.
  await modes.report(4, { frame_id: TOP, mode: "normal", focus: false });
  await modes.forget_on_navigation(4, { status: "loading" });
  assert.equal(await modes.recall(4), "normal", "the record kept the child claim past the load start");
  // The top frame still draws the child mode it had, so a top report must reach it even though the record changes nothing.
  assert.deepEqual(await modes.report(4, { frame_id: TOP, mode: "normal", focus: false }), { child_mode: undefined, tell_top: true });
});

test("a top report heals a child mode the top frame still draws after the record lost it", async () => {
  const modes = create_tab_modes(fake_storage());
  await modes.report(4, { frame_id: CHILD, mode: "insert", focus: true });
  await modes.forget_on_navigation(4, { status: "loading" });
  await modes.forget_on_navigation(4, { status: "loading", url: NEW_PAGE });
  const healed = await modes.report(4, { frame_id: TOP, mode: "normal", focus: true });
  assert.equal(healed.tell_top, true, "the top frame was left drawing the lost child mode");
  assert.equal(healed.child_mode, undefined);
});

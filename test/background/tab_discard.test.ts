import assert from "node:assert/strict";
import { test } from "node:test";
import { describe_result, set_unloaded } from "../../src/background/tab_discard.ts";
import type { DiscardDeps, DiscardTab } from "../../src/background/tab_discard.ts";

// A small browser: `tabs.discard` does nothing for the active tab and for ids in `privileged`, as Firefox does, and never rejects.
function make(tabs: Partial<DiscardTab>[], { alternate, privileged = [] as number[] } = {} as { alternate?: number; privileged?: number[] }) {
  const state: DiscardTab[] = tabs.map((tab, index) => ({ id: index + 1, window_id: 1, index, active: false, audible: false, discarded: false, ...tab }));
  const log: string[] = [];
  const deps: DiscardDeps = {
    read_tab: async (id) => state.find((tab) => tab.id === id),
    tabs_in_window: async (window_id) => state.filter((tab) => tab.window_id === window_id),
    alternate_of: async () => alternate,
    activate: async (id) => {
      log.push(`activate ${id}`);
      const target = state.find((tab) => tab.id === id)!;
      for (const tab of state) if (tab.window_id === target.window_id) tab.active = tab.id === id;
    },
    discard: async (id) => {
      log.push(`discard ${id}`);
      const tab = state.find((candidate) => candidate.id === id)!;
      if (!tab.active && !privileged.includes(id)) tab.discarded = true;
    },
    reload: async (id) => {
      log.push(`reload ${id}`);
      state.find((tab) => tab.id === id)!.discarded = false;
    },
  };
  return { deps, log, state };
}

test("unloading the current tab switches to the alternate first, then discards", async () => {
  const { deps, log } = make([{}, {}, { active: true }], { alternate: 1 });
  const result = await set_unloaded(deps, [3], true, { leave_active: 3 });
  assert.deepEqual(log, ["activate 1", "discard 3"]);
  assert.deepEqual(result, { changed: [3], skipped: [] });
});

test("an unloaded alternate falls to the next loaded tab, then the previous one", async () => {
  const next = make([{ discarded: true }, { active: true }, { discarded: true }, {}], { alternate: 1 });
  await set_unloaded(next.deps, [2], true, { leave_active: 2 });
  assert.deepEqual(next.log, ["activate 4", "discard 2"]);
  const previous = make([{}, { discarded: true }, { active: true }, { discarded: true }], { alternate: 2 });
  await set_unloaded(previous.deps, [3], true, { leave_active: 3 });
  assert.deepEqual(previous.log, ["activate 1", "discard 3"]);
});

test("the switch never lands on a tab that unloads in the same call", async () => {
  const { deps, log } = make([{}, { active: true }, {}], { alternate: 3 });
  const result = await set_unloaded(deps, [2, 3], true, { leave_active: 2 });
  assert.deepEqual(log, ["activate 1", "discard 2", "discard 3"]);
  assert.deepEqual(result.changed, [2, 3]);
});

test("with every other tab unloaded the current tab is refused and nothing switches", async () => {
  const { deps, log } = make([{ discarded: true }, { active: true }]);
  const result = await set_unloaded(deps, [2], true, { leave_active: 2 });
  assert.deepEqual(log, []);
  assert.deepEqual(result, { changed: [], skipped: [{ id: 2, reason: "no other loaded tab to switch to" }] });
});

test("a page Firefox will not discard is reported as skipped and focus returns to it", async () => {
  const { deps, log } = make([{}, { active: true }], { privileged: [2] });
  const result = await set_unloaded(deps, [2], true, { leave_active: 2 });
  assert.deepEqual(log, ["activate 1", "discard 2", "activate 2"]);
  assert.deepEqual(result, { changed: [], skipped: [{ id: 2, reason: "Firefox cannot unload this page" }] });
});

test("a privileged page that is not active is reported from the re-read, not assumed", async () => {
  const { deps } = make([{ active: true }, {}], { privileged: [2] });
  const result = await set_unloaded(deps, [2], true);
  assert.deepEqual(result, { changed: [], skipped: [{ id: 2, reason: "Firefox cannot unload this page" }] });
});

test("the active tab of a window is skipped unless it is the one to leave, which covers another window", async () => {
  const { deps, log } = make([{ active: true }, { window_id: 2, active: true }, { window_id: 2 }]);
  const result = await set_unloaded(deps, [1, 2, 3], true, { leave_active: 1 });
  assert.deepEqual(result.skipped, [{ id: 2, reason: "active in its window" }, { id: 1, reason: "no other loaded tab to switch to" }]);
  assert.deepEqual(result.changed, [3]);
  assert.deepEqual(log, ["discard 3"]);
});

test("a tab with no leave_active option is skipped when active", async () => {
  const { deps, log } = make([{ active: true }, {}]);
  assert.deepEqual(await set_unloaded(deps, [1], true), { changed: [], skipped: [{ id: 1, reason: "active in its window" }] });
  assert.deepEqual(log, []);
});

test("audible tabs are refused, even when named alone, and the current audible tab does not switch", async () => {
  const { deps, log } = make([{ audible: true }, { active: true, audible: true }, {}]);
  const result = await set_unloaded(deps, [1, 2, 3], true, { leave_active: 2 });
  assert.deepEqual(result, { changed: [3], skipped: [{ id: 1, reason: "audible" }, { id: 2, reason: "audible" }] });
  assert.deepEqual(log, ["discard 3"]);
});

test("already unloaded tabs are skipped on unload, loaded tabs on load, and a gone tab is reported", async () => {
  const { deps, log } = make([{ discarded: true }, {}]);
  assert.deepEqual(await set_unloaded(deps, [1, 9], true), { changed: [], skipped: [{ id: 1, reason: "already unloaded" }, { id: 9, reason: "closed" }] });
  assert.deepEqual(await set_unloaded(deps, [1, 2], false), { changed: [1], skipped: [{ id: 2, reason: "already loaded" }] });
  assert.deepEqual(log, ["reload 1"]);
});

test("load reloads in place and never activates", async () => {
  const { deps, log } = make([{ active: true }, { discarded: true }]);
  await set_unloaded(deps, [2], false, { leave_active: 1 });
  assert.deepEqual(log, ["reload 2"]);
});

test("the result line counts changes and merges equal reasons", () => {
  assert.equal(describe_result("unloaded", { changed: [1, 2, 3], skipped: [{ id: 4, reason: "audible" }] }), "unloaded 3 tabs, skipped 1 (audible)");
  assert.equal(describe_result("loaded", { changed: [1], skipped: [] }), "loaded 1 tab");
  assert.equal(describe_result("unloaded", { changed: [], skipped: [{ id: 1, reason: "audible" }, { id: 2, reason: "audible" }, { id: 3, reason: "closed" }] }), "unloaded 0 tabs, skipped 3 (audible x2, closed)");
});

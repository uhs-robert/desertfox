import assert from "node:assert/strict";
import { test } from "node:test";
import { focus_other_pane, NOT_IN_SPLIT, swap_panes } from "../../src/background/tab_split.ts";
import type { SplitTab, TabSplitDeps } from "../../src/background/tab_split.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";

const strip = (split_ids: number[]): SplitTab[] => split_ids.map((split_id, index) => ({ id: 10 + index, index, split_id }));

function make(tabs: SplitTab[]) {
  const log: string[] = [];
  const deps: TabSplitDeps = {
    window_tabs_of: async (tab_id) => (tabs.some((tab) => tab.id === tab_id) ? tabs : []),
    activate: async (id) => void log.push(`activate ${id}`),
    move: async (id, index) => void log.push(`move ${id} ${index}`),
  };
  return { deps, log };
}

const refused = (pattern: RegExp) => (error: unknown) => error instanceof RuntimeRefusal && pattern.test(error.message);

test("focus_other_pane activates the partner from either tab of the pair", async () => {
  const { deps, log } = make(strip([-1, 4, 4, -1]));
  await focus_other_pane(deps, 11);
  await focus_other_pane(deps, 12);
  assert.deepEqual(log, ["activate 12", "activate 11"]);
});

test("focus_other_pane pairs by split id, so two splits in one window stay apart", async () => {
  const { deps, log } = make(strip([4, 9, 4, 9]));
  await focus_other_pane(deps, 10);
  await focus_other_pane(deps, 13);
  assert.deepEqual(log, ["activate 12", "activate 11"]);
});

test("a tab in no split view is refused, and so is a split with no partner left in the window", async () => {
  const { deps } = make(strip([-1, 4, -1]));
  await assert.rejects(focus_other_pane(deps, 10), refused(new RegExp(NOT_IN_SPLIT)));
  await assert.rejects(focus_other_pane(deps, 11), refused(/not in a split view/));
  await assert.rejects(swap_panes(deps, 10), refused(/not in a split view/));
});

test("a tab that is gone is refused by name", async () => {
  const { deps } = make(strip([4, 4]));
  await assert.rejects(focus_other_pane(deps, 99), refused(/the active tab is gone/));
});

test("swap_panes moves the partner onto the tab's place, from either side", async () => {
  const { deps, log } = make(strip([-1, 4, 4]));
  await swap_panes(deps, 11);
  await swap_panes(deps, 12);
  assert.deepEqual(log, ["move 12 1", "move 11 2"]);
});

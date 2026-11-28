import assert from "node:assert/strict";
import { test } from "node:test";
import { highlight_indexes, make_tab_visual_handler, moved_cursor, range_between, visible_order } from "../../src/background/tab_visual.ts";
import type { RangeRecord, TabVisualDeps, VisualTab } from "../../src/background/tab_visual.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";

const tab = (id: number, over: Partial<VisualTab> = {}): VisualTab => ({ id, index: id - 1, active: false, hidden: false, group_id: -1, ...over });

function make(tabs: VisualTab[], collapsed: number[] = [], record?: RangeRecord) {
  const log: string[] = [];
  let stored = record;
  let highlighted = 1;
  const deps: TabVisualDeps = {
    tabs_in_window: async () => tabs,
    collapsed_group_ids: async () => new Set(collapsed),
    highlighted_count: async () => highlighted,
    highlight: async (_window, indexes) => (log.push(`highlight ${indexes.join(",")}`), void (highlighted = indexes.length)),
    read_record: async () => stored,
    write_record: async (_window, next) => void (stored = next),
    remove_record: async () => void (stored = undefined),
  };
  return { handler: make_tab_visual_handler(deps), log, record: () => stored };
}

const five = (active = 3) => [1, 2, 3, 4, 5].map((id) => tab(id, { active: id === active }));
const run = (handler: ReturnType<typeof make>["handler"], action: "start" | "down" | "up" | "first" | "last" | "end", count = 1) => handler.run(1, { action, count });

test("the visible order skips hidden tabs and tabs of a collapsed group, but keeps the active tab", () => {
  const tabs = [tab(1), tab(2, { hidden: true }), tab(3, { group_id: 9 }), tab(4, { group_id: 9, active: true }), tab(5)];
  assert.deepEqual(visible_order(tabs, new Set([9])).map((one) => one.id), [1, 4, 5]);
  assert.deepEqual(visible_order(tabs, new Set()).map((one) => one.id), [1, 3, 4, 5]);
});

test("the order follows the index, not the order of the answer", () => {
  assert.deepEqual(visible_order([tab(3), tab(1), tab(2)], new Set()).map((one) => one.id), [1, 2, 3]);
});

test("moves clamp at the ends, and a lost cursor restarts from the anchor", () => {
  const order = five();
  assert.equal(moved_cursor(order, { anchor: 3, cursor: 3 }, "down", 9), 5);
  assert.equal(moved_cursor(order, { anchor: 3, cursor: 2 }, "up", 9), 1);
  assert.equal(moved_cursor(order, { anchor: 3, cursor: 3 }, "first", 1), 1);
  assert.equal(moved_cursor(order, { anchor: 3, cursor: 3 }, "last", 1), 5);
  assert.equal(moved_cursor(order, { anchor: 3, cursor: 99 }, "down", 1), 4);
});

test("the highlight lists the active tab first, then the rest ascending", () => {
  const order = five();
  assert.deepEqual(highlight_indexes(2, range_between(order, 3, 1)), [2, 0, 1]);
  assert.deepEqual(highlight_indexes(2, range_between(order, 3, 5)), [2, 3, 4]);
});

test("start needs two visible tabs and records the active tab as both ends", async () => {
  const lone = make([tab(1, { active: true }), tab(2, { hidden: true })]);
  await assert.rejects(run(lone.handler, "start"), (error) => error instanceof RuntimeRefusal && /Only one tab/.test(error.message));
  const two = make(five());
  await run(two.handler, "start");
  assert.deepEqual(two.record(), { anchor: 3, cursor: 3 });
  assert.deepEqual(two.log, []);
});

test("j and k grow the range, cross the anchor to shrink one side and grow the other", async () => {
  const { handler, log } = make(five());
  await run(handler, "start");
  await run(handler, "down");
  await run(handler, "down");
  await run(handler, "up", 3);
  await run(handler, "first");
  await run(handler, "last");
  assert.deepEqual(log, ["highlight 2,3", "highlight 2,3,4", "highlight 2,1", "highlight 2,0,1", "highlight 2,3,4"]);
});

test("a count moves that many tabs", async () => {
  const { handler, log, record } = make(five(1));
  await run(handler, "start");
  await run(handler, "down", 3);
  assert.deepEqual(log, ["highlight 0,1,2,3"]);
  assert.deepEqual(record(), { anchor: 1, cursor: 4 });
});

test("a collapsed group is stepped over", async () => {
  const tabs = [tab(1, { active: true }), tab(2, { group_id: 9 }), tab(3, { group_id: 9 }), tab(4)];
  const { handler, log } = make(tabs, [9]);
  await run(handler, "start");
  await run(handler, "down");
  assert.deepEqual(log, ["highlight 0,3"]);
});

test("a record whose anchor is not the active tab starts over at the active tab", async () => {
  const { handler, log, record } = make(five(4), [], { anchor: 1, cursor: 2 });
  await run(handler, "down");
  assert.deepEqual(log, ["highlight 3,4"]);
  assert.deepEqual(record(), { anchor: 4, cursor: 5 });
});

test("end clears the selection to the current active tab and drops the record", async () => {
  const { handler, log, record } = make(five());
  await run(handler, "start");
  await run(handler, "down");
  await run(handler, "end");
  assert.deepEqual(log, ["highlight 2,3", "highlight 2"]);
  assert.equal(record(), undefined);
});

test("end leaves the selection alone when the active tab is no longer the anchor", async () => {
  const { handler, log, record } = make(five(4), [], { anchor: 3, cursor: 5 });
  await run(handler, "end");
  assert.deepEqual(log, []);
  assert.equal(record(), undefined);
});

test("end with no record leaves a mouse selection alone, and with one tab selected only drops the record", async () => {
  const none = make(five());
  await run(none.handler, "end");
  assert.deepEqual(none.log, []);
  const settled = make(five(), [], { anchor: 3, cursor: 4 });
  await run(settled.handler, "end");
  assert.deepEqual(settled.log, []);
  assert.equal(settled.record(), undefined);
});

test("forgetting a window drops its record", async () => {
  const { handler, record } = make(five(), [], { anchor: 3, cursor: 4 });
  await handler.forget_window(1);
  assert.equal(record(), undefined);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { make_tab_visual_handler, moved_cursor, range_between, visible_order } from "../../src/background/tab_visual.ts";
import type { RangeRecord, TabVisualDeps, VisualTab } from "../../src/background/tab_visual.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";

const tab = (id: number, over: Partial<VisualTab> = {}): VisualTab => ({ id, index: id - 1, active: false, highlighted: false, hidden: false, group_id: -1, ...over });

// The fake keeps Firefox's rule that the active tab is always selected. The log holds one entry per tab added (+) or taken out (-).
function make(tabs: VisualTab[], collapsed: number[] = [], record?: RangeRecord) {
  const log: string[] = [];
  let stored = record;
  const deps: TabVisualDeps = {
    tabs_in_window: async () => tabs.map((one) => ({ ...one, highlighted: one.highlighted || one.active })),
    collapsed_group_ids: async () => new Set(collapsed),
    set_highlighted: async (id, on) => {
      log.push(`${on ? "+" : "-"}${id}`);
      tabs.find((one) => one.id === id)!.highlighted = on;
    },
    read_record: async () => stored,
    write_record: async (_window, next) => void (stored = next),
    remove_record: async () => void (stored = undefined),
  };
  const selected = () => tabs.filter((one) => one.highlighted || one.active).map((one) => one.id);
  return { handler: make_tab_visual_handler(deps), log, record: () => stored, selected };
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

test("start needs two visible tabs and records the active tab as both ends", async () => {
  const lone = make([tab(1, { active: true }), tab(2, { hidden: true })]);
  await assert.rejects(run(lone.handler, "start"), (error) => error instanceof RuntimeRefusal && /Only one tab/.test(error.message));
  const two = make(five());
  await run(two.handler, "start");
  assert.deepEqual(two.record(), { anchor: 3, cursor: 3 });
  assert.deepEqual(two.log, []);
});

test("j and k grow the range, cross the anchor to shrink one side and grow the other, and never touch the active tab", async () => {
  const { handler, log, selected } = make(five());
  const after: number[][] = [];
  await run(handler, "start");
  for (const [action, count] of [["down", 1], ["down", 1], ["up", 3], ["first", 1], ["last", 1]] as const) {
    await run(handler, action, count);
    after.push(selected());
  }
  assert.deepEqual(after, [[3, 4], [3, 4, 5], [2, 3], [1, 2, 3], [3, 4, 5]]);
  assert.ok(!log.some((entry) => entry.endsWith("3")), `the active tab was touched: ${log}`);
});

test("a move changes only the tabs that enter or leave the range", async () => {
  const { handler, log } = make(five());
  await run(handler, "start");
  await run(handler, "down", 2);
  log.length = 0;
  await run(handler, "up");
  assert.deepEqual(log, ["-5"]);
});

test("a count moves that many tabs", async () => {
  const { handler, record, selected } = make(five(1));
  await run(handler, "start");
  await run(handler, "down", 3);
  assert.deepEqual(selected(), [1, 2, 3, 4]);
  assert.deepEqual(record(), { anchor: 1, cursor: 4 });
});

test("a collapsed group is stepped over", async () => {
  const tabs = [tab(1, { active: true }), tab(2, { group_id: 9 }), tab(3, { group_id: 9 }), tab(4)];
  const { handler, selected } = make(tabs, [9]);
  await run(handler, "start");
  await run(handler, "down");
  assert.deepEqual(selected(), [1, 4]);
});

test("start clears a mouse selection to the active tab", async () => {
  const tabs = five().map((one) => (one.id === 1 || one.id === 5 ? { ...one, highlighted: true } : one));
  const { handler, selected, record } = make(tabs);
  await run(handler, "start");
  assert.deepEqual(selected(), [3]);
  assert.deepEqual(record(), { anchor: 3, cursor: 3 });
});

test("a move with no record does nothing, as a late key or a typed command in normal mode", async () => {
  const { handler, log, record } = make(five());
  await run(handler, "down");
  assert.deepEqual(log, []);
  assert.equal(record(), undefined);
});

test("a move after a tab switch does nothing", async () => {
  const { handler, log, record } = make(five(4), [], { anchor: 1, cursor: 2 });
  await run(handler, "down");
  assert.deepEqual(log, []);
  assert.deepEqual(record(), { anchor: 1, cursor: 2 });
});

test("end clears the selection to the active tab and drops the record", async () => {
  const { handler, record, selected } = make(five());
  await run(handler, "start");
  await run(handler, "down");
  await run(handler, "end");
  assert.deepEqual(selected(), [3]);
  assert.equal(record(), undefined);
});

test("end after a tab switch takes the old range out and leaves the new active tab", async () => {
  const tabs = five(4).map((one) => (one.id === 3 ? { ...one, highlighted: true } : one));
  const { handler, log, record, selected } = make(tabs, [], { anchor: 3, cursor: 5 });
  await run(handler, "end");
  assert.deepEqual(log, ["-3"]);
  assert.deepEqual(selected(), [4]);
  assert.equal(record(), undefined);
});

test("end with no record leaves a mouse selection alone", async () => {
  const tabs = five().map((one) => (one.id === 4 ? { ...one, highlighted: true } : one));
  const { handler, log, selected } = make(tabs);
  await run(handler, "end");
  assert.deepEqual(log, []);
  assert.deepEqual(selected(), [3, 4]);
});

test("an action waits for a move that has arrived but not reached the handler yet", async () => {
  const { handler, selected } = make(five());
  await run(handler, "start");
  let deliver!: () => void;
  const routed = new Promise<void>((resolve) => (deliver = resolve));
  // The move's message takes a slow path: it reaches the handler only after the action has asked for the range.
  const answer = routed.then(() => run(handler, "down"));
  handler.received(answer);
  const seen = handler.idle().then(() => selected());
  deliver();
  assert.deepEqual(await seen, [3, 4]);
});

test("a move that fails does not block the next action", async () => {
  const { handler } = make(five());
  handler.received(Promise.reject(new Error("refused")));
  await handler.idle();
});

test("forgetting a window drops its record", async () => {
  const { handler, record } = make(five(), [], { anchor: 3, cursor: 4 });
  await handler.forget_window(1);
  assert.equal(record(), undefined);
});

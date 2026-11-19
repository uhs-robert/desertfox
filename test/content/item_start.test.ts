import assert from "node:assert/strict";
import { test } from "node:test";
import { create_item_start, ROW_ITEMS_WAIT_MS } from "../../src/content/item/start.ts";

function make(overrides: Partial<Parameters<typeof create_item_start>[0]> = {}) {
  const idle: (() => void)[] = [];
  // The looks the start put off, run in order by `pass`.
  const timers: { run: () => void; ms: number }[] = [];
  let entered = 0;
  const state = { mode: "normal", active: false, field: false, list: true };
  const start = create_item_start({
    mode_: () => state.mode,
    user_active_: () => state.active,
    in_field_: () => state.field,
    has_list_: () => state.list,
    enter_: () => void entered++,
    when_idle_: (run) => void idle.push(run),
    later_: (run, ms) => void timers.push({ run, ms }),
    ...overrides,
  });
  // Runs the looks put off until `ms` have passed, or until none is left.
  const pass = (ms: number) => {
    for (let passed = 0; timers.length > 0 && passed < ms; ) {
      const next = timers.shift()!;
      passed += next.ms;
      next.run();
    }
  };
  return { start, state, idle, timers, pass, entered: () => entered };
}

test("a page with a list in normal mode enters item mode once it is idle, and not before", () => {
  const { start, idle, entered } = make();
  start();
  assert.equal(entered(), 0);
  idle[0]!();
  assert.equal(entered(), 1);
});

test("the user's first key or click wins: a page that took one, a field with the focus and another mode start nothing", () => {
  for (const [name, change] of [["a key", { active: true }], ["a field", { field: true }], ["insert mode", { mode: "insert" }], ["item mode", { mode: "item" }], ["no list", { list: false }]] as const) {
    const { start, state, idle, entered } = make();
    start();
    // The user acted between the ask and the idle moment.
    Object.assign(state, change);
    idle[0]!();
    assert.equal(entered(), 0, name);
  }
});

test("the ask is spent at once, so a second ask after Escape, or after a page with no list, starts nothing", () => {
  const { start, state, idle, entered } = make();
  start();
  idle[0]!();
  assert.equal(entered(), 1);
  // The user pressed Escape: the mode is normal again and the list is still there.
  state.mode = "normal";
  start();
  start();
  assert.equal(idle.length, 1, "a spent ask schedules nothing");
  assert.equal(entered(), 1);
  const none = make();
  none.state.list = false;
  none.start();
  none.idle[0]!();
  none.state.list = true;
  none.start();
  assert.equal(none.idle.length, 1);
  assert.equal(none.entered(), 0);
});

test("the finder is not read until the page is idle", () => {
  let reads = 0;
  const { start, idle } = make({ has_list_: () => (reads++, true) });
  start();
  assert.equal(reads, 0);
  idle[0]!();
  assert.equal(reads, 1);
});

test("the row's item selectors go to the list read, and with none the finder reads", () => {
  const read_with: (readonly string[])[] = [];
  const row = make({ has_list_: (selectors) => (read_with.push(selectors), true) });
  row.start(["tr.athing", "li"]);
  row.idle[0]!();
  const finder = make({ has_list_: (selectors) => (read_with.push(selectors), true) });
  finder.start();
  finder.idle[0]!();
  assert.deepEqual(read_with, [["tr.athing", "li"], []]);
});

test("a row's items drawn after the load start the mode within the wait, and the finder looks only once", () => {
  const late = make();
  late.state.list = false;
  late.start(["div.file"]);
  late.idle[0]!();
  late.pass(2000);
  assert.equal(late.entered(), 0);
  late.state.list = true;
  late.pass(250);
  assert.equal(late.entered(), 1);
  assert.equal(late.timers.length, 0, "the wait ends once the mode starts");
  const finder = make();
  finder.state.list = false;
  finder.start();
  finder.idle[0]!();
  assert.equal(finder.timers.length, 0);
});

test("the wait for a row's items gives up after about 5 s, and a key or a field ends it at once", () => {
  const none = make();
  none.state.list = false;
  none.start(["div.file"]);
  none.idle[0]!();
  none.pass(ROW_ITEMS_WAIT_MS + 1000);
  assert.equal(none.timers.length, 0);
  none.state.list = true;
  none.start(["div.file"]);
  assert.equal(none.idle.length, 1, "the ask is spent");
  assert.equal(none.entered(), 0);
  for (const change of [{ active: true }, { field: true }, { mode: "insert" }]) {
    const keyed = make();
    keyed.state.list = false;
    keyed.start(["div.file"]);
    keyed.idle[0]!();
    keyed.pass(500);
    Object.assign(keyed.state, change, { list: true });
    keyed.pass(250);
    assert.equal(keyed.entered(), 0, JSON.stringify(change));
    assert.equal(keyed.timers.length, 0, "the wait stops");
  }
});

test("each look reads the gate right before it enters, so a mode the user picked during the wait stands", () => {
  const order: string[] = [];
  const { start, state, idle } = make({ mode_: () => (order.push("mode"), state.mode), has_list_: () => (order.push("list"), true), enter_: () => void order.push("enter") });
  start();
  idle[0]!();
  assert.deepEqual(order, ["mode", "list", "enter"]);
});

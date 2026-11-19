import assert from "node:assert/strict";
import { test } from "node:test";
import { create_item_start } from "../../src/content/item/start.ts";

function make(overrides: Partial<Parameters<typeof create_item_start>[0]> = {}) {
  const idle: (() => void)[] = [];
  let entered = 0;
  const state = { mode: "normal", active: false, field: false, list: true };
  const start = create_item_start({
    mode_: () => state.mode,
    user_active_: () => state.active,
    in_field_: () => state.field,
    has_list_: () => state.list,
    enter_: () => void entered++,
    when_idle_: (run) => void idle.push(run),
    ...overrides,
  });
  return { start, state, idle, entered: () => entered };
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

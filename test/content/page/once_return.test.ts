// The return after a one-shot normal command: back to the old mode once a mode the command opened ends, and nothing for a command that opens none.

import assert from "node:assert/strict";
import { test } from "node:test";
import { create_once_return } from "../../../src/content/page/once_return.ts";
import type { Mode } from "../../../src/shared/command.ts";

type FakeField = { isConnected: boolean; focused: number; focus: () => void };
const fake_field = (): FakeField => {
  const field: FakeField = { isConnected: true, focused: 0, focus: () => void field.focused++ };
  return field;
};

// The return runs a task after the mode change.
const tick = () => new Promise((resolve) => setTimeout(resolve));

function make(start_mode: Mode) {
  const state = { mode: start_mode, focused_editable: false, set: [] as Mode[] };
  const tracker = create_once_return({
    get_mode: () => state.mode,
    set_mode_: (mode) => void state.set.push(mode),
    focused_: () => null,
    is_editable_: () => state.focused_editable,
  });
  // As bundle_host's enter_mode_: every change reaches the tracker.
  const change = (mode: Mode) => {
    state.mode = mode;
    tracker.mode_changed_(mode);
  };
  let end!: () => void;
  const start = (focused: unknown = null) => tracker.start_(state.mode, focused as Element | null, new Promise<void>((resolve) => (end = resolve)));
  const settle = async () => (end(), await tick());
  return { state, change, start, settle, tracker };
}

test("a mode opened from a field ends in normal mode and the field takes the focus back", async () => {
  const { change, start, settle } = make("insert");
  const field = fake_field();
  start(field);
  change("visual");
  await settle();
  change("normal");
  await tick();
  assert.equal(field.focused, 1);
});

test("the Escape that ends the mode blurs after the mode change, and the field still takes the focus back", async () => {
  const { change, start, state } = make("insert");
  const field = fake_field();
  start(field);
  change("caret");
  // The field still holds the focus as the mode changes. As `mode.escape` does, the blur comes right after, in the same task.
  state.focused_editable = true;
  change("normal");
  state.focused_editable = false;
  await tick();
  assert.equal(field.focused, 1);
});

test("the field was removed meanwhile: nothing takes the focus and the frame stays in normal mode", async () => {
  const { change, start, state } = make("insert");
  const field = fake_field();
  start(field);
  change("cmdline");
  field.isConnected = false;
  change("normal");
  await tick();
  assert.equal(field.focused, 0);
  assert.deepEqual(state.set, []);
});

test("a field the command focused keeps the focus", async () => {
  const { change, start, state } = make("insert");
  const field = fake_field();
  start(field);
  change("hint");
  state.focused_editable = true;
  change("normal");
  await tick();
  assert.equal(field.focused, 0);
});

test("a mode opened from visual mode goes back to visual mode, through several modes", async () => {
  const { change, start, state } = make("visual");
  start();
  change("cmdline");
  change("caret");
  change("normal");
  await tick();
  assert.deepEqual(state.set, ["visual"]);
});

test("a command that opens no mode leaves nothing behind, so a later Escape stays in normal mode", async () => {
  const { change, start, settle, state } = make("visual");
  start();
  await settle();
  change("caret");
  change("normal");
  await tick();
  assert.deepEqual(state.set, []);
});

test("a command that only leaves the mode (a blur) does not bring it back", async () => {
  const { change, start } = make("insert");
  const field = fake_field();
  start(field);
  change("normal");
  change("hint");
  change("normal");
  await tick();
  assert.equal(field.focused, 0);
});

test("a mode that returns to the old mode by itself ends the return (hint mode from item mode)", async () => {
  const { change, start, state } = make("item");
  start();
  change("hint");
  change("item");
  change("normal");
  await tick();
  assert.deepEqual(state.set, []);
});

test("a change made before the bundle loaded counts: the start reads the mode now", async () => {
  const { change, state, tracker } = make("hint");
  // The command began in ignore mode, and hint mode had started by the time the start arrived.
  tracker.start_("ignore", null, new Promise(() => {}));
  change("normal");
  await tick();
  assert.deepEqual(state.set, ["ignore"]);
});

test("a start in normal mode tracks nothing", async () => {
  const { change, start, state } = make("normal");
  start();
  change("visual");
  change("normal");
  await tick();
  assert.deepEqual(state.set, []);
});

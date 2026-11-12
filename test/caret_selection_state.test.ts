import assert from "node:assert/strict";
import { test } from "node:test";
import { is_visual, line_span, retarget, selected_text } from "../src/content/caret/selection_state.ts";
import { yank_text } from "../src/content/caret/copy_text.ts";

const old_model = { text: "old" };
const new_model = { text: "new" };

test("retarget keeps the session object and resets what a new model invalidates", () => {
  const open = { model_: old_model, cursor: { anchor: 1, caret: 2 }, mode: "visual", goal_x_: 40 };
  const same = retarget(open, new_model, { anchor: 0, caret: 3 });
  assert.equal(same, open);
  assert.deepEqual(open, { model_: new_model, cursor: { anchor: 0, caret: 3 }, mode: "visual", goal_x_: undefined });
});

test("a pending yank still counts as the same session after a rebuild, so visual mode ends", async () => {
  const open = { model_: old_model, cursor: { anchor: 0, caret: 2 }, mode: "visual", goal_x_: undefined };
  const session: { current: object } = { current: open };
  let left_visual = false;
  Object.defineProperty(globalThis, "browser", { value: { runtime: { sendMessage: async () => ({ ok: true }) } }, configurable: true });
  const clipboard = { writeText: () => new Promise<void>((done) => setTimeout(done, 5)) };
  const pending = yank_text(clipboard as unknown as Clipboard, "old", undefined, {
    is_same_session_: () => session.current === open,
    toast: () => {},
    leave_visual_: () => (left_visual = true),
  });
  session.current = retarget(open, new_model, { anchor: 0, caret: 1 });
  await pending;
  assert.equal(left_visual, true);
});

// Screen lines of ten characters each, as a wrapped paragraph lays them out.
const rows_of_ten = { start_of_: (index: number) => index - (index % 10), end_of: (index: number) => index - (index % 10) + 9 };

test("a line span runs from the earlier end's line start to the later end's line end", () => {
  assert.deepEqual(line_span({ anchor: 13, caret: 27 }, rows_of_ten), { from: 10, to: 30 });
  assert.deepEqual(line_span({ anchor: 27, caret: 13 }, rows_of_ten), { from: 10, to: 30 });
});

test("a line span of one end covers its whole line", () => {
  assert.deepEqual(line_span({ anchor: 4, caret: 4 }, rows_of_ten), { from: 0, to: 10 });
  assert.equal(selected_text("first row second row", line_span({ anchor: 12, caret: 12 }, rows_of_ten)), "second row");
});

test("a line bound on the wrong side of its end leaves that end", () => {
  assert.deepEqual(line_span({ anchor: 5, caret: 8 }, { start_of_: (index) => index + 1, end_of: (index) => index - 1 }), { from: 5, to: 9 });
});

test("only caret mode is not visual", () => {
  assert.deepEqual((["caret", "visual", "visual_line"] as const).map(is_visual), [false, true, true]);
});

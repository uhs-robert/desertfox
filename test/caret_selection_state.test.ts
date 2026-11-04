import assert from "node:assert/strict";
import { test } from "node:test";
import { retarget } from "../src/content/caret/selection_state.ts";
import { yank_text } from "../src/content/caret/copy_text.ts";

const old_model = { text: "old" };
const new_model = { text: "new" };

test("retarget keeps the session object and resets what a new model invalidates", () => {
  const open = { model: old_model, cursor: { anchor: 1, caret: 2 }, mode: "visual", goal_x: 40, painted: [{ ends: [] }] };
  const same = retarget(open, new_model, { anchor: 0, caret: 3 });
  assert.equal(same, open);
  assert.deepEqual(open, { model: new_model, cursor: { anchor: 0, caret: 3 }, mode: "visual", goal_x: undefined, painted: [] });
});

test("a pending yank still counts as the same session after a rebuild, so visual mode ends", async () => {
  const open = { model: old_model, cursor: { anchor: 0, caret: 2 }, mode: "visual", goal_x: undefined, painted: [] };
  const session: { current: object } = { current: open };
  let left_visual = false;
  const clipboard = { writeText: () => new Promise<void>((done) => setTimeout(done, 5)) };
  const pending = yank_text(clipboard as unknown as Clipboard, "old", {
    is_same_session: () => session.current === open,
    toast: () => {},
    leave_visual: () => (left_visual = true),
  });
  session.current = retarget(open, new_model, { anchor: 0, caret: 1 });
  await pending;
  assert.equal(left_visual, true);
});

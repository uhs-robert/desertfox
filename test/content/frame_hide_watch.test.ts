import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { create_frame_hide_watch } from "../../src/content/frame_hide_watch.ts";

const real = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };

// A frame element whose look the test sets, and a clock the test turns.
function fixture(t: TestContext) {
  const frame = { contentWindow: {}, look: { visible: true, width: 300, height: 200 }, checkVisibility: () => frame.look.visible, getBoundingClientRect: () => ({ width: frame.look.width, height: frame.look.height }) };
  const doc = { activeElement: frame as unknown };
  const intervals: (() => void)[] = [];
  const cleared: unknown[] = [];
  Object.assign(globalThis, {
    setInterval: (callback: () => void) => intervals.push(callback),
    clearInterval: (id: unknown) => void cleared.push(id),
  });
  let taken = 0;
  t.after(() => Object.assign(globalThis, real));
  const watch = create_frame_hide_watch(() => void taken++, doc as Pick<Document, "activeElement">);
  const tick = () => intervals.at(-1)?.();
  return { frame, doc, intervals, watch, tick, taken: () => taken };
}

test("a shown frame that gets display none, visibility hidden or a tiny box gives the focus back", (t) => {
  for (const hide of [(look: { visible: boolean }) => (look.visible = false), (look: { width: number }) => (look.width = 1)]) {
    const { frame, watch, tick, taken } = fixture(t);
    watch(true);
    tick();
    hide(frame.look as never);
    tick();
    assert.equal(taken(), 1);
  }
});

test("a frame that starts hidden and then shows does not give the focus back", (t) => {
  const { frame, watch, tick, taken } = fixture(t);
  frame.look.visible = false;
  watch(true);
  tick();
  frame.look.visible = true;
  tick();
  assert.equal(taken(), 0);
});

test("a mode change in the frame arms the watch again without forgetting the frame was shown", (t) => {
  const { frame, watch, tick, intervals, taken } = fixture(t);
  watch(true);
  tick();
  watch(true);
  assert.equal(intervals.length, 1, "one timer");
  frame.look.visible = false;
  tick();
  assert.equal(taken(), 1);
});

test("the top frame's own focus pauses the check, and the end of the child's focus stops it", (t) => {
  const { frame, doc, watch, tick, taken } = fixture(t);
  watch(true);
  tick();
  // The command line holds the focus while the frame hides behind it.
  doc.activeElement = { tagName: "DIV" };
  frame.look.visible = false;
  tick();
  assert.equal(taken(), 0);
  watch(false);
  doc.activeElement = frame;
  watch(true);
  tick();
  assert.equal(taken(), 0, "a new watch starts from not shown");
});

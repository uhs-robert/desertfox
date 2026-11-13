import assert from "node:assert/strict";
import { test } from "node:test";
import { frame_cue_text } from "../../src/background/frame_cue.ts";

test("the cue names the key bound to frame.exit, and drops the second sentence when none is bound", () => {
  assert.equal(frame_cue_text("gF"), "Keys act in this frame. gF returns to the page.");
  assert.equal(frame_cue_text(undefined), "Keys act in this frame.");
});

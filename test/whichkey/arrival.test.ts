import assert from "node:assert/strict";
import { test } from "node:test";
import { create_arrival_guard } from "../../src/content/whichkey/arrival.ts";

test("a draw that arrives after a newer erase from the same frame is dropped", () => {
  const arrived = create_arrival_guard();
  assert.equal(arrived(5, 2), true, "the erase");
  assert.equal(arrived(5, 1), false, "the late draw");
  assert.equal(arrived(5, 3), true);
});

test("each frame counts on its own, and a message with no count is dropped", () => {
  const arrived = create_arrival_guard();
  assert.equal(arrived(5, 4), true);
  assert.equal(arrived(6, 1), true);
  assert.equal(arrived(5, 4), false, "a repeat");
  assert.equal(arrived(6, undefined), false);
});

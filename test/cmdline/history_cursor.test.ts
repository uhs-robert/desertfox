import assert from "node:assert/strict";
import { test } from "node:test";
import { create_history_cursor } from "../../src/cmdline/history_cursor.ts";

test("Up walks from the newest entry to the oldest and stops there", () => {
  const cursor = create_history_cursor(["a", "b", "c"]);
  assert.equal(cursor.prev(""), "c");
  assert.equal(cursor.prev("c"), "b");
  assert.equal(cursor.prev("b"), "a");
  assert.equal(cursor.prev("a"), undefined);
});

test("Down returns through the entries to the draft that was typed", () => {
  const cursor = create_history_cursor(["a", "b"]);
  assert.equal(cursor.prev("half typed"), "b");
  assert.equal(cursor.prev("b"), "a");
  assert.equal(cursor.next(), "b");
  assert.equal(cursor.next(), "half typed");
  assert.equal(cursor.next(), undefined);
});

test("an empty history has nothing to walk, and a reset starts again from the newest", () => {
  assert.equal(create_history_cursor([]).prev("x"), undefined);
  const cursor = create_history_cursor(["a", "b"]);
  cursor.prev("");
  cursor.prev("b");
  cursor.reset();
  assert.equal(cursor.prev(""), "b");
});

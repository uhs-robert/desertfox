import assert from "node:assert/strict";
import { test } from "node:test";
import { move_once } from "../src/content/caret/motion.ts";
import type { Motion, MotionUnit } from "../src/content/caret/motion.ts";
import { selected_text, swap_ends, with_caret } from "../src/content/caret/selection_state.ts";

// Indexes: "foo bar.baz" is 0-10, its "\n" is 11, the empty line is 12, "  qux quux" is 13-22, "\n" is 23, "last" is 24-27.
const TEXT = "foo bar.baz\n\n  qux quux\nlast";

const motion = (unit: MotionUnit, flags: Partial<Motion> = {}): Motion => ({ unit, direction: "forward", big: false, ...flags });

function after(from: number, steps: Motion[]): number {
  return steps.reduce((at, step) => move_once(TEXT, at, step), from);
}

test("w walks to word starts, stops on punctuation and on the empty line", () => {
  assert.deepEqual([0, 4, 7, 8, 12, 13].map((from) => move_once(TEXT, from, motion("word"))), [4, 7, 8, 12, 15, 15]);
  assert.equal(move_once(TEXT, 24, motion("word")), 27);
});

test("W treats punctuation as part of the word", () => {
  assert.equal(move_once(TEXT, 4, motion("word", { big: true })), 12);
});

test("b walks back to word starts", () => {
  assert.deepEqual([4, 12, 15, 8, 0].map((from) => move_once(TEXT, from, motion("word", { direction: "back" }))), [0, 8, 12, 7, 0]);
  assert.equal(move_once(TEXT, 12, motion("word", { direction: "back", big: true })), 4);
});

test("e walks to word ends across lines", () => {
  assert.deepEqual([0, 2, 6, 8, 10].map((from) => move_once(TEXT, from, motion("word_end"))), [2, 6, 7, 10, 17]);
  assert.equal(move_once(TEXT, 4, motion("word_end", { big: true })), 10);
});

test("h and l stay on their line", () => {
  assert.equal(move_once(TEXT, 10, motion("char")), 10);
  assert.equal(move_once(TEXT, 9, motion("char")), 10);
  assert.equal(move_once(TEXT, 13, motion("char", { direction: "back" })), 13);
  assert.equal(move_once(TEXT, 15, motion("char", { direction: "back" })), 14);
});

test("gg and G go to the first non-blank of the first and last line", () => {
  assert.equal(move_once(TEXT, 19, motion("start")), 0);
  assert.equal(move_once(TEXT, 3, motion("end")), 24);
});

test("a count repeats the motion", () => {
  assert.equal(after(0, [motion("word"), motion("word"), motion("word")]), 8);
  assert.equal(after(0, [motion("char"), motion("char"), motion("char"), motion("char")]), 4);
});

test("empty text keeps the caret at 0", () => {
  assert.equal(move_once("", 0, motion("word")), 0);
});

test("visual mode keeps the anchor and includes both ends", () => {
  let cursor = { anchor: 8, caret: 8 };
  cursor = with_caret(cursor, move_once(TEXT, cursor.caret, motion("word_end")), true);
  assert.deepEqual(cursor, { anchor: 8, caret: 10 });
  assert.equal(selected_text(TEXT, cursor), "baz");
  const swapped = swap_ends(cursor);
  assert.deepEqual(swapped, { anchor: 10, caret: 8 });
  assert.equal(selected_text(TEXT, swapped), "baz");
});

test("V, 3w, v, e yields the word the key test copies", () => {
  const text = "caret p7\nfoo bar.baz";
  let cursor = { anchor: 0, caret: 0 };
  for (let count = 0; count < 3; count++) cursor = with_caret(cursor, move_once(text, cursor.caret, motion("word")), false);
  cursor = { anchor: cursor.caret, caret: cursor.caret };
  cursor = with_caret(cursor, move_once(text, cursor.caret, motion("word_end")), true);
  assert.equal(selected_text(text, cursor), "bar");
});

test("word motions keep accented and non-Latin letters inside the word", () => {
  const text = "café über 日本語 x";
  assert.deepEqual([0, 5, 10].map((from) => move_once(text, from, motion("word"))), [5, 10, 14]);
  assert.deepEqual([0, 5].map((from) => move_once(text, from, motion("word_end"))), [3, 8]);
  assert.equal(move_once(text, 14, motion("word", { direction: "back" })), 10);
});

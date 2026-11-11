import assert from "node:assert/strict";
import { test } from "node:test";
import { select_object } from "../src/content/caret/text_object.ts";
import type { TextObject } from "../src/content/caret/text_object.ts";

// `at` is the caret, `to` makes a selection from `at` to `to`. The result is the selected text, or undefined for a refusal.
function take(text: string, at: number, kind: TextObject, to = at): string | undefined {
  const cursor = select_object(text, { anchor: at, caret: to }, kind);
  return cursor && text.slice(Math.min(cursor.anchor, cursor.caret), Math.max(cursor.anchor, cursor.caret) + 1);
}
const aw: TextObject = { object: "word", scope: "around" };
const iw: TextObject = { object: "word", scope: "inner" };
const as: TextObject = { object: "sentence", scope: "around" };
const is: TextObject = { object: "sentence", scope: "inner" };

test("aw takes the word and the blanks after it", () => {
  assert.equal(take("one two three", 5, aw), "two ");
  assert.equal(take("one two three", 0, aw), "one ");
});

test("aw takes the blanks before the word when none follow", () => {
  assert.equal(take("one two three", 10, aw), " three");
  assert.equal(take("one two\nthree", 5, aw), " two");
});

test("aw on punctuation takes the run of punctuation", () => {
  assert.equal(take("a.b, c", 1, aw), ".");
  assert.equal(take("foo(bar)", 3, aw), "(");
});

test("aw on blanks takes them with the next word", () => {
  assert.equal(take("one   two", 4, aw), "   two");
});

test("iw takes the word alone, and blanks alone", () => {
  assert.equal(take("one two three", 5, iw), "two");
  assert.equal(take("one   two", 4, iw), "   ");
});

test("aw on a selection grows it by one more word, iw by the next run", () => {
  assert.equal(take("one two three four", 0, aw, 3), "one two ");
  assert.equal(take("one two three four", 0, aw, 7), "one two three ");
  assert.equal(take("one two three", 0, iw, 2), "one ");
  assert.equal(take("one two three", 0, iw, 3), "one two");
});

test("a selection reaching the end of its line refuses to grow", () => {
  assert.equal(take("one two\nthree", 0, aw, 6), undefined);
  assert.equal(take("one two", 0, aw, 6), undefined);
});

test("an empty line has no object", () => {
  assert.equal(take("a\n\nb", 2, aw), undefined);
  assert.equal(take("\nb", 0, iw), undefined);
});

test("an object stays on the caret's line", () => {
  assert.equal(take("one\ntwo three", 4, aw), "two ");
});

test("as takes the sentence and the blanks after it, is the sentence alone", () => {
  const text = "First one. Second one! Third one.";
  assert.equal(take(text, 14, as), "Second one! ");
  assert.equal(take(text, 14, is), "Second one!");
  assert.equal(take(text, 0, as), "First one. ");
});

test("as on the last sentence takes the blanks before it", () => {
  assert.equal(take("First one. Second one.", 15, as), " Second one.");
});

test("a sentence does not break at a decimal point", () => {
  assert.equal(take("It is 3.5 miles. Then go.", 9, is), "It is 3.5 miles.");
});

test("as on the blanks between sentences takes them with the next sentence", () => {
  assert.equal(take("One. Two.", 4, as), " Two.");
});

test("as on a selection grows by the blanks and the next sentence", () => {
  const text = "One a. Two b. Three c.";
  assert.equal(take(text, 0, as, 5), "One a. Two b.");
});

test("a text object works past an astral character", () => {
  assert.equal(take("a \u{1F600}\u{1F600} b", 3, iw), "\u{1F600}\u{1F600}");
});

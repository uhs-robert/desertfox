import assert from "node:assert/strict";
import { test } from "node:test";
import { rank_items, score_text } from "../../src/content/hints/rank.ts";

const order = (texts: string[], query: string) => rank_items(texts, query).map((item) => item.index);

test("a whole word beats a prefix, and a prefix beats a substring", () => {
  assert.ok(score_text("cat", "cat") > score_text("cat", "catalog"));
  assert.ok(score_text("cat", "catalog") > score_text("cat", "concatenate"));
  assert.ok(score_text("cat", "concatenate") > 0);
});

test("the first word counts more than a later word, for whole words and for prefixes", () => {
  assert.ok(score_text("news", "news today") > score_text("news", "today news"));
  assert.ok(score_text("new", "news today") > score_text("new", "today news"));
});

test("every query word must match", () => {
  assert.ok(score_text("red car", "a red car") > 0);
  assert.equal(score_text("red boat", "a red car"), 0);
});

test("case does not matter, and punctuation splits words", () => {
  assert.equal(score_text("HELLO", "hello"), score_text("hello", "HELLO"));
  assert.ok(score_text("world", "hello,world") > score_text("world", "helloworld"));
});

test("a shorter text beats a longer one with the same match", () => {
  assert.ok(score_text("pay", "pay") > score_text("pay", "pay for the things in the cart"));
});

test("no match scores 0, and an empty query matches everything", () => {
  assert.equal(score_text("zzz", "one two"), 0);
  assert.ok(score_text("", "one two") > 0);
  assert.ok(score_text("  ", "") > 0);
});

test("rank_items orders by score, keeps source order on a tie, and drops non-matches", () => {
  assert.deepEqual(order(["xx news", "news", "other", "news"], "news"), [1, 3, 0]);
  assert.deepEqual(order(["b", "a", "c"], ""), [0, 1, 2]);
  assert.deepEqual(order([], "a"), []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { best_match, rank, score_candidate } from "../src/shared/score.ts";

const names = (query: string, list: string[]) => rank(query, list.map((name) => ({ name }))).map((item) => item.name);

test("letters must appear in order", () => {
  assert.equal(score_candidate("zt", { name: "tab" }), null);
  assert.notEqual(score_candidate("tb", { name: "tab" }), null);
});

test("the dot is a word break, so tc finds tab.close above a scattered match", () => {
  assert.equal(names("tc", ["tab.next", "window.close", "tracing", "tab.close"])[0], "tab.close");
});

test("the exact name comes first, then longer names", () => {
  assert.deepEqual(names("tab", ["tab.close", "tab", "tab.go"]), ["tab", "tab.go", "tab.close"]);
});

test("a tie goes to the shorter name, then to the source order", () => {
  assert.deepEqual(names("x", ["axb", "ax", "xa"]), ["xa", "ax", "axb"]);
  assert.deepEqual(names("a", ["b.a", "c.a"]), ["b.a", "c.a"]);
});

test("a name hit beats the same hit in the description or a keyword", () => {
  const ranked = rank("close", [{ name: "x1", description: "Close it." }, { name: "x2", keywords: ["close"] }, { name: "close" }]).map((item) => item.name);
  assert.deepEqual(ranked, ["close", "x1", "x2"]);
});

test("the final period of a description is not a letter to match", () => {
  assert.equal(score_candidate("tab.", { name: "other", description: "Close the tab." }), null);
});

test("every space-separated term must hit", () => {
  assert.notEqual(score_candidate("tab cl", { name: "tab.close" }), null);
  assert.equal(score_candidate("tab zz", { name: "tab.close" }), null);
});

test("only name hits give positions", () => {
  const [hit] = rank("tc", [{ name: "tab.close" }]);
  assert.deepEqual(hit?.positions, [0, 4]);
  assert.deepEqual(rank("zz", [{ name: "q", description: "zz" }])[0]?.positions, []);
});

test("an empty query keeps the order of the source", () => {
  assert.deepEqual(names("", ["b", "a"]), ["b", "a"]);
});

test("best_match names the one winner, a tie, or nothing", () => {
  const items = [{ name: "Mail" }, { name: "News" }, { name: "News" }];
  const by_name = (item: { name: string }) => item;
  assert.deepEqual(best_match("mail", items, by_name), { found: "one", item: items[0] });
  assert.deepEqual(best_match("news", items, by_name), { found: "tie", first: items[1], second: items[2] });
  assert.deepEqual(best_match("zzz", items, by_name), { found: "none" });
});

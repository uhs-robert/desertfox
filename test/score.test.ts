import assert from "node:assert/strict";
import { test } from "node:test";
import { best_match, type Candidate, MAX_BOOST, rank, score_candidate } from "../src/shared/score.ts";

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

test("a boost raises a hit by its fraction, capped, never lowers one, and never makes a miss a hit", () => {
  const plain = score_candidate("git", { name: "GitHub" })!.score;
  assert.equal(score_candidate("git", { name: "GitHub", boost: 0.5 })!.score, plain + plain * 0.5);
  assert.equal(score_candidate("git", { name: "GitHub", boost: 5 })!.score, plain + plain * MAX_BOOST);
  assert.equal(score_candidate("zzz", { name: "GitHub", boost: 0.5 }), null);
  // A long gappy hit scores below zero. The boost still raises it.
  const gappy = score_candidate("ae", { name: `a${"x".repeat(80)}e` })!.score;
  assert.ok(gappy < 0);
  assert.ok(score_candidate("ae", { name: `a${"x".repeat(80)}e`, boost: 0.5 })!.score > gappy);
});

test("use does not outrank an exact name", () => {
  assert.deepEqual(rank("git", [{ name: "GitHub", boost: MAX_BOOST }, { name: "git" }]).map((item) => item.name), ["git", "GitHub"]);
});

test("a boost breaks a tie in the list and in best_match alike", () => {
  const items = [{ name: "News one" }, { name: "News two", boost: 0.1 }];
  assert.equal(rank("news", items)[0]!.name, "News two");
  assert.deepEqual(best_match("news", items, (item) => item), { found: "one", item: items[1] });
});

test("several groups ranked as one list: the group breaks an equal score before the name length", () => {
  const items = [{ name: "a longer git name", group: 0 }, { name: "the git", group: 1 }];
  assert.deepEqual(rank("git", items, (item) => item.group).map((item) => item.name), ["a longer git name", "the git"]);
  assert.deepEqual(rank("git", items).map((item) => item.name), ["the git", "a longer git name"]);
});


// Order recorded from the scorer before the query was parsed once per list. A change here is a change in what the user sees first.
type Row = Candidate & { group?: number };
const varied_rows: Row[] = [
  { name: "tab.close", description: "Close the tab.", keywords: ["shut"] },
  { name: "tab.close_others", description: "Close every other tab" },
  { name: "tab.next", description: "Go to the next tab.", also_named: ["tab.forward"] },
  { name: "window.close", description: "Close the window" },
  { name: "GitHub Issues", description: "https://github.com/issues", boost: 0.3 },
  { name: "GitHub Pull Requests", description: "https://github.com/pulls" },
  { name: "git", description: "version control", boost: 0.6 },
  { name: "Gitea", description: "https://gitea.io" },
  { name: "tracing", description: "Trace calls" },
  { name: "Tab Groups", description: "Manage groups of tabs", keywords: ["tc", "collapse"] },
  { name: "toggleCamelCase", description: "camel humps" },
  { name: "history.clear", description: "Forget visited pages", keywords: ["tab", "close"] },
  { name: "bookmark-add", description: "Save this page as a bookmark" },
  { name: "Bookmarks Toolbar", description: "" },
  { name: "open (new tab)", description: "Open a URL in a new tab" },
  { name: "reload", description: "Reload the page", also_named: ["refresh", "r"] },
  { name: "reload_hard", description: "Reload ignoring the cache" },
  { name: "settings.theme", description: "Pick a colour theme", keywords: ["dark", "light"] },
  { name: "x1y2z3", description: "digits 42" },
  { name: "Mail  inbox", description: "  spaced   out  " },
  { name: "same", group: 1 }, { name: "same", group: 0 }, { name: "also same" },
];
const expected_order: [string, string[]][] = [
  ["tc", ["tab.close","tab.close_others","toggleCamelCase","tracing","history.clear","reload_hard","Tab Groups","GitHub Issues","GitHub Pull Requests"]],
  ["tab", ["tab.next","tab.close","Tab Groups","open (new tab)","tab.close_others","history.clear","bookmark-add"]],
  ["tab.", ["tab.next","tab.close","tab.close_others"]],
  ["git", ["git","GitHub Issues","Gitea","GitHub Pull Requests","x1y2z3","reload_hard","history.clear"]],
  ["GIT hub", ["GitHub Issues","GitHub Pull Requests"]],
  ["close tab", ["tab.close","tab.close_others","history.clear"]],
  ["rel", ["reload","reload_hard","tracing"]],
  ["ref", ["reload"]],
  ["  tab  close ", ["tab.close","tab.close_others","history.clear"]],
  ["42", ["x1y2z3"]],
  ["bm", ["bookmark-add","Bookmarks Toolbar","GitHub Issues","GitHub Pull Requests"]],
  ["is", ["GitHub Issues","history.clear","settings.theme","window.close","GitHub Pull Requests","bookmark-add","x1y2z3"]],
  ["same", ["same","same","also same"]],
  ["zzz", []],
  ["", ["tab.close","tab.close_others","tab.next","window.close","GitHub Issues","GitHub Pull Requests","git","Gitea","tracing","Tab Groups","toggleCamelCase","history.clear","bookmark-add","Bookmarks Toolbar","open (new tab)","reload","reload_hard","settings.theme","x1y2z3","Mail  inbox","same","same","also same"]],
];

test("the order of a varied list holds for every query", () => {
  for (const [query, order] of expected_order) {
    assert.deepEqual(rank(query, varied_rows, (row) => row.group ?? 0).map((row) => row.name), order, JSON.stringify(query));
  }
});

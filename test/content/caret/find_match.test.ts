import assert from "node:assert/strict";
import { test } from "node:test";
import { collect_matches, compile_query, describe_match, nearest_match, opposite, step_match } from "../../../src/content/caret/find_match.ts";
import type { Slicing } from "../../../src/content/caret/find_match.ts";

const never_stale: Slicing = { is_stale: () => false, yield_to_page: async () => {}, now: () => 0, slice_ms: 8 };
const scan = async (text: string, query: string) => {
  const compiled = compile_query(query)!;
  return collect_matches(text, compiled.search, never_stale);
};

test("an empty query compiles to nothing", () => {
  assert.equal(compile_query(""), undefined);
});

test("smartcase: lower case matches both, a capital makes it exact, an escape like \\S does not count", async () => {
  assert.deepEqual((await scan("Foo foo FOO", "foo"))!.from, [0, 4, 8]);
  assert.deepEqual((await scan("Foo foo FOO", "Foo"))!.from, [0]);
  assert.deepEqual((await scan("a1 b2 A3", "\\S\\d"))!.from, [0, 3, 6]);
});

test("an invalid pattern is searched as text and flagged", async () => {
  const query = compile_query("f(o")!;
  assert.equal(query.fallback, "invalid");
  assert.deepEqual((await scan("xf(oy", "f(o"))!.from, [1]);
});

test("a typed space matches a space or a line break, but not inside a character class", async () => {
  assert.deepEqual((await scan("foo bar\nfoo\nbar", "foo bar"))!.from, [0, 8]);
  assert.deepEqual((await scan("a b", "[ ]b"))!.from, [1]);
});

test("empty matches are skipped and the scan still ends", async () => {
  assert.deepEqual(await scan("aab", "x*"), { from: [], to: [] });
  assert.deepEqual(await scan("aab", "a*"), { from: [0], to: [2] });
});

test("nearest_match looks forward from the start or backward before it, and wraps", () => {
  const from = [5, 10, 20];
  assert.deepEqual(nearest_match(from, 10, "forward"), { index: 1, wrapped: false });
  assert.deepEqual(nearest_match(from, 21, "forward"), { index: 0, wrapped: true });
  assert.deepEqual(nearest_match(from, 10, "backward"), { index: 0, wrapped: false });
  assert.deepEqual(nearest_match(from, 5, "backward"), { index: 2, wrapped: true });
  assert.equal(nearest_match([], 0, "forward"), undefined);
});

test("step_match wraps at both ends and N is the opposite direction", () => {
  assert.deepEqual(step_match(2, 3, "forward"), { index: 0, wrapped: true });
  assert.deepEqual(step_match(0, 3, "backward"), { index: 2, wrapped: true });
  assert.deepEqual(step_match(1, 3, "forward"), { index: 2, wrapped: false });
  assert.equal(opposite("forward"), "backward");
  assert.equal(opposite("backward"), "forward");
});

test("describe_match counts from one and says when it wrapped or fell back to text", () => {
  assert.equal(describe_match("a", 17, 2, undefined), "3 of 17");
  assert.equal(describe_match("a", 17, 0, undefined, true), "1 of 17, wrapped");
  assert.equal(describe_match("a(", 2, 0, "invalid"), "1 of 2 (not a regex, searched as text)");
  assert.equal(describe_match("zz", 0, 0, undefined), "Not found: zz");
});

test("a scan that a newer keystroke made stale stops and returns nothing", async () => {
  // Each match takes 5 ms on a fake clock, so a slice ends every two matches.
  let clock = 0;
  let newest = 1;
  let yields = 0;
  const slicing: Slicing = {
    is_stale: () => newest !== 1,
    yield_to_page: async () => {
      yields++;
      // The next keystroke arrives while the first scan is paused.
      if (yields === 2) newest = 2;
    },
    now: () => (clock += 5),
    slice_ms: 8,
  };
  const result = await collect_matches("a ".repeat(100), { kind: "regex", regex: /a/gu }, slicing);
  assert.equal(result, undefined);
  assert.equal(yields, 2);
});

test("a scan that stays current returns every match", async () => {
  let clock = 0;
  const slicing: Slicing = { ...never_stale, now: () => (clock += 5) };
  const result = await collect_matches("a ".repeat(50), { kind: "regex", regex: /a/gu }, slicing);
  assert.equal(result!.from.length, 50);
});

test("an empty match on text with emoji moves on by a whole code point, so the scan ends", async () => {
  let reads = 0;
  const slicing: Slicing = {
    ...never_stale,
    now: () => {
      if (++reads > 1000) throw new Error("the scan looped");
      return 0;
    },
  };
  const result = await collect_matches("a😀b😀", compile_query("x*")!.search, slicing);
  assert.deepEqual(result, { from: [], to: [] });
});

test("an exact-case plain query is a literal search with no regex, and a lower-case one is an escaped regex", () => {
  for (const plain of ["Foo", "Foo bar", "A-b", "X/y"]) assert.equal(compile_query(plain)!.search.kind, "literal", plain);
  for (const plain of ["foo", "foo bar", "a-b", "100%"]) {
    const { search } = compile_query(plain)!;
    assert.equal(search.kind, "regex", plain);
    assert.equal(search.kind === "regex" && /[.*+?^${}()|[\]\\]/.test(search.regex.source.replace(/\[ \\n\]/g, "").replace(/\\./g, "")), false, `${plain} keeps no regex syntax`);
  }
  for (const pattern of ["fo.", "a*", "(a)", "a|b", "[ab]", "a+", "a?", "^a", "a$", "\\d", "a{2}"]) assert.equal(compile_query(pattern)!.search.kind, "regex", pattern);
});

test("lower-case plain text folds case like the regex flags: s finds the long s and sigma finds the final sigma", async () => {
  assert.deepEqual((await scan("ſ s S", "s"))!.from, [0, 2, 4]);
  assert.deepEqual((await scan("σ ς Σ", "σ"))!.from, [0, 2, 4]);
});

test("the literal path follows the same space rule as the regex path, and a capital makes it exact", async () => {
  const text = "Foo foo FOO\nfoo bar\nFoo";
  for (const query of ["foo", "Foo", "FOO", "foo bar", "o b"]) {
    const compiled = await scan(text, query);
    const regex = await collect_matches(text, { kind: "regex", regex: new RegExp(query.replace(/ /g, "[ \\n]"), /\p{Lu}/u.test(query) ? "gu" : "giu") }, never_stale);
    assert.deepEqual(compiled, regex, query);
  }
  assert.deepEqual((await scan("a\nb", "a b"))!.from, [0]);
  assert.deepEqual((await scan("Xa\nb", "Xa b"))!.from, [0]);
});

const COSTLY = ["(a|a){1,40}$", "([)a]+)+$", "(\\)a+)+$", "(a+)+$", "(a|a)*b", "(.*)*x", "((a+))+", "(a*)*", "(x+x+)+y", "(a|b){2,}", "a*a*b", "a*a*a*a*a*a*a*b", "\\w*\\w*\\w*x", ".*.*.*=.*", "a+a+", "[ab]*[ab]{2,}c", "(a*a*)b"];
const ORDINARY = ["foo.*bar", "\\d+", "colou?r", "(foo)bar", "(ab)?c", "(ab){2}", "a+b+", "(\\d+)-(\\d+)", "\\(a+\\)", "([)]a)+", "(\\)|b)", "foo", "a.*b", "foo bar", "foo.*bar.*baz", "\\d+\\w+", "a*b*a*c", "\\*a+\\*a+"];

test("costly shapes are flagged and ordinary patterns are not", () => {
  for (const pattern of COSTLY) assert.equal(compile_query(pattern)!.fallback, "costly", pattern);
  for (const pattern of ORDINARY) assert.equal(compile_query(pattern)!.fallback, undefined, pattern);
});

test("a costly pattern is searched as its own characters", async () => {
  assert.deepEqual((await scan("x (a+)+$ y", "(a+)+$"))!.from, [2]);
  assert.deepEqual((await scan("x (A+)+$ y", "(A+)+$"))!.from, [2]);
});

test("a costly pattern never reaches exec as a pattern, only as escaped text, and returns within the budget", async () => {
  const searches = COSTLY.map((pattern) => [pattern, compile_query(pattern)!.search] as const);
  const original = RegExp.prototype.exec;
  const sources: string[] = [];
  RegExp.prototype.exec = function (this: RegExp, ...args: [string]) {
    sources.push(this.source);
    return original.apply(this, args);
  };
  let clock = 0;
  try {
    const fake_clock: Slicing = { is_stale: () => false, yield_to_page: async () => {}, now: () => clock++, slice_ms: 8 };
    const text = "a".repeat(40) + "!";
    for (const [pattern, search] of searches) {
      const before = sources.length;
      assert.deepEqual(await collect_matches(text, search, fake_clock), { from: [], to: [] }, pattern);
      for (const source of sources.slice(before)) assert.notEqual(source, pattern, `${pattern} ran as a regex`);
    }
  } finally {
    RegExp.prototype.exec = original;
  }
  assert.ok(clock < 200);
});

test("a pattern typed one key at a time is flagged only at the costly steps", () => {
  const steps = ["(", "(a", "(a+", "(a+)", "(a+)+", "(a+)+$"].map((typed) => compile_query(typed)!.fallback);
  assert.deepEqual(steps, ["invalid", "invalid", "invalid", undefined, "costly", "costly"]);
});

test("a (?-i:...) group stays exact under a lowercase query", () => {
  const search = compile_query("(?-i:foo)")!.search;
  assert.equal(search.kind === "regex" && search.regex.test("FOO"), false);
  assert.equal(search.kind === "regex" && (search.regex.lastIndex = 0, search.regex.test("foo")), true);
});

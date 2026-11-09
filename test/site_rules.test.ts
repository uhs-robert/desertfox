import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_keymap, create_matcher } from "../src/shared/keys/index.ts";
import type { KeymapConfig } from "../src/shared/index.ts";
import type { CompiledKeymap, SiteRule } from "../src/shared/prefix_tree.ts";

const resolve = () => ({ runs_in: "content" as const, label: "x", count: "ignore" as const });

const KEYMAP: KeymapConfig = {
  normal: { j: { id: "a.j" }, k: { id: "a.k" }, gg: { id: "a.gg" }, gi: { id: "a.gi" }, "<C-d>": { id: "a.d" } },
  browser: { "<A-j>": { id: "a.tab" } },
};

const compile = (site_rules: { site: string; pass?: string; only?: string }[]) => compile_keymap(KEYMAP, { site_rules }, resolve);

// What a key does on a page, the way the content script picks the rule and swaps the tree.
function feed_keys(compiled: CompiledKeymap, url: string, keys: string[]): string {
  const rule = compiled.site_rules?.find((candidate) => new RegExp(candidate.regex).test(url));
  const tree = rule !== undefined && "normal" in rule ? { ...compiled, modes: { ...compiled.modes, normal: rule.normal } } : compiled;
  const matcher = create_matcher(tree);
  return keys.map((key) => matcher.feed("normal", key).kind).at(-1)!;
}

test("pass of a leaf frees that key and keeps the rest", () => {
  const { compiled } = compile([{ site: "https://a.test/*", pass: "j" }]);
  assert.equal(feed_keys(compiled, "https://a.test/", ["j"]), "no_match");
  assert.equal(feed_keys(compiled, "https://a.test/", ["k"]), "match");
  assert.equal(feed_keys(compiled, "https://b.test/", ["j"]), "match");
});

test("pass of a prefix frees its whole subtree, and pass of one leaf under it keeps its siblings", () => {
  const prefix = compile([{ site: "https://a.test/*", pass: "g" }]).compiled;
  assert.equal(feed_keys(prefix, "https://a.test/", ["g"]), "no_match");
  const leaf = compile([{ site: "https://a.test/*", pass: "gg" }]).compiled;
  assert.notEqual(feed_keys(leaf, "https://a.test/", ["g", "g"]), "match");
  assert.equal(feed_keys(leaf, "https://a.test/", ["g", "i"]), "match");
});

test("only keeps the listed keys, a listed prefix keeps its subtree, and a chord works", () => {
  const { compiled } = compile([{ site: "https://a.test/*", only: "j gg <C-d>" }]);
  const url = "https://a.test/";
  assert.equal(feed_keys(compiled, url, ["j"]), "match");
  assert.equal(feed_keys(compiled, url, ["<C-d>"]), "match");
  assert.equal(feed_keys(compiled, url, ["k"]), "no_match");
  assert.equal(feed_keys(compiled, url, ["g", "g"]), "match");
  assert.equal(feed_keys(compiled, url, ["g", "i"]), "no_match");
  const prefix = compile([{ site: "https://a.test/*", only: "g" }]).compiled;
  assert.equal(feed_keys(prefix, url, ["g", "i"]), "match");
  assert.equal(feed_keys(prefix, url, ["j"]), "no_match");
});

test("a rule with no keys, or whose keys leave nothing, is all off", () => {
  const { compiled } = compile([{ site: "https://a.test/*" }, { site: "https://b.test/*", only: "x" }, { site: "https://c.test/*", pass: "j k gg gi <C-d>" }]);
  assert.deepEqual(compiled.site_rules?.map((rule) => "all_off" in rule), [true, true, true]);
});

test("the first matching rule wins", () => {
  const { compiled } = compile([{ site: "https://a.test/app/*", pass: "j" }, { site: "https://a.test/*" }]);
  const first = compiled.site_rules?.find((rule) => new RegExp(rule.regex).test("https://a.test/app/x")) as SiteRule;
  assert.ok("normal" in first);
  const second = compiled.site_rules?.find((rule) => new RegExp(rule.regex).test("https://a.test/other")) as SiteRule;
  assert.ok("all_off" in second);
});

test("the browser chords and the shared tree are untouched, and a rule with a bad pattern is dropped", () => {
  const { compiled } = compile([{ site: "https://a.test/*", only: "j" }, { site: "not a pattern" }]);
  assert.equal(compiled.site_rules?.length, 1);
  assert.ok(compiled.modes.browser?.children["<A-j>"]);
  assert.ok(compiled.modes.normal?.children["k"]);
});

test("no rules leaves the key out", () => {
  assert.equal("site_rules" in compile([]).compiled, false);
});

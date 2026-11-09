import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_keymap, create_matcher } from "../src/shared/keys/index.ts";
import type { KeymapConfig } from "../src/shared/index.ts";
import { prune_tree, rule_frees } from "../src/shared/keys/prune_tree.ts";
import type { CompiledKeymap } from "../src/shared/prefix_tree.ts";
import { list_keys } from "../src/background/list_keys.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";

const resolve = () => ({ runs_in: "content" as const, label: "x", count: "ignore" as const });

const KEYMAP: KeymapConfig = {
  normal: { j: { id: "a.j" }, k: { id: "a.k" }, gg: { id: "a.gg" }, gi: { id: "a.gi" }, "<C-d>": { id: "a.d" } },
  browser: { "<A-j>": { id: "a.tab" } },
};

const compile = (site_rules: { site: string; pass?: string; only?: string }[]) => compile_keymap(KEYMAP, { site_rules }, resolve);

// What a key does on a page, the way the content script picks the rule, prunes the tree and builds the matcher.
function matcher_for(compiled: CompiledKeymap, url: string) {
  const rule = compiled.site_rules?.find((candidate) => new RegExp(candidate.regex).test(url));
  if (rule === undefined || "all_off" in rule) return create_matcher(compiled);
  const tree = { ...compiled, modes: { ...compiled.modes, normal: prune_tree(compiled.modes.normal, rule) } };
  return create_matcher(tree, (token) => rule_frees(rule, token));
}

function feed_keys(compiled: CompiledKeymap, url: string, keys: string[]): string {
  const matcher = matcher_for(compiled, url);
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
  const first = compiled.site_rules?.find((rule) => new RegExp(rule.regex).test("https://a.test/app/x"));
  assert.deepEqual(first && "pass" in first && first.pass, [["j"]]);
  const second = compiled.site_rules?.find((rule) => new RegExp(rule.regex).test("https://a.test/other"));
  assert.ok(second && "all_off" in second);
});

test("the stored rule holds sequences, not a tree", () => {
  const { compiled } = compile([{ site: "https://a.test/*", only: "j gg" }]);
  assert.deepEqual(compiled.site_rules?.[0] && "only" in compiled.site_rules[0] && compiled.site_rules[0].only, [["j"], ["g", "g"]]);
});

const SLASH_KEYMAP: KeymapConfig = { normal: { "/": { id: "a.find" }, f: { id: "a.f" }, j: { id: "a.j" } } };

test("a passed or unlisted single key that the flow would cancel or count reaches the page", () => {
  const passed = compile_keymap(SLASH_KEYMAP, { site_rules: [{ site: "https://a.test/*", pass: "/ 5" }] }, resolve).compiled;
  const matcher = matcher_for(passed, "https://a.test/");
  assert.equal(matcher.feed("normal", "/").kind, "no_match");
  assert.equal(matcher.passes_("normal", "/"), true);
  assert.equal(matcher.passes_("normal", "j"), false);
  // 5 is no count digit here: the next key is not given a count of 5.
  assert.equal(matcher.feed("normal", "5").kind, "no_match");
  assert.equal(matcher.feed("normal", "f").kind, "match");
  const only = compile_keymap(SLASH_KEYMAP, { site_rules: [{ site: "https://a.test/*", only: "f" }] }, resolve).compiled;
  const only_matcher = matcher_for(only, "https://a.test/");
  for (const key of ["/", "'", "3", "j"]) assert.equal(only_matcher.passes_("normal", key), true, key);
  assert.equal(only_matcher.feed("normal", "3").kind, "no_match");
  assert.equal(only_matcher.passes_("normal", "f"), false);
  // Another page keeps the count and the Quick Find cancel.
  assert.equal(matcher_for(only, "https://b.test/").feed("normal", "3").kind, "pending");
});

test("which-key lists only the keys the page's rule leaves", async () => {
  const { compiled } = compile([{ site: "https://a.test/*", pass: "gg" }]);
  const storage = { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: compiled }) } as never;
  const rows = async (address: string) => (await list_keys(storage, () => undefined, { mode: "normal", prefix: ["g"] }, undefined, [address, undefined])).rows.map((row) => row.keys);
  assert.deepEqual(await rows("https://a.test/"), ["i"]);
  assert.deepEqual(await rows("https://b.test/"), ["g", "i"]);
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

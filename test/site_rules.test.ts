import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_keymap, create_matcher } from "../src/shared/keys/index.ts";
import type { KeymapConfig } from "../src/shared/index.ts";
import { prune_tree } from "../src/shared/keys/prune_tree.ts";
import type { CompiledKeymap } from "../src/shared/prefix_tree.ts";
import { all_off_step } from "../src/content/site_rule.ts";
import { list_keys } from "../src/background/list_keys.ts";
import { normal_tree_for, site_columns_for } from "../src/background/page_keymap.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, is_freed } from "../src/shared/prefix_tree.ts";

const resolve = () => ({ runs_in: "content" as const, label: "x", count: "ignore" as const });

const KEYMAP: KeymapConfig = {
  normal: { j: { id: "a.j" }, k: { id: "a.k" }, gg: { id: "a.gg" }, gi: { id: "a.gi" }, "<C-d>": { id: "a.d" } },
  browser: { "<A-j>": { id: "a.tab" } },
};

const compile = (site_rules: { site: string; off?: boolean; pass?: string; only?: string }[]) => compile_keymap(KEYMAP, { site_rules }, resolve);

// What a key does on a page, the way the background resolves the columns and trims the tree, and the content script builds the matcher.
function matcher_for(compiled: CompiledKeymap, url: string) {
  const page_tree = normal_tree_for(compiled.modes.normal, site_columns_for(compiled, [url]));
  if (!("frees" in page_tree)) return create_matcher(compiled);
  const { tree, frees } = page_tree;
  return create_matcher({ ...compiled, modes: { ...compiled.modes, normal: tree } }, (token) => is_freed(frees, token));
}

const all_off_at = (compiled: CompiledKeymap, url: string): boolean => normal_tree_for(compiled.modes.normal, site_columns_for(compiled, [url])).all_off;

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

test("a row with nothing but a site, off = true, or keys that leave nothing, is all off", () => {
  const { compiled } = compile([{ site: "https://a.test/*" }, { site: "https://b.test/*", only: "x" }, { site: "https://c.test/*", pass: "j k gg gi <C-d>" }, { site: "https://d.test/*", off: true, pass: "j" }]);
  for (const host of ["a", "b", "c", "d"]) assert.equal(all_off_at(compiled, `https://${host}.test/`), true, host);
  assert.deepEqual(compiled.site_rules?.map((rule) => rule.off), [true, undefined, undefined, true]);
});

test("each column takes the first matching row that sets it", () => {
  const { compiled } = compile([{ site: "https://a.test/app/*", pass: "j" }, { site: "https://a.test/*" }]);
  // The off column comes from the broad bare row, so the app page is off too.
  assert.equal(all_off_at(compiled, "https://a.test/app/x"), true);
  const kept = compile([{ site: "https://a.test/app/*", off: false }, { site: "https://a.test/*", pass: "j" }, { site: "https://a.test/*" }]).compiled;
  assert.equal(all_off_at(kept, "https://a.test/app/x"), false);
  assert.equal(feed_keys(kept, "https://a.test/app/x", ["j"]), "no_match");
  assert.equal(feed_keys(kept, "https://a.test/app/x", ["k"]), "match");
  assert.equal(all_off_at(kept, "https://a.test/other"), true);
});

test("pass and only are one column: an only row below a pass row does not apply", () => {
  const { compiled } = compile([{ site: "https://a.test/*", pass: "j" }, { site: "https://a.test/*", only: "j" }]);
  assert.equal(feed_keys(compiled, "https://a.test/", ["j"]), "no_match");
  assert.equal(feed_keys(compiled, "https://a.test/", ["k"]), "match");
});

test("off = false alone keeps the page on and sets no key rule", () => {
  const { compiled } = compile([{ site: "https://a.test/*", off: false }]);
  assert.equal(all_off_at(compiled, "https://a.test/"), false);
  assert.equal(feed_keys(compiled, "https://a.test/", ["j"]), "match");
});

test("the stored rule holds sequences, not a tree", () => {
  const { compiled } = compile([{ site: "https://a.test/*", only: "j gg" }]);
  assert.deepEqual(compiled.site_rules?.[0]?.keys, { only: [["j"], ["g", "g"]] });
});

test("a per-site column reaches the stored rule as a value, and the first row that sets it wins", () => {
  // No setting opts in yet, so the row is cast: the compiler copies every column besides site, off, pass and only.
  const rows = [{ site: "https://a.test/app/*", zoom: 2 }, { site: "https://a.test/*", zoom: 1.5, pass: "j" }] as unknown as Parameters<typeof compile>[0];
  const { compiled } = compile(rows);
  assert.deepEqual(compiled.site_rules?.map((rule) => rule.values), [{ zoom: 2 }, { zoom: 1.5 }]);
  // A row with only a value is not off.
  assert.equal(compiled.site_rules?.[0]?.off, undefined);
  assert.deepEqual(site_columns_for(compiled, ["https://a.test/app/x"]).values, { zoom: 2 });
  assert.deepEqual(site_columns_for(compiled, ["https://a.test/other"]).values, { zoom: 1.5 });
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
  const rows = async (address: string) => (await list_keys(storage, () => undefined, { mode: "normal", prefix: ["g"] }, { addresses: [address, undefined] })).rows.map((row) => row.keys);
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

test("a passed key the tree never binds still reaches the page", () => {
  const { compiled } = compile_keymap(SLASH_KEYMAP, { site_rules: [{ site: "https://a.test/*", pass: "'" }] }, resolve);
  const matcher = matcher_for(compiled, "https://a.test/");
  assert.equal(matcher.feed("normal", "'").kind, "no_match");
  assert.equal(matcher.passes_("normal", "'"), true);
});

test("only keeps the one-shot pass and the ways into and out of ignore mode", () => {
  const keymap: KeymapConfig = { normal: { f: { id: "a.f" }, j: { id: "a.j" }, "<C-v>": { id: "a.v" }, "<S-Escape>": { id: "a.i" }, "<Escape>": { id: "a.e" } } };
  const { compiled } = compile_keymap(keymap, { site_rules: [{ site: "https://a.test/*", only: "f" }] }, resolve);
  const matcher = matcher_for(compiled, "https://a.test/");
  for (const key of ["f", "<C-v>", "<S-Escape>"]) assert.equal(matcher.feed("normal", key).kind, "match", key);
  assert.equal(matcher.feed("normal", "j").kind, "no_match");
  // Normal-mode Escape goes to the page. Insert mode has its own tree, which no rule prunes.
  assert.equal(matcher.feed("normal", "<Escape>").kind, "no_match");
  assert.equal(matcher.passes_("normal", "<Escape>"), true);
  const insert = compile_keymap({ ...keymap, insert: { "<Escape>": { id: "a.e" } } }, { site_rules: [{ site: "https://a.test/*", only: "f" }] }, resolve).compiled;
  assert.equal(create_matcher(insert).feed("insert", "<Escape>").kind, "match");
});

test("an unusable keymap never changes the mode, and a later usable one still enters ignore", () => {
  assert.equal(all_off_step(true, true, false, "normal"), "enter");
  assert.equal(all_off_step(false, false, true, "ignore"), "none");
  // The page kept its ignore mode through the unusable install, and the state flag kept true with it.
  assert.equal(all_off_step(true, false, true, "ignore"), "leave");
  assert.equal(all_off_step(true, false, true, "normal"), "none");
  assert.equal(all_off_step(true, false, false, "ignore"), "none");
});

test("a subtree no listed sequence names is shared, not copied", () => {
  const root = compile_keymap(KEYMAP, {}, resolve).compiled.modes.normal!;
  const pruned = prune_tree(root, { pass: [["j"]] });
  assert.equal(pruned.children["k"], root.children["k"]);
  assert.equal(pruned.children["g"], root.children["g"]);
  assert.equal(pruned.children["j"], undefined);
});

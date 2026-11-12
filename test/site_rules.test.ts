import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_keymap, create_matcher } from "../src/shared/keys/index.ts";
import type { KeymapConfig } from "../src/shared/index.ts";
import { prune_tree } from "../src/shared/keys/prune_tree.ts";
import type { CompiledKeymap, TreeNode } from "../src/shared/prefix_tree.ts";
import { all_off_step } from "../src/content/site_rule.ts";
import { list_keys } from "../src/background/list_keys.ts";
import { normal_tree_for, site_columns_for } from "../src/background/page_keymap.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import "../src/background/command_modules.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, is_freed } from "../src/shared/prefix_tree.ts";

const resolve = () => ({ runs_in: "content" as const, label: "x", count: "ignore" as const });

const KEYMAP: KeymapConfig = {
  normal: { j: { id: "a.j" }, k: { id: "a.k" }, gg: { id: "a.gg" }, gi: { id: "a.gi" }, "<C-d>": { id: "a.d" } },
  browser: { "<A-j>": { id: "a.tab" } },
};

type BindTable = Record<string, { id: string; args?: Record<string, unknown> }>;
const compile = (site_rules: { site: string; off?: boolean; pass?: string; only?: string; bind?: BindTable }[]) => compile_keymap(KEYMAP, { site_rules }, resolve);

// What a key does on a page, the way the background resolves the columns and trims the tree, and the content script builds the matcher.
function matcher_for(compiled: CompiledKeymap, url: string) {
  const page_tree = normal_tree_for(compiled.modes.normal, site_columns_for(compiled, [url]));
  const { tree } = page_tree;
  const page_keymap = tree === undefined ? compiled : { ...compiled, modes: { ...compiled.modes, normal: tree } };
  if (!("frees" in page_tree)) return create_matcher(page_keymap);
  const { frees } = page_tree;
  return create_matcher(page_keymap, (token) => is_freed(frees, token));
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

const step_id = (compiled: CompiledKeymap, url: string, keys: string[]): string | undefined => {
  let node: TreeNode | undefined = normal_tree_for(compiled.modes.normal, site_columns_for(compiled, [url])).tree;
  for (const key of keys) node = node?.kind === "branch" ? node.children[key] : undefined;
  return node?.kind === "leaf" ? `${node.steps[0]?.invocation.id}:${JSON.stringify(node.steps[0]?.invocation.args ?? {})}` : undefined;
};

test("bind replaces the tree's key on a matching page only, and a longer bind makes a branch", () => {
  const { compiled } = compile([{ site: "https://a.test/*", bind: { j: { id: "b.j" }, "gx": { id: "b.gx", args: { n: 1 } } } }]);
  assert.equal(step_id(compiled, "https://a.test/", ["j"]), "b.j:{}");
  assert.equal(step_id(compiled, "https://a.test/", ["g", "x"]), 'b.gx:{"n":1}');
  assert.equal(step_id(compiled, "https://a.test/", ["g", "g"]), "a.gg:{}");
  assert.equal(step_id(compiled, "https://b.test/", ["j"]), "a.j:{}");
  assert.equal(compiled.site_rules?.[0]?.off, undefined);
});

test("bind merges key by key: the first row that binds a key decides it, the other keys stay", () => {
  const { compiled } = compile([
    { site: "https://a.test/*", bind: { j: { id: "user.j" } } },
    { site: "https://a.test/*", bind: { j: { id: "default.j" }, k: { id: "default.k" }, l: { id: "default.l" } } },
  ]);
  const url = "https://a.test/";
  assert.deepEqual(["j", "k", "l"].map((key) => step_id(compiled, url, [key])), ["user.j:{}", "default.k:{}", "default.l:{}"]);
});

test("a row that sets only pass leaves another row's bind standing", () => {
  const { compiled } = compile([{ site: "https://a.test/*", pass: "k" }, { site: "https://a.test/*", bind: { j: { id: "b.j" } } }]);
  assert.equal(step_id(compiled, "https://a.test/", ["j"]), "b.j:{}");
  assert.equal(step_id(compiled, "https://a.test/", ["k"]), undefined);
});

test("pass frees a bound key and only keeps it", () => {
  const bind = { j: { id: "b.j" } };
  const passed = compile([{ site: "https://a.test/*", pass: "j", bind }]).compiled;
  assert.equal(feed_keys(passed, "https://a.test/", ["j"]), "no_match");
  assert.equal(step_id(passed, "https://a.test/", ["j"]), undefined);
  const only = compile([{ site: "https://a.test/*", only: "j", bind }]).compiled;
  assert.equal(step_id(only, "https://a.test/", ["j"]), "b.j:{}");
  assert.equal(step_id(only, "https://a.test/", ["k"]), undefined);
});

test("off wins over bind", () => {
  const { compiled } = compile([{ site: "https://a.test/*", off: true, bind: { j: { id: "b.j" } } }]);
  assert.equal(all_off_at(compiled, "https://a.test/"), true);
  assert.equal(step_id(compiled, "https://a.test/", ["j"]), "a.j:{}");
});

test("bind skips a bad key sequence and an unknown command, with a warning, and keeps the rest", () => {
  const unknown_resolve = (id: string) => (id === "nope" ? undefined : resolve());
  const { compiled, warnings } = compile_keymap(KEYMAP, { site_rules: [{ site: "https://a.test/*", bind: { "<a>": { id: "b.x" }, q: { id: "nope" }, j: { id: "b.j" } } }] }, unknown_resolve);
  assert.deepEqual(Object.keys(compiled.site_rules?.[0]?.bind ?? {}), ["j"]);
  assert.equal(warnings.length, 2);
});

test("compile_config checks bind args with the registry validator", () => {
  const send = (args: Record<string, unknown>) => ({ id: "page.send_key", args });
  const config = {
    ...empty_config(),
    settings: { site_rules: [{ site: "https://a.test/*", bind: { h: send({ key: "ArrowLeft", key_code: 37, target: "#e" }), j: send({ key: "ArrowDown" }), k: { id: "no.such" } } }] },
  };
  const { compiled, warnings } = compile_config({ config, default_keymap: {}, get_command: (id) => registry.get(id), enum_sources: {} });
  assert.deepEqual(Object.keys(compiled.site_rules?.[0]?.bind ?? {}), ["h"]);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((warning) => warning.startsWith('site_rules: skipped bind "j" of "https://a.test/*": ')), warnings.join("\n"));
  assert.deepEqual(compiled.site_rules?.[0]?.bind?.h?.leaf.steps[0]?.bundle, "site_actions");
});

test("a bind under another bind of the same site warns, and only the shorter bind is grafted", () => {
  const { compiled, warnings } = compile([{ site: "https://a.test/*", bind: { g: { id: "b.g" } } }, { site: "https://a.test/*", bind: { gx: { id: "b.gx" } } }]);
  assert.deepEqual(warnings, ['site_rules: skipped bind "gx": "g" is already a complete bind for the same site']);
  assert.equal(step_id(compiled, "https://a.test/", ["g"]), "b.g:{}");
  assert.equal(step_id(compiled, "https://a.test/", ["g", "x"]), undefined);
});

test("a bind under a shorter bind of a row with another pattern warns unless the hosts differ", () => {
  const rows = (site: string) => [{ site: "https://*.a.test/*", bind: { g: { id: "b.g" } } }, { site, bind: { gx: { id: "b.gx" } } }];
  const { compiled, warnings } = compile(rows("https://www.a.test/docs/*"));
  assert.deepEqual(warnings, ['site_rules: skipped bind "gx" of "https://www.a.test/docs/*": "g" is already a complete bind of "https://*.a.test/*", which can match the same pages']);
  assert.equal(step_id(compiled, "https://www.a.test/docs/", ["g", "x"]), undefined);
  assert.equal(compile(rows("https://www.a.test/docs/*").reverse()).warnings.length, 1);
  const mode = (site: string, key: string) => ({ site, modes: { m: { label: "M", bind: { [key]: { id: "b.g" } } } } });
  assert.deepEqual(compile([mode("https://www.a.test/docs/*", "gx"), mode("https://*.a.test/*", "g")]).warnings, []);
  assert.deepEqual(compile(rows("https://b.test/*")).warnings, []);
  assert.deepEqual(compile(rows("https://a.test.evil/*")).warnings, []);
  assert.equal(compile([{ site: "<all_urls>", bind: { g: { id: "b.g" } } }, { site: "https://b.test/*", bind: { gx: { id: "b.gx" } } }]).warnings.length, 1);
});

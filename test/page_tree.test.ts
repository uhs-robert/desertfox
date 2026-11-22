import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { check_args } from "../src/shared/registry/index.ts";
import { compile_keymap } from "../src/shared/keys/index.ts";
import type { KeymapConfig } from "../src/shared/keymap.ts";
import type { TreeLeaf } from "../src/shared/prefix_tree.ts";
import { DEFAULT_KEYMAP } from "../src/shared/keys/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";

const command = registry.get("page.tree")!;
const base = { selector: "tr.comtr", depth: "indent" };

test("page.tree is the tree bundle's command, named tree, for item mode", () => {
  assert.equal(command.bundle, "tree");
  assert.equal(command.name, "tree");
  assert.deepEqual(command.modes, ["item"]);
  assert.equal(registry.list().filter((entry) => entry.name === "tree").length, 1);
});

test("the action is required and must be one of the seven", () => {
  assert.equal(check_args(command, base).ok, false);
  assert.equal(check_args(command, { ...base, action: "sideways" }).ok, false);
  for (const action of ["parent", "child", "next", "prev", "fold", "unfold", "toggle"]) assert.equal(check_args(command, { ...base, action }).ok, true, action);
});

test("extent is an optional selector on page.tree and page.item", () => {
  assert.equal(check_args(command, { ...base, action: "next", extent: ":scope > div" }).ok, true);
  assert.equal(check_args(command, { ...base, action: "next", extent: 3 }).ok, false);
  const item = registry.get("page.item")!;
  assert.equal(check_args(item, { selector: "li", direction: "down", extent: ":scope > p" }).ok, true);
  assert.equal(check_args(item, { selector: "li", direction: "down", extent: 3 }).ok, false);
  assert.equal(check_args(item, { selector: "li", direction: "down" }).ok, true);
});

test("times goes with the moves only", () => {
  for (const action of ["parent", "child", "next", "prev"]) assert.equal(check_args(command, { ...base, action, times: 3 }).ok, true, action);
  for (const action of ["fold", "unfold", "toggle"]) assert.equal(check_args(command, { ...base, action, times: 3 }).ok, false, action);
  assert.equal(check_args(command, { ...base, action: "next", times: 0 }).ok, false);
});

test("the depth is read from the item, from inside it or from an ancestor, and the last two name where", () => {
  assert.equal(check_args(command, { ...base, action: "next" }).ok, true);
  assert.equal(check_args(command, { ...base, action: "next", depth_from: "inside" }).ok, false);
  assert.equal(check_args(command, { ...base, action: "next", depth_from: "inside", depth_at: "td.ind" }).ok, true);
  assert.equal(check_args(command, { selector: "summary", depth: "depth", action: "next", depth_from: "above", depth_at: "shreddit-comment" }).ok, true);
  assert.equal(check_args(command, { ...base, action: "next", depth_at: "td.ind" }).ok, false);
  assert.equal(check_args(command, { ...base, action: "next", depth_from: "beside", depth_at: "td" }).ok, false);
  assert.equal(check_args(command, { selector: "tr", action: "next" }).ok, false);
});

test("the Hacker News row binds the tree keys to comments only, and keeps the item keys", () => {
  const rows = DEFAULT_SITE_ROWS.filter((entry) => entry.name === "hackernews");
  assert.ok(rows.length > 0);
  const expected = { h: "parent", l: "child", "}": "next", "{": "prev", za: "toggle", zc: "fold", zo: "unfold" };
  for (const { row } of rows) {
    const table = row.keymap!.item! as Record<string, { id: string; args: Record<string, unknown>; when_present?: string }>;
    for (const [key, action] of Object.entries(expected)) {
      assert.equal(table[key]?.id, "page.tree", key);
      assert.equal(table[key]?.args["action"], action, key);
      assert.equal(table[key]?.when_present, "tr.comtr", `${key} must leave h and l to the scroll where no comment shows`);
      assert.equal(check_args(command, table[key]!.args).ok, true, key);
    }
    assert.equal(table["j"]?.id, "page.item");
    assert.equal(table["gg"]?.id, "page.item");
  }
});

test("the Reddit thread rows come before the feed rows, bind the tree keys to comment heads and keep item mode off", () => {
  const entries = DEFAULT_SITE_ROWS.filter((entry) => entry.name.startsWith("reddit"));
  const thread = DEFAULT_SITE_ROWS.filter((entry) => entry.name === "reddit_thread");
  assert.deepEqual(thread.map(({ row }) => row.site), ["https://www.reddit.com/r/*/comments/*", "https://reddit.com/r/*/comments/*"]);
  assert.ok(entries.indexOf(thread.at(-1)!) < entries.findIndex(({ row }) => !row.site.includes("/comments/")), "the feed rows would otherwise decide the thread page");
  const expected = { h: "parent", l: "child", "}": "next", "{": "prev", za: "toggle", zc: "fold", zo: "unfold" };
  for (const { row } of thread) {
    assert.equal(row.item_navigator, false);
    const table = row.keymap!.item! as Record<string, { id: string; args: Record<string, unknown>; when_present?: string }>;
    for (const [key, action] of Object.entries(expected)) {
      assert.equal(table[key]?.id, "page.tree", key);
      assert.equal(table[key]?.args["action"], action, key);
      assert.equal(table[key]?.args["depth_from"], "above", key);
      assert.equal(table[key]?.when_present, "shreddit-comment > details > summary", key);
      assert.equal(check_args(command, table[key]!.args).ok, true, key);
      assert.equal(table[key]?.args["extent"], ":scope > div > div > [slot=comment]", key);
    }
    for (const key of ["j", "k", "gg", "G"]) {
      assert.equal(table[key]?.id, "page.item", key);
      assert.equal(table[key]?.args["extent"], ":scope > div > div > [slot=comment]", key);
      assert.equal(check_args(registry.get("page.item")!, table[key]!.args).ok, true, key);
    }
  }
  const feed = entries.find(({ row }) => row.site === "https://www.reddit.com/*")!.row.keymap!.item!;
  assert.equal(feed["h"], undefined, "the feed rows keep h and l as they are");
});

test("the aria preset needs no selector or depth, and fold_by keys goes with the selector form", () => {
  assert.equal(check_args(command, { action: "parent", preset: "aria" }).ok, true);
  for (const action of ["parent", "child", "next", "prev", "fold", "unfold", "toggle"]) assert.equal(check_args(command, { action, preset: "aria" }).ok, true, action);
  assert.equal(check_args(command, { action: "parent", preset: "aria", selector: "li" }).ok, false, "the preset reads its own selector");
  assert.equal(check_args(command, { action: "parent", preset: "grove" }).ok, false);
  assert.equal(check_args(command, { action: "parent" }).ok, false, "with no preset the selector is required");
  assert.equal(check_args(command, { ...base, action: "fold", fold_by: "keys" }).ok, true);
  assert.equal(check_args(command, { ...base, action: "fold", fold_by: "click", fold: "a.togg" }).ok, true);
  assert.equal(check_args(command, { ...base, action: "fold", fold_by: "keys", fold: "a.togg" }).ok, false, "keys click nothing");
  assert.equal(check_args(command, { ...base, action: "fold", fold_by: "drag" }).ok, false);
  assert.equal(check_args(command, { action: "fold", preset: "aria", fold_by: "keys" }).ok, false);
});

test("the default item keys guard the tree keys on the focus in a tree and fall back to the item moves", () => {
  const table = DEFAULT_KEYMAP.item! as Record<string, { id: string; args: Record<string, unknown>; when_present?: string; when_focus?: string; fallback?: { id: string; args: Record<string, unknown> } }>;
  const expected = { h: "parent", l: "child", "}": "next", "{": "prev", za: "toggle", zc: "fold", zo: "unfold" };
  for (const [key, action] of Object.entries(expected)) {
    assert.equal(table[key]?.id, "page.tree", key);
    assert.deepEqual(table[key]?.args, { action, preset: "aria" }, key);
    assert.equal(table[key]?.when_present, "[role=tree]:focus-within", key);
    assert.equal(table[key]?.when_focus, undefined, key);
    assert.equal(check_args(command, table[key]!.args).ok, true, key);
  }
  for (const key of ["h", "l", "}", "{"]) assert.equal(table[key]?.fallback?.id, "page.item", `${key} keeps its item move`);
});

// The compiler takes a guard and a fallback from the default layer alone.
const resolve_known = (id: string) => (id.startsWith("a.") ? { runs_in: "content" as const, label: id, count: "ignore" as const } : undefined);
const guarded: KeymapConfig = { item: { h: { id: "a.tree", when_present: "[role=tree]", fallback: { id: "a.left" } } } };

test("a default key keeps its guard, and its fallback is the next leaf of the chain", () => {
  const { compiled, warnings } = compile_keymap(guarded, {}, resolve_known, undefined, guarded);
  const leaf = compiled.modes.item!.children["h"] as TreeLeaf;
  assert.deepEqual(warnings, []);
  assert.equal(leaf.when_present, "[role=tree]");
  assert.deepEqual([leaf.steps[0]?.invocation.id, leaf.otherwise?.steps[0]?.invocation.id, leaf.otherwise?.otherwise], ["a.tree", "a.left", undefined]);
});

test("a guarded key of the user's keymap is skipped, and a default fallback the registry does not know leaves no otherwise", () => {
  const user = compile_keymap(guarded, {}, resolve_known);
  assert.equal(user.compiled.modes.item?.children["h"], undefined);
  assert.ok(user.warnings.some((warning) => warning.includes("when_present works only in a site row bind")));
  const unknown: KeymapConfig = { item: { h: { id: "a.tree", when_present: "[role=tree]", fallback: { id: "b.missing" } } } };
  const leaf = compile_keymap(unknown, {}, resolve_known, undefined, unknown).compiled.modes.item?.children["h"] as TreeLeaf | undefined;
  assert.equal(leaf?.otherwise, undefined);
});

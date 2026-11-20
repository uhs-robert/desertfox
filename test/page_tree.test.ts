import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { check_args } from "../src/shared/registry/index.ts";
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
    }
    assert.equal(table["j"]?.id, "page.item");
  }
  const feed = entries.find(({ row }) => row.site === "https://www.reddit.com/*")!.row.keymap!.item!;
  assert.equal(feed["h"], undefined, "the feed rows keep h and l as they are");
});

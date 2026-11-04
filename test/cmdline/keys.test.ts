import assert from "node:assert/strict";
import { test } from "node:test";
import { key_labels } from "../../src/cmdline/completion/keys.ts";
import type { CompiledKeymap, TreeBranch, TreeNode } from "../../src/shared/prefix_tree.ts";
import { COMMANDS } from "./completion/fixtures.ts";

const leaf = (id: string, args?: Record<string, unknown>, prompt?: { param: string }): TreeNode => ({
  kind: "leaf",
  steps: [{ invocation: { id, ...(args ? { args } : {}), ...(prompt ? { prompt } : {}) } as never, runs_in: "background", count_rule: "ignore" as never }],
});
const branch = (children: Record<string, TreeNode>): TreeBranch => ({ kind: "branch", children });
const keymap = (modes: CompiledKeymap["modes"]) => ({ modes }) as CompiledKeymap;

const normal = branch({
  d: leaf("tab.close"),
  H: branch({ d: leaf("tab.close", { left: true }) }),
  L: leaf("tab.close", { right: true }),
  "<C-n>": leaf("tab.next"),
  gg: leaf("window.new"),
  s: branch({ g: leaf("open.search", { engine: "duck" }) }),
  t: leaf("tab.switch", undefined, { param: "title" }),
});

test("a command lists the keys that run it bare, flags included, and shows two then +N", () => {
  const labels = key_labels(keymap({ normal }), COMMANDS, "normal");
  assert.equal(labels.get("tab.close"), "L d +1");
  assert.equal(labels.get("tab.next"), "<C-n>");
  assert.equal(labels.get("window.new"), "gg");
});

test("a binding with a value or a prompt stays off the command row", () => {
  const labels = key_labels(keymap({ normal }), COMMANDS, "normal");
  assert.equal(labels.has("open.search"), false);
  assert.equal(labels.has("tab.switch"), false);
});

test("a user tree that rebinds a command shows the new keys", () => {
  const user = branch({ x: leaf("tab.close") });
  assert.equal(key_labels(keymap({ normal: user }), COMMANDS, "normal").get("tab.close"), "x");
});

test("browser keys show in a normal line and keys of another mode do not", () => {
  const labels = key_labels(keymap({ normal, browser: branch({ "<A-w>": leaf("tab.close") }), insert: branch({ q: leaf("tab.next") }) }), COMMANDS, "normal");
  assert.equal(labels.get("tab.close"), "L d +2");
  assert.equal(labels.get("tab.next"), "<C-n>");
});

test("a line opened from another mode reads that mode's tree", () => {
  const labels = key_labels(keymap({ normal, insert: branch({ q: leaf("tab.next") }) }), COMMANDS, "insert");
  assert.deepEqual([...labels], [["tab.next", "q"]]);
});

test("no keymap gives no keys", () => {
  assert.equal(key_labels(undefined, COMMANDS, "normal").size, 0);
});

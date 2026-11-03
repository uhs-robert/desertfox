import assert from "node:assert/strict";
import { test } from "node:test";
import { list_keys, rows_after_prefix } from "../../src/background/list_keys.ts";
import { choose_layout } from "../../src/content/whichkey/layout.ts";
import type { CommandMeta } from "../../src/shared/command.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeBranch, TreeNode } from "../../src/shared/prefix_tree.ts";

const leaf = (id: string, label?: string): TreeNode => ({ kind: "leaf", ...(label ? { label } : {}), steps: [{ invocation: { id }, runs_in: "content", count_rule: "ignore" }] });
const branch = (children: Record<string, TreeNode>): TreeBranch => ({ kind: "branch", children });

const root = branch({
  j: leaf("scroll.down", "Scroll Down"),
  g: branch({ t: leaf("tab.next", "Next Tab"), T: leaf("tab.prev"), x: branch({ x: leaf("tab.close"), "0": leaf("tab.close_side") }) }),
});

const commands: Record<string, CommandMeta> = {
  "tab.next": { id: "tab.next", name: "tabnext", label: "Next Tab", intent: "Switch to the next tab." },
  "tab.prev": { id: "tab.prev", name: "tabprev", label: "Previous Tab", intent: "Switch to the previous tab." },
};
const find_command = (id: string) => commands[id];

test("rows after a prefix list its children with label, intent and a count for longer sequences", () => {
  assert.deepEqual(rows_after_prefix(root, ["g"], find_command), [
    { keys: "t", command: "Next Tab", description: "Switch to the next tab.", more: false },
    { keys: "T", command: "Previous Tab", description: "Switch to the previous tab.", more: false },
    { keys: "x", command: "2 keys", description: "", more: true },
  ]);
});

test("a deeper prefix lists only its own children", () => {
  assert.deepEqual(rows_after_prefix(root, ["g", "x"], find_command).map((row) => row.keys), ["0", "x"]);
});

test("a prefix that leads nowhere, or ends at a key, has no rows", () => {
  assert.deepEqual(rows_after_prefix(root, ["q"], find_command), []);
  assert.deepEqual(rows_after_prefix(root, ["j"], find_command), []);
  assert.deepEqual(rows_after_prefix(undefined, ["g"], find_command), []);
});

test("list_keys reads the compiled keymap of the asked mode from storage", async () => {
  const keymap: CompiledKeymap = { format_version: COMPILED_KEYMAP_VERSION, modes: { normal: root }, ignore_sites: [], mode_indicator: "always", which_key_delay_ms: 300 };
  const storage = { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) } as never;
  assert.equal((await list_keys(storage, find_command, { mode: "normal", prefix: ["g"] })).length, 3);
  assert.deepEqual(await list_keys(storage, find_command, { mode: "caret", prefix: ["g"] }), []);
});

test("the layout is a column while the rows fit the viewport and a grid past that", () => {
  assert.equal(choose_layout(5, 800), "column");
  assert.equal(choose_layout(20, 1400), "column");
  assert.equal(choose_layout(21, 1400), "grid");
  assert.equal(choose_layout(14, 400), "grid");
  assert.equal(choose_layout(1, 100), "grid");
});

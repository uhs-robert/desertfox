import assert from "node:assert/strict";
import { test } from "node:test";
import { list_keys, panel_after_prefix } from "../../src/background/list_keys.ts";
import { choose_columns } from "../../src/content/whichkey/layout.ts";
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
  assert.deepEqual(panel_after_prefix(root, ["g"], find_command).rows, [
    { keys: "t", command: "Next Tab", description: "Switch to the next tab.", more: false },
    { keys: "T", command: "Previous Tab", description: "Switch to the previous tab.", more: false },
    { keys: "x", command: "+x", description: "", more: true },
  ]);
});

test("a deeper prefix lists only its own children", () => {
  assert.deepEqual(panel_after_prefix(root, ["g", "x"], find_command).rows.map((row) => row.keys), ["x", "0"]);
});

test("a prefix that leads nowhere, or ends at a key, has no rows", () => {
  for (const [tree, prefix] of [[root, ["q"]], [root, ["j"]], [undefined, ["g"]]] as const) assert.deepEqual(panel_after_prefix(tree, [...prefix], find_command).rows, []);
});

test("list_keys reads the compiled keymap of the asked mode from storage", async () => {
  const keymap: CompiledKeymap = { format_version: COMPILED_KEYMAP_VERSION, modes: { normal: root }, ignore_sites: [], mode_indicator: "always", which_key_delay_ms: 300 };
  const storage = { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) } as never;
  assert.equal((await list_keys(storage, find_command, { mode: "normal", prefix: ["g"] })).rows.length, 3);
  assert.deepEqual((await list_keys(storage, find_command, { mode: "caret", prefix: ["g"] })).rows, []);
});

test("rows follow the display order: letters, other plain keys, modifier keys, groups, Escape", () => {
  const mixed = branch({
    "<Escape>": leaf("mode.escape"),
    "<A-j>": leaf("tab.next"),
    "2": leaf("tab.next"),
    T: leaf("tab.next"),
    t: leaf("tab.next"),
    b: leaf("tab.next"),
    "?": leaf("tab.next"),
    "<Tab>": leaf("tab.next"),
    z: branch({ a: leaf("tab.next") }),
    "<S-Tab>": leaf("tab.next"),
  });
  const order = panel_after_prefix(branch({ q: mixed }), ["q"], find_command).rows.map((row) => row.keys);
  assert.deepEqual(order, ["b", "t", "T", "2", "<Tab>", "?", "<A-j>", "<S-Tab>", "z", "<Escape>"]);
});

test("rows past what one column holds add columns, up to the cap", () => {
  assert.equal(choose_columns(5, 800), 1);
  assert.equal(choose_columns(20, 1400), 1);
  assert.equal(choose_columns(21, 1400), 2);
  assert.equal(choose_columns(14, 400), 2);
  assert.equal(choose_columns(1, 100), 1);
  assert.equal(choose_columns(500, 800), 4);
});

test("the title names the chain of groups, each part by its name or else its key", () => {
  const named = branch({ g: { ...branch({ t: leaf("tab.next"), x: { ...branch({ x: leaf("tab.close") }), label: "Close tabs" } }), label: "Go" } });
  assert.equal(panel_after_prefix(named, ["g"], find_command).title, "+Go");
  assert.equal(panel_after_prefix(named, ["g", "x"], find_command).title, "+Go >> +Close tabs");
  // `root` names neither level, so each part falls back to its key.
  assert.equal(panel_after_prefix(root, ["g", "x"], find_command).title, "+g >> +x");
  const unnamed_middle = branch({ g: { ...branch({ x: branch({ y: { ...branch({ z: leaf("tab.next") }), label: "Deep" } }) }), label: "Go" } });
  assert.equal(panel_after_prefix(unnamed_middle, ["g", "x", "y"], find_command).title, "+Go >> +x >> +Deep");
  assert.equal(panel_after_prefix(root, [], find_command).title, "keys");
});

test("the panel carries the border style, square when the keymap has none", async () => {
  const stored = (which_key_border?: "round") => ({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: { format_version: COMPILED_KEYMAP_VERSION, modes: { normal: root }, ignore_sites: [], mode_indicator: "always", which_key_delay_ms: 300, ...(which_key_border ? { which_key_border } : {}) } }) }) as never;
  assert.equal((await list_keys(stored(), find_command, { mode: "normal", prefix: ["g"] })).border, "square");
  assert.equal((await list_keys(stored("round"), find_command, { mode: "normal", prefix: ["g"] })).border, "round");
});

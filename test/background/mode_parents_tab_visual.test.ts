// Tab range mode: `gv` starts it, its own keys move and act, and any other normal key ends the range and then runs.

import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import { with_resolved_modes } from "../../src/shared/keys/mode_parents.ts";
import type { TreeBranch, TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const { compiled, warnings } = compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });

const leaves_of = (node: TreeBranch | undefined, path = ""): Map<string, TreeLeaf> =>
  new Map(Object.entries(node?.children ?? {}).flatMap(([token, child]) => (child.kind === "leaf" ? [[path + token, child] as const] : [...leaves_of(child, path + token)])));

const resolved = with_resolved_modes(compiled).modes;
const own = leaves_of(compiled.modes.tab_visual);
const ids_of = (leaf: TreeLeaf | undefined) => leaf?.steps.map((step) => step.invocation.id);

test("the default keymap compiles with no warnings, with gg a motion and no key both leaf and prefix", () => {
  assert.deepEqual(warnings, []);
  assert.deepEqual(ids_of(own.get("gg")), ["tab.visual"]);
});

test("gv starts the range in the background and then enters the mode in the page", () => {
  assert.deepEqual(ids_of(leaves_of(compiled.modes.normal).get("gv")), ["tab.visual", "tab.visual_enter"]);
});

test("each motion and action key is bound, and an action ends the range except close", () => {
  for (const key of ["j", "k", "gg", "G"]) assert.deepEqual(ids_of(own.get(key)), ["tab.visual"], key);
  for (const key of ["p", "m", "r", "w", "b"]) assert.deepEqual(ids_of(own.get(key)), ["tab.act", "mode.set"], key);
  for (const key of ["ga", "yy", "yu", "yo", "yt"]) assert.deepEqual(ids_of(own.get(key)), ["tab.act", "mode.set"], key);
  for (const key of ["d", "D"]) assert.deepEqual(ids_of(own.get(key)), ["tab.act"], key);
  assert.equal(own.get("o"), undefined);
  const args_of = (key: string) => own.get(key)?.steps[0]?.invocation.args;
  assert.deepEqual(args_of("D"), { action: "close", force: true });
  assert.deepEqual([args_of("yy"), args_of("yu"), args_of("yo"), args_of("yt")].map((args) => (args as { format?: string }).format), ["markdown", "plain", "org", "title"]);
  assert.deepEqual(ids_of(own.get("<Escape>")), ["mode.escape"]);
});

test("any other normal key ends the range first and then runs, as in visual item mode", () => {
  const taken = leaves_of(resolved.tab_visual);
  for (const key of ["J", "gt", "<C-d>", ":", "f"]) assert.deepEqual(ids_of(taken.get(key))?.slice(0, 1), ["mode.set"], key);
  assert.deepEqual(ids_of(taken.get("J")), ["mode.set", "tab.next"]);
  assert.equal(compiled.mode_parents?.tab_visual?.leave?.invocation.id, "mode.set");
});

test("the mode label is TAB VISUAL with no count", async () => {
  const { mode_label } = await import("../../src/shared/ui/mode_label.ts");
  assert.equal(mode_label("tab_visual", false, "always", undefined), "TAB VISUAL");
});

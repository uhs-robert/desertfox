// The default keys that move a site's own dropdown: Ctrl+J and Ctrl+K in a field, and j and k on a focused list item.

import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../src/shared/keys/default_keymap.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import type { TreeLeaf } from "../src/shared/prefix_tree.ts";

const compiled = compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: {} });
const leaf_of = (mode: "normal" | "insert", key: string) => compiled.compiled.modes[mode]!.children[key] as TreeLeaf;
const sent = (leaf: TreeLeaf) => [leaf.steps[0]!.invocation.id, leaf.steps[0]!.invocation.args?.key, leaf.steps[0]!.invocation.args?.key_code];

test("the default keymap compiles without a warning about the list keys", () => {
  assert.deepEqual(compiled.warnings.filter((warning) => /"(j|k|<C-j>|<C-k>)"/.test(warning)), []);
});

test("insert mode: Ctrl+J sends ArrowDown and Ctrl+K sends ArrowUp to the page, labelled in plain words", () => {
  assert.deepEqual(sent(leaf_of("insert", "<C-j>")), ["page.send_key", "ArrowDown", 40]);
  assert.deepEqual(sent(leaf_of("insert", "<C-k>")), ["page.send_key", "ArrowUp", 38]);
  assert.equal(leaf_of("insert", "<C-j>").label, "Next suggestion");
  assert.equal(leaf_of("insert", "<C-k>").label, "Previous suggestion");
});

test("normal mode: j and k send an arrow when a list item has the focus, and fall back to the scroll", () => {
  for (const [key, arrow, count] of [["j", "ArrowDown", 10], ["k", "ArrowUp", -10]] as const) {
    const leaf = leaf_of("normal", key);
    assert.equal(sent(leaf)[1], arrow);
    assert.match(leaf.when_present ?? "", /role=option.*role=menuitem.*role=listbox.*role=menu/);
    assert.deepEqual([leaf.otherwise?.steps[0]?.invocation.id, leaf.otherwise?.steps[0]?.invocation.args], ["scroll.lines", { count }]);
  }
});

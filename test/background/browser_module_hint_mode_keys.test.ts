import assert from "node:assert/strict";
import { test } from "node:test";
import { create_browser_module, hint_mode_keys_of_keymap } from "../../src/background/browser_module.ts";
import { BROWSER_MODULE_STATE_STORAGE_KEY, MAX_HINT_MODE_KEYS, validate_module_state } from "../../src/shared/browser_module_protocol.ts";
import { COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeLeaf, TreeNode } from "../../src/shared/prefix_tree.ts";

const leaf = (id: string, more: Partial<TreeLeaf> = {}): TreeLeaf => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "background", count_rule: "repeat" }], ...more });
const branch = (children: Record<string, TreeNode>): TreeNode => ({ kind: "branch", children });
const keymap = (hint: Record<string, TreeNode>): CompiledKeymap =>
  ({ format_version: COMPILED_KEYMAP_VERSION, modes: { normal: branch({}), hint: branch(hint) }, mode_indicator: "always", which_key_delay_ms: 0, toast_ms: 1, toast_error_ms: 1 }) as unknown as CompiledKeymap;

test("the single keys of hint mode bound to mode.escape or help.whichkey go to the state, and keys the picker takes or Escape itself get no row", () => {
  const rows = hint_mode_keys_of_keymap(
    keymap({
      "<C-c>": leaf("mode.escape"),
      "<C-[>": leaf("mode.escape"),
      "<A-?>": leaf("help.whichkey"),
      "<F1>": leaf("help.whichkey"),
      "<Escape>": leaf("mode.escape"),
      q: leaf("mode.escape"),
      "<Tab>": leaf("mode.escape"),
      "<Enter>": leaf("help.whichkey"),
      "<F2>": leaf("hint.key"),
      "<F3>": leaf("mode.escape", { when_focus: "input" }),
      g: branch({ q: leaf("mode.escape") }),
    }),
  );
  assert.deepEqual(rows, [
    { key: "<A-?>", op: "whichkey" },
    { key: "<C-[>", op: "escape" },
    { key: "<C-c>", op: "escape" },
    { key: "<F1>", op: "whichkey" },
  ]);
  assert.deepEqual(hint_mode_keys_of_keymap(undefined), []);
  const many = Object.fromEntries(Array.from({ length: MAX_HINT_MODE_KEYS + 4 }, (_, index) => [`<F${index + 1}>`, leaf("mode.escape")]));
  const kept = hint_mode_keys_of_keymap(keymap(many));
  assert.equal(kept.length, MAX_HINT_MODE_KEYS);
  assert.ok(validate_module_state({ v: 1, enabled: true, keys: [], tabs: {}, hint_mode_keys: kept }).ok);
});

test("the state always carries the table, so the module knows the extension runs hint mode keys, and a bad table is left out of a valid state", async () => {
  const bucket: Record<string, unknown> = {};
  const module = create_browser_module({
    session: { get: async (key) => ({ [key as string]: bucket[key as string] }), set: async (items) => void Object.assign(bucket, items), remove: async () => undefined },
    is_on: async () => true,
    read_disabled: async () => true,
    read_keymap: async () => keymap({ "<C-c>": leaf("mode.escape") }),
    read_tab_records: async () => ({}),
    check_args: (_id, args) => args ?? {},
    handlers: {},
    now: () => 0,
    later: () => undefined,
  });
  await module.sync();
  assert.deepEqual((bucket[BROWSER_MODULE_STATE_STORAGE_KEY] as { hint_mode_keys?: unknown }).hint_mode_keys, [], "the switch off left the table out");
  for (const bad of [[{ key: "<C-c>", op: "run" }], [{ key: "a b", op: "escape" }], [{ key: "<C-c>", op: "escape" }, { key: "<C-c>", op: "whichkey" }], "x"]) {
    const checked = validate_module_state({ v: 1, enabled: true, keys: [], tabs: {}, hint_mode_keys: bad });
    assert.ok(checked.ok && checked.value.hint_mode_keys === undefined, JSON.stringify(bad));
  }
});

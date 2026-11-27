import assert from "node:assert/strict";
import { test } from "node:test";
import { create_browser_module, sidebar_rows_of } from "../../src/background/browser_module.ts";
import type { CheckCommandArgs } from "../../src/background/browser_module.ts";
import { BROWSER_MODULE_STATE_STORAGE_KEY, MAX_KEY_ROWS } from "../../src/shared/browser_module_protocol.ts";
import { COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeLeaf, TreeNode } from "../../src/shared/prefix_tree.ts";

// The sidebar commands join the registry with the sidebar mode, so these tests pass a check that accepts any args.
const any_args: CheckCommandArgs = (_id, args) => args ?? {};
const leaf = (id: string, more: Partial<TreeLeaf> = {}): TreeLeaf => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "background", count_rule: "repeat" }], ...more });
const branch = (children: Record<string, TreeNode>): TreeNode => ({ kind: "branch", children });
const keymap = (sidebar: Record<string, TreeNode>): CompiledKeymap =>
  ({ format_version: COMPILED_KEYMAP_VERSION, modes: { normal: branch({ J: leaf("tab.next") }), sidebar: branch(sidebar) }, mode_indicator: "always", which_key_delay_ms: 0, toast_ms: 1, toast_error_ms: 1 }) as unknown as CompiledKeymap;

test("sidebar rows take one- and two-key leaves of the sidebar commands from the sidebar mode, in key order", () => {
  const rows = sidebar_rows_of(keymap({ k: leaf("sidebar.up"), j: leaf("sidebar.down"), g: branch({ g: leaf("sidebar.first") }), "<Escape>": leaf("sidebar.leave"), G: leaf("sidebar.last") }), any_args);
  assert.deepEqual(rows, [
    { keys: ["<Escape>"], id: "sidebar.leave" },
    { keys: ["G"], id: "sidebar.last" },
    { keys: ["g", "g"], id: "sidebar.first" },
    { keys: ["j"], id: "sidebar.down" },
    { keys: ["k"], id: "sidebar.up" },
  ]);
});

test("sidebar rows skip other commands, guarded and multi-step leaves, three-key sequences, refused args and an absent mode", () => {
  const two = leaf("sidebar.down");
  two.steps.push(two.steps[0]!);
  const rows = sidebar_rows_of(
    keymap({ x: leaf("tab.close"), a: leaf("sidebar.down", { when_focus: "input" }), b: two, z: branch({ z: branch({ z: leaf("sidebar.first") }) }), d: leaf("sidebar.close_item") }),
    any_args,
  );
  assert.deepEqual(rows, [{ keys: ["d"], id: "sidebar.close_item" }]);
  assert.deepEqual(sidebar_rows_of(keymap({ j: leaf("sidebar.down") }), () => undefined), []);
  assert.deepEqual(sidebar_rows_of(undefined, any_args), []);
  const many = Object.fromEntries(Array.from({ length: MAX_KEY_ROWS + 5 }, (_, index) => [`<F${index + 1}>`, leaf("sidebar.down")]));
  assert.equal(sidebar_rows_of(keymap(many), any_args).length, MAX_KEY_ROWS);
});

test("the state carries the sidebar table, and none while the switch is off", async () => {
  for (const disabled of [false, true]) {
    const bucket: Record<string, unknown> = {};
    const module = create_browser_module({
      session: { get: async (key) => ({ [key as string]: bucket[key as string] }), set: async (items) => void Object.assign(bucket, items), remove: async () => undefined },
      is_on: async () => true,
      read_disabled: async () => disabled,
      read_keymap: async () => keymap({ j: leaf("sidebar.down") }),
      read_tab_records: async () => ({}),
      check_args: any_args,
      handlers: {},
      now: () => 0,
      later: () => undefined,
    });
    await module.sync();
    const written = bucket[BROWSER_MODULE_STATE_STORAGE_KEY] as { sidebar_keys?: unknown };
    assert.deepEqual(written.sidebar_keys, disabled ? undefined : [{ keys: ["j"], id: "sidebar.down" }]);
  }
});

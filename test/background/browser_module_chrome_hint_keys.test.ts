import assert from "node:assert/strict";
import { test } from "node:test";
import { chrome_hint_keys_of_keymap, create_browser_module } from "../../src/background/browser_module.ts";
import { BROWSER_MODULE_STATE_STORAGE_KEY, MAX_CHROME_HINT_BINDINGS, validate_module_state } from "../../src/shared/browser_module_protocol.ts";
import { COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeLeaf, TreeNode } from "../../src/shared/prefix_tree.ts";

const leaf = (id: string, more: Partial<TreeLeaf> = {}): TreeLeaf => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "background", count_rule: "repeat" }], ...more });
const branch = (children: Record<string, TreeNode>): TreeNode => ({ kind: "branch", children });
const keymap = (normal: Record<string, TreeNode>): CompiledKeymap =>
  ({ format_version: COMPILED_KEYMAP_VERSION, modes: { normal: branch(normal) }, mode_indicator: "always", which_key_delay_ms: 0, toast_ms: 1, toast_error_ms: 1 }) as unknown as CompiledKeymap;

test("the hint.browser bindings of normal mode go to the state as key token lists, in key order", () => {
  assert.deepEqual(chrome_hint_keys_of_keymap(keymap({ g: branch({ B: leaf("hint.browser"), g: leaf("scroll.to") }), "<C-b>": leaf("hint.browser"), f: leaf("hint.follow") })), [["<C-b>"], ["g", "B"]]);
});

test("a guarded or multi-step hint.browser leaf, one past four keys and a keymap with none give no binding", () => {
  const two = leaf("hint.browser");
  two.steps.push(two.steps[0]!);
  const deep = branch({ a: branch({ b: branch({ c: branch({ d: leaf("hint.browser") }) }) }) });
  assert.deepEqual(chrome_hint_keys_of_keymap(keymap({ x: leaf("hint.browser", { when_focus: "input" }), y: two, z: deep })), []);
  assert.deepEqual(chrome_hint_keys_of_keymap(undefined), []);
  const many = Object.fromEntries(Array.from({ length: MAX_CHROME_HINT_BINDINGS + 3 }, (_, index) => [`<F${index + 1}>`, leaf("hint.browser")]));
  const kept = chrome_hint_keys_of_keymap(keymap(many));
  assert.equal(kept.length, MAX_CHROME_HINT_BINDINGS);
  assert.ok(validate_module_state({ v: 1, enabled: true, keys: [], tabs: {}, chrome_hint_keys: kept }).ok);
});

test("the state carries the bindings while the switch is on, and none while it is off", async () => {
  for (const disabled of [false, true]) {
    const bucket: Record<string, unknown> = {};
    const module = create_browser_module({
      session: { get: async (key) => ({ [key as string]: bucket[key as string] }), set: async (items) => void Object.assign(bucket, items), remove: async () => undefined },
      is_on: async () => true,
      read_disabled: async () => disabled,
      read_keymap: async () => keymap({ g: branch({ B: leaf("hint.browser") }) }),
      read_tab_records: async () => ({}),
      check_args: (_id, args) => args ?? {},
      handlers: {},
      now: () => 0,
      later: () => undefined,
    });
    await module.sync();
    const written = bucket[BROWSER_MODULE_STATE_STORAGE_KEY] as { chrome_hint_keys?: unknown };
    assert.deepEqual(written.chrome_hint_keys, disabled ? undefined : [["g", "B"]]);
  }
});

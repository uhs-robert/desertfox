import assert from "node:assert/strict";
import { test } from "node:test";
import { arm_sidebar_once, create_browser_module, focus_keys_of_keymap, normal_once_keys_of_keymap, sidebar_rows_of } from "../../src/background/browser_module.ts";
import type { CheckCommandArgs } from "../../src/background/browser_module.ts";
import { BROWSER_MODULE_PROTOCOL_VERSION, BROWSER_MODULE_STATE_STORAGE_KEY, focus_keys_of, MAX_KEY_ROWS, normal_once_keys_of } from "../../src/shared/browser_module_protocol.ts";
import type { ModuleArgs, ModuleStatus } from "../../src/shared/browser_module_protocol.ts";
import { create_module_call } from "../../src/background/browser_module_call.ts";
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

// A module channel that answers each request as the module core would: `answer` is the reply's ok and error.
function module_answering(answer: { ok: boolean; error?: string }, status: ModuleStatus["result"] = "matched") {
  const kinds: string[] = [];
  const module_call = create_module_call({
    send: async (kind, _args, on_id) => {
      kinds.push(kind);
      on_id?.("m1");
      setImmediate(() => module_call.hear({ v: BROWSER_MODULE_PROTOCOL_VERSION, reply_to: "m1", ...answer }));
      return { ok: true, id: "m1" };
    },
    withdraw: async () => undefined,
    read_status: async () => ({ result: status }) as ModuleStatus,
    later: () => () => undefined,
  });
  return { kinds, call: (kind: string, args: ModuleArgs) => module_call.call(kind, args) };
}

// The shortcut handler runs the page's own arm whenever arm_sidebar_once is false.
test("<A-o> falls back to the page arm, without a word, when a module older than sidebar.normal_once refuses the kind", async (t) => {
  const logged = [t.mock.method(console, "warn"), t.mock.method(console, "error"), t.mock.method(console, "info")];
  const older = module_answering({ ok: false, error: "the kind is not on the allow list" });
  assert.equal(await arm_sidebar_once(older.call), false);
  assert.deepEqual(older.kinds, ["sidebar.normal_once"]);
  assert.deepEqual(logged.map((spy) => spy.mock.callCount()), [0, 0, 0]);
});

test("<A-o> skips the page arm when the module armed the sidebar, and sends nothing with the module off", async () => {
  const known = module_answering({ ok: true });
  assert.equal(await arm_sidebar_once(known.call), true);
  assert.deepEqual(known.kinds, ["sidebar.normal_once"]);
  const outside = module_answering({ ok: false, error: "The focus is not in the sidebar" });
  assert.equal(await arm_sidebar_once(outside.call), false);
  const off = module_answering({ ok: true }, "waiting");
  assert.equal(await arm_sidebar_once(off.call), false);
  assert.deepEqual(off.kinds, []);
});

test("the state names the chords of mode.normal_once and the tree's forward keys that move the focus", () => {
  const compiled = { format_version: COMPILED_KEYMAP_VERSION, modes: { normal: branch({ g: branch({ t: leaf("tab.goto"), p: leaf("pane.focus") }), "<C-w>": leaf("browser.focus_page") }), browser: branch({ "<A-o>": leaf("mode.normal_once"), "<A-j>": leaf("tab.next"), "<A-p>": leaf("mode.normal_once") }) }, mode_indicator: "always", which_key_delay_ms: 0, toast_ms: 1, toast_error_ms: 1 } as unknown as CompiledKeymap;
  assert.deepEqual(normal_once_keys_of_keymap(compiled), ["<A-o>", "<A-p>"]);
  assert.deepEqual(normal_once_keys_of_keymap(undefined), []);
  const tree = { children: { g: { children: { t: "forward", p: "forward" } }, "<C-w>": "forward" } } as const;
  assert.deepEqual(focus_keys_of_keymap(compiled, tree), ["g p", "<C-w>"]);
  assert.deepEqual(normal_once_keys_of(["<A-o>", "two words"]), undefined);
  assert.deepEqual(focus_keys_of(["g p", 3]), undefined);
});

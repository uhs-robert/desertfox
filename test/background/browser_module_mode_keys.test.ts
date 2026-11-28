import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";
import { create_browser_module, insert_rows_of, key_rows_of } from "../../src/background/browser_module.ts";
import { BROWSER_MODULE_HELLO_STORAGE_KEY, BROWSER_MODULE_STATE_STORAGE_KEY, HELLO_MIN_INTERVAL_MS, MAX_KEY_ROWS } from "../../src/shared/browser_module_protocol.ts";
import type { ModuleState, ScopeTree } from "../../src/shared/browser_module_protocol.ts";
import { locked_page_command_ids } from "../../src/shared/browser_module_scope.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import type { CompiledKeymap } from "../../src/shared/prefix_tree.ts";

const find_command = (id: string) => registry.get(id);
const real_check = (id: string, args: Record<string, unknown> | undefined) => {
  const command = registry.get(id);
  const checked = command && check_args(command, args);
  return checked?.ok ? checked.args : undefined;
};
const compiled = (config = empty_config()): CompiledKeymap => compile_config({ config, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: find_command, enum_sources: {} }).compiled;
const MODE_KEYS = ["i", "<S-Escape>", "<S-Insert>", "<AC-Escape>", "<AC-`>", "<C-v>"];

// The state the background writes with the default keymap, and a hello the test sets.
function setup(keymap: CompiledKeymap = compiled()) {
  const data = new Map<string, unknown>();
  let now = 10_000;
  const timers: (() => void)[] = [];
  const module = create_browser_module({
    session: {
      get: async (key: string | string[]) => Object.fromEntries([key].flat().filter((name) => data.has(name)).map((name) => [name, data.get(name)])),
      set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value))),
      remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => data.delete(key)),
    } as never,
    is_on: async () => true,
    read_disabled: async () => false,
    read_keymap: async () => keymap,
    read_tab_records: async () => ({}),
    check_args: real_check,
    locked_commands: locked_page_command_ids(registry.list()),
    find_command,
    handlers: {},
    now: () => now,
    later: (run) => void timers.push(run),
  });
  const state = () => data.get(BROWSER_MODULE_STATE_STORAGE_KEY) as ModuleState;
  const say_hello = async (hello: Record<string, unknown>) => {
    data.set(BROWSER_MODULE_HELLO_STORAGE_KEY, { v: 1, module_version: "1", ...hello });
    now += HELLO_MIN_INTERVAL_MS + 1;
    module.read_hello();
    timers.splice(0).forEach((run) => run());
    for (let turn = 0; turn < 4; turn++) await module.tab_changed("0", undefined);
  };
  return { module, state, say_hello };
}
const leaf_keys = (tree: ScopeTree) => MODE_KEYS.filter((key) => Object.hasOwn(tree.children, key));

test("an older module keeps its tree: the mode keys wait for the mode_keys flag in the hello", async () => {
  const { module, state, say_hello } = setup();
  await module.sync();
  assert.deepEqual(leaf_keys(state().tree!), [], "no hello yet");
  await say_hello({ bar: true });
  assert.deepEqual(leaf_keys(state().tree!), [], "a hello of an older module");
  await say_hello({ mode_keys: true });
  assert.deepEqual(leaf_keys(state().tree!), MODE_KEYS, "a module that defines them");
  assert.deepEqual(state().tree!.children[","] && (state().tree!.children[","] as ScopeTree).children["i"], { native: "mode.set", args: { mode: "ignore" } });
  await say_hello({ bar: true });
  assert.deepEqual(leaf_keys(state().tree!), [], "a module that went back to an older file");
});

test("the mode commands never become single-key rows, which the cap could shift scroll keys out for", () => {
  const rows = key_rows_of(compiled(), real_check);
  assert.deepEqual(rows.filter((row) => row.id.startsWith("mode.")), []);
  assert.ok(rows.length <= MAX_KEY_ROWS);
});

test("the insert table holds the default Escape, C-[, send-Escape and the reserved which-key rows, in key order", () => {
  assert.deepEqual(insert_rows_of(compiled(), real_check), [
    { key: "<A-?>", id: "help.whichkey" },
    { key: "<A-Escape>", id: "page.send_key" },
    { key: "<C-r>", id: "register.paste" },
    { key: "<Escape>", id: "mode.escape" },
  ]);
});

test("a keymap whose insert mode has no leave key gives an empty table, which is not the same as no table", () => {
  const base = compiled();
  const empty = { ...base, modes: { ...base.modes, insert: { kind: "branch", children: {} } } } as unknown as CompiledKeymap;
  assert.deepEqual(insert_rows_of(empty, real_check), []);
});

test("a page.send_key row sends the table only as a plain Escape: another key, a modifier or a target is left out", () => {
  const base = compiled();
  const insert = base.modes["insert" as keyof typeof base.modes] as { kind: "branch"; children: Record<string, { kind: "leaf"; steps: { invocation: { id: string; args?: Record<string, unknown> } }[] }> };
  const send = (args: Record<string, unknown>) => ({ ...insert.children["<A-Escape>"]!, steps: [{ ...insert.children["<A-Escape>"]!.steps[0]!, invocation: { id: "page.send_key", args } }] });
  const with_rows = (rows: Record<string, unknown>) => ({ ...base, modes: { ...base.modes, insert: { kind: "branch", children: rows } } }) as unknown as CompiledKeymap;
  const rows = insert_rows_of(with_rows({ a: send({ key: "Escape", key_code: 27 }), b: send({ key: "Enter", key_code: 13 }), c: send({ key: "Escape", key_code: 27, ctrl: true }), d: send({ key: "Escape", key_code: 27, target: "#x" }), e: send({ key: "Escape", key_code: 27, times: 2 }) }), real_check);
  assert.deepEqual(rows, [{ key: "a", id: "page.send_key" }]);
});

test("a keymap that unbinds every insert key gives an empty table, so the module keeps no Escape of its own", () => {
  const unbound = Object.fromEntries(["<A-?>", "<Escape>", "<C-r>", "<C-o>", "<A-Escape>"].map((key) => [key, ""]));
  const keymap = compiled({ ...empty_config(), keymap: { insert: unbound } as never });
  assert.equal((keymap.modes as Record<string, unknown>)["insert"], undefined, "the compiler drops the empty insert mode");
  assert.deepEqual(insert_rows_of(keymap, real_check), []);
});

test("with no usable keymap there is no table, so the module keeps its plain Escape", () => {
  assert.equal(insert_rows_of(undefined, real_check), undefined);
});

test("the state carries the table beside the tree", async () => {
  const { module, state } = setup();
  await module.sync();
  assert.deepEqual(state().insert_keys?.map((row) => row.key), ["<A-?>", "<A-Escape>", "<C-r>", "<Escape>"]);
});

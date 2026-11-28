import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { create_browser_module, which_key_table_of_keymap } from "../../src/background/browser_module.ts";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";
import { panel_after_prefix } from "../../src/background/list_keys.ts";
import { BROWSER_MODULE_STATE_STORAGE_KEY, MAX_WHICH_KEY_BYTES, which_key_table_of } from "../../src/shared/browser_module_protocol.ts";
import type { ModuleState, ScopeTree, WhichKeyTable } from "../../src/shared/browser_module_protocol.ts";
import { locked_page_command_ids, scope_tree_of } from "../../src/shared/browser_module_scope.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import type { CompiledKeymap } from "../../src/shared/prefix_tree.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";

const find_command = (id: string) => registry.get(id);
const real_check = (id: string, args: Record<string, unknown> | undefined) => {
  const command = registry.get(id);
  const checked = command && check_args(command, args);
  return checked?.ok ? checked.args : undefined;
};
const LOCKED = locked_page_command_ids(registry.list());
const compiled = (config = empty_config()): CompiledKeymap => compile_config({ config, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: find_command, enum_sources: {} }).compiled;
const DEFAULT_KEYMAP_COMPILED = compiled();
const DEFAULT_TREE = scope_tree_of(DEFAULT_KEYMAP_COMPILED, LOCKED, real_check);
const table_of = (keymap = DEFAULT_KEYMAP_COMPILED, tree = DEFAULT_TREE) => which_key_table_of_keymap(keymap, tree, find_command);

// Every branch path of the scope tree, the root left out.
function branch_paths(tree: ScopeTree, path: string[] = []): string[] {
  return Object.entries(tree.children).flatMap(([token, child]) => (typeof child === "object" && "children" in child ? [[...path, token].join(" "), ...branch_paths(child, [...path, token])] : []));
}

test("the default table has a panel for every branch of the locked-page tree and passes its own validator", () => {
  const table = table_of()!;
  assert.ok(table);
  assert.deepEqual(Object.keys(table.panels).sort(), branch_paths(DEFAULT_TREE).filter((path) => !path.split(" ").includes("")).sort());
  assert.deepEqual(which_key_table_of(table), table);
  assert.equal(table.delay_ms, DEFAULT_KEYMAP_COMPILED.which_key_delay_ms);
  assert.equal(table.border, "square");
});

test("each row is a key of the scope tree under its path, so no hint, caret or other key a locked page cannot run is listed", () => {
  const table = table_of()!;
  for (const [path, panel] of Object.entries(table.panels)) {
    let node: ScopeTree = DEFAULT_TREE;
    for (const token of path.split(" ")) node = node.children[token] as ScopeTree;
    const tokens = Object.keys(node.children).map((token) => (token === "" ? "<key>" : token));
    for (const row of panel.rows) assert.ok(tokens.includes(row.keys), `${path} ${row.keys}`);
    assert.equal(panel.rows.length, Object.keys(node.children).length, path);
  }
  const hint_commands = new Set(registry.list().filter((command) => command.id.startsWith("hint.run") || command.id.startsWith("caret.")).map((command) => command.label));
  for (const panel of Object.values(table.panels)) for (const row of panel.rows) assert.ok(!hint_commands.has(row.command), row.command);
});

test("a panel shows the page panel's rows for the same keys: the label, the group names and the order, with no description", () => {
  const table = table_of()!;
  const page = panel_after_prefix(DEFAULT_KEYMAP_COMPILED.modes.normal, ["g"], find_command);
  const page_rows = new Map(page.rows.map((row) => [row.keys, row]));
  assert.deepEqual(table.panels["g"]!.title, page.title);
  for (const row of table.panels["g"]!.rows) {
    assert.equal(row.command, page_rows.get(row.keys)?.command, row.keys);
    assert.equal(row.more === true, page_rows.get(row.keys)?.more, row.keys);
    assert.equal("description" in row, false);
  }
  const order = page.rows.map((row) => row.keys).filter((key) => table.panels["g"]!.rows.some((row) => row.keys === key));
  assert.deepEqual(table.panels["g"]!.rows.map((row) => row.keys), order);
});

test("the default table stays small beside its cap", () => {
  const bytes = new TextEncoder().encode(JSON.stringify(table_of())).length;
  assert.ok(bytes < 10 * 1024, `${bytes} bytes`);
  assert.ok(bytes < MAX_WHICH_KEY_BYTES / 4);
});

test("no table when which-key is off, and the skip list and the border follow the settings", () => {
  assert.equal(table_of({ ...DEFAULT_KEYMAP_COMPILED, which_key_delay_ms: 0 }), undefined);
  assert.equal(which_key_table_of_keymap(undefined, DEFAULT_TREE, find_command), undefined);
  const table = table_of({ ...DEFAULT_KEYMAP_COMPILED, which_key_skip: ["g"], which_key_border: "chamfer", which_key_delay_ms: 450 })!;
  assert.deepEqual([table.skip, table.border, table.delay_ms], [["g"], "chamfer", 450]);
});

test("a user's group name keeps its text with control and bidi characters taken out, cut to the label limit", () => {
  const keymap = DEFAULT_KEYMAP_COMPILED;
  const normal = keymap.modes.normal!;
  const g = normal.children["g"]!;
  const named = { ...keymap, modes: { ...keymap.modes, normal: { ...normal, children: { ...normal.children, g: { ...g, label: `Go‮\u0007${"x".repeat(100)}` } } } } } as CompiledKeymap;
  const title = table_of(named)!.panels["g"]!.title[0]!;
  assert.equal(title.length, 60);
  assert.match(title, /^\+Gox+$/);
});

test("a table over a limit is left out with one warning", (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const keymap = DEFAULT_KEYMAP_COMPILED;
  const children = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`<F${index + 1}>`, { kind: "branch" as const, children: { a: keymap.modes.normal!.children["J"]! } }]));
  const wide = { ...keymap, modes: { ...keymap.modes, normal: { kind: "branch" as const, children } } } as CompiledKeymap;
  const tree = scope_tree_of(wide, LOCKED, real_check);
  assert.equal(Object.keys(tree.children).length, 70);
  assert.equal(table_of(wide, tree), undefined);
  assert.equal(warn.mock.callCount(), 1);
});

// The state the background writes, with the default keymap and the locked-page commands.
function setup({ which_key_delay_ms = DEFAULT_KEYMAP_COMPILED.which_key_delay_ms, on = true, disabled = false, with_lookup = true } = {}) {
  const data = new Map<string, unknown>();
  const config = { keymap: { ...DEFAULT_KEYMAP_COMPILED, which_key_delay_ms } as CompiledKeymap, on, disabled };
  const module = create_browser_module({
    session: {
      get: async (key: string | string[]) => Object.fromEntries([key].flat().filter((name) => data.has(name)).map((name) => [name, data.get(name)])),
      set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value))),
      remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => data.delete(key)),
    } as never,
    is_on: async () => config.on,
    read_disabled: async () => config.disabled,
    read_keymap: async () => config.keymap,
    read_tab_records: async () => ({}),
    check_args: real_check,
    locked_commands: LOCKED,
    ...(with_lookup && { find_command }),
    handlers: {},
    now: () => 0,
    later: () => undefined,
  });
  const state = () => data.get(BROWSER_MODULE_STATE_STORAGE_KEY) as ModuleState | undefined;
  return { module, config, state };
}

test("the state carries the table beside the tree, and a keymap change rewrites it", async () => {
  const { module, config, state } = setup();
  await module.sync();
  assert.deepEqual(state()?.which_key, table_of());
  config.keymap = { ...config.keymap, which_key_border: "round" };
  await module.sync();
  assert.equal((state()?.which_key as WhichKeyTable).border, "round");
  config.keymap = { ...config.keymap, which_key_delay_ms: 0 };
  await module.sync();
  assert.equal(state()?.which_key, undefined, "which-key off, no table");
});

test("no table while DesertFox is switched off, with no registry lookup, or once the setting is off", async () => {
  const off = setup({ disabled: true });
  await off.module.sync();
  assert.equal(off.state()?.which_key, undefined);
  const no_lookup = setup({ with_lookup: false });
  await no_lookup.module.sync();
  assert.ok(no_lookup.state()?.tree);
  assert.equal(no_lookup.state()?.which_key, undefined);
  const consent = setup();
  await consent.module.sync();
  consent.config.on = false;
  await consent.module.sync();
  assert.equal(consent.state(), undefined, "the setting off removes the state and the table with it");
});

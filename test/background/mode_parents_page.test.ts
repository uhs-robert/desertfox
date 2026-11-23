import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { create_keymap_source } from "../../src/background/keymap_source.ts";
import { list_keys } from "../../src/background/list_keys.ts";
import { page_keymap_for, page_mode_trees_for } from "../../src/background/page_keymap.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import type { KeymapConfig } from "../../src/shared/keymap.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, current_keymap } from "../../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeLeaf, TreeNode } from "../../src/shared/prefix_tree.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { command_meta } from "../../src/shared/registry/index.ts";
import { site_columns_for } from "../../src/shared/site/site_columns.ts";
import { key_labels } from "../../src/shared/completion/keys.ts";
import { build_help_model } from "../../src/help/model.ts";

function compile(keymap: KeymapConfig = {}, settings: Record<string, unknown> = {}) {
  const { compiled, warnings } = compile_config({ config: { ...empty_config(), keymap, settings: settings as never }, default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["site"], containers: [] } });
  return { compiled, warnings };
}

const storage_of = (stored: unknown) => ({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: stored }) }) as never;
const page_tree = async (compiled: CompiledKeymap, mode: "item" | "item_visual" | "normal", address = "https://example.test/") => (await page_keymap_for(storage_of(compiled), [address]))!.keymap.modes[mode]!;
const at = (root: TreeNode | undefined, keys: string): TreeNode | undefined => [...keys].reduce<TreeNode | undefined>((node, key) => (node?.kind === "branch" ? node.children[key] : undefined), root);
const ids = (node: TreeNode | undefined) => (node as TreeLeaf | undefined)?.steps.map((step) => step.invocation.id);

test("the page reply holds the resolved visual tree and leaves the stored one as it was", async () => {
  const { compiled } = compile();
  const stored = JSON.stringify(compiled);
  const visual = await page_tree(compiled, "item_visual");
  assert.deepEqual(ids(at(visual, "f")), ["mode.set", "hint.run"]);
  assert.deepEqual(ids(at(visual, "J")), ["mode.set", "tab.next"]);
  assert.equal(JSON.stringify(compiled), stored, "the cached keymap is shared, so the resolve copies");
  const reply = (await page_keymap_for(storage_of(compiled), ["https://example.test/"]))!;
  assert.equal("mode_parents" in reply.keymap, false, "pages never see the links");
});

test("user overrides and unbinds in item mode reach visual item mode", async () => {
  const rebound = compile({ item: { f: { id: "tab.next" } } });
  assert.deepEqual(rebound.warnings, []);
  assert.deepEqual(ids(at(await page_tree(rebound.compiled, "item_visual"), "f")), ["mode.set", "tab.next"]);
  const unbound = compile({ item: { f: null, ";": null } });
  const visual = await page_tree(unbound.compiled, "item_visual");
  assert.equal(at(visual, "f"), undefined);
  // `";" = ""` in item unbinds no key there, since `;` itself is no key, so the group stays in both modes.
  assert.ok(at(visual, ";"));
});

test("an unbind in visual item mode blocks the taken key, and an unbound prefix its whole group, while item mode keeps them", async () => {
  const { compiled, warnings } = compile({ item_visual: { f: null, ";": null, gt: null } });
  assert.deepEqual(warnings, []);
  assert.deepEqual(compiled.mode_parents?.item_visual?.blocked, [["f"], [";"], ["g", "t"]]);
  const visual = await page_tree(compiled, "item_visual");
  assert.equal(at(visual, "f"), undefined);
  assert.equal(at(visual, ";"), undefined);
  assert.equal(at(visual, "gt"), undefined);
  assert.ok(at(visual, "gT"));
  assert.ok(at(visual, "gg"), "the own gg stays");
  const item = await page_tree(compiled, "item");
  for (const keys of ["f", ";yl", "gt"]) assert.ok(at(item, keys), keys);
});

test("a user key in visual item mode wins over the taken key", async () => {
  const { compiled } = compile({ item_visual: { f: { id: "page.item", args: { direction: "other_end", extend: true } } } });
  const f = at(await page_tree(compiled, "item_visual"), "f") as TreeLeaf;
  assert.deepEqual(ids(f), ["page.item"]);
  assert.equal(f.steps[0]!.leave, undefined);
});

test("the leave step and the filter come from the compile", () => {
  const { compiled } = compile();
  const link = compiled.mode_parents?.item_visual;
  assert.equal(link?.parent, "item");
  assert.deepEqual(link?.leave, { invocation: { id: "mode.set", args: { mode: "item" } }, runs_in: "content", count_rule: "ignore", leave: true });
  // The keys run in item mode after the leave step, so the filter reads item.
  assert.ok(link?.runs.includes("tab.next"));
  assert.ok(!link?.runs.includes("tab.close"), "tab.close lists no item mode");
  assert.equal(compiled.modes.item_visual?.children["f"], undefined);
});

test("an older stored keymap reads as none, so the background compiles again", () => {
  const { compiled } = compile();
  assert.equal(current_keymap({ ...compiled, format_version: 17 } as never), undefined);
  assert.equal(current_keymap(compiled), compiled);
});

const row_compile = (row: Record<string, unknown>, settings: Record<string, unknown> = {}) => compile({}, { ...settings, site_rules: [row] }).compiled;

test("a row's item key reaches visual item mode with the leave step, and a row's visual key wins over it", async () => {
  const row = { site: "https://rows.test/*", keymap: { item: { x: { id: "tab.next" }, j: { id: "tab.prev" } }, item_visual: { y: { id: "page.item", args: { direction: "other_end", extend: true } } } } };
  const compiled = row_compile(row);
  const visual = await page_tree(compiled, "item_visual", "https://rows.test/");
  assert.deepEqual(ids(at(visual, "x")), ["mode.set", "tab.next"]);
  assert.equal((at(visual, "j") as TreeLeaf).steps[0]!.invocation.args?.["extend"], true, "the visual j is an own key");
  assert.deepEqual(ids(at(visual, "y")), ["page.item"]);
  // Another page gets none of the row's keys.
  assert.equal(at(await page_tree(compiled, "item_visual", "https://other.test/"), "x"), undefined);
});

test("which-key and the page reply read the same resolved visual tree", async () => {
  const row = { site: "https://rows.test/*", keymap: { item: { x: { id: "tab.next", label: "Row next" } } } };
  const compiled = row_compile(row);
  const address = "https://rows.test/";
  assert.deepEqual(page_mode_trees_for(compiled, site_columns_for(compiled, [address]), address).item_visual, await page_tree(compiled, "item_visual", address));
  const find = (id: string) => { const command = registry.get(id); return command && command_meta(command); };
  const panel = await list_keys(storage_of(compiled), find, { mode: "item_visual", prefix: [] }, { addresses: [address] });
  const row_for = (keys: string) => panel.rows.find((row) => row.keys === keys);
  assert.equal(row_for("x")?.command, "Row next");
  // The label is the item key's own, not the leave step's.
  assert.equal(row_for("J")?.command, (at(compiled.modes.item, "J") as TreeLeaf).label);
  assert.equal(row_for(";")?.more, true);
  assert.equal(row_for("V")?.command, "End the selection");
});

test("the arrows rewrite runs on the resolved trees, so visual item mode takes the rewritten item keys", async () => {
  const drive = "https://drive.google.com/drive/my-drive";
  const { compiled } = compile_config({ config: { ...empty_config(), settings: { item_select: "arrows" } as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: (await import("../../src/background/default_site_rows.ts")).DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  const item = await page_tree(compiled, "item", drive);
  const visual = await page_tree(compiled, "item_visual", drive);
  const item_pick = at(item, "I") as TreeLeaf;
  const visual_pick = at(visual, "I") as TreeLeaf;
  assert.equal(item_pick.steps[0]!.invocation.args?.["row_only"], true);
  assert.deepEqual(visual_pick.steps.slice(1), item_pick.steps);
  // The own extend keys name no selector, so the rewrite leaves them.
  assert.deepEqual(ids(at(visual, "j")), ["page.item"]);
});

test("graft, then the key rule, then resolve: a child of normal takes the page's normal tree", () => {
  // PR A links only visual item mode to item mode. A link to normal mode shows the order on the normal tree, where pass and only act.
  const keymap: KeymapConfig = { ...DEFAULT_KEYMAP, mode_parents: { ...DEFAULT_KEYMAP.mode_parents, media: { parent: "normal" } } };
  const row = { site: "https://rows.test/*", pass: "aa", bind: { "<A-x>": { id: "hint.run" } } };
  const { compiled, warnings } = compile_config({ config: { ...empty_config(), settings: { site_rules: [row] } as never }, default_keymap: keymap, get_command: (id) => registry.get(id), enum_sources: {} });
  assert.deepEqual(warnings, []);
  const address = "https://rows.test/";
  const trees = page_mode_trees_for(compiled, site_columns_for(compiled, [address]), address);
  assert.equal(at(trees.media, "aa"), undefined, "a key the row passes in normal mode passes in the child too");
  assert.deepEqual(ids(trees.media?.children["<A-x>"]), ["hint.run"], "a row's normal bind reaches the child, with no leave step");
  assert.ok(at(trees.media, "j"), "the child's own keys stay");
  const elsewhere = page_mode_trees_for(compiled, site_columns_for(compiled, ["https://other.test/"]), "https://other.test/");
  assert.deepEqual(ids(at(elsewhere.media, "aa")), ids(at(compiled.modes.normal, "aa")));
  assert.equal(elsewhere.media?.children["<A-x>"], undefined);
});

test("a config reload: each read resolves the keymap in force", async () => {
  let stored = compile().compiled;
  const listeners: ((changes: Record<string, unknown>, area: string) => void)[] = [];
  const source = create_keymap_source({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: stored }) } as never, { addListener: (listener: never) => void listeners.push(listener) } as never);
  const visual_f = async () => {
    const keymap = (await source.read())!;
    const address = "https://example.test/";
    return ids(at(page_mode_trees_for(keymap, site_columns_for(keymap, [address]), address).item_visual, "f"));
  };
  assert.deepEqual(await visual_f(), ["mode.set", "hint.run"]);
  stored = compile({ item: { f: { id: "tab.next" } } }).compiled;
  for (const listener of listeners) listener({ [COMPILED_KEYMAP_STORAGE_KEY]: {} }, "local");
  assert.deepEqual(await visual_f(), ["mode.set", "tab.next"]);
  // Reading twice gives the same tree and leaves the cached copy as it was.
  const cached = JSON.stringify(await source.read());
  await visual_f();
  assert.equal(JSON.stringify(await source.read()), cached);
});

test("help and completion list a taken key under the item command, not under mode.set", () => {
  const { compiled } = compile();
  const commands = registry.list().map(command_meta);
  const labels = key_labels(compiled, commands, "item_visual");
  assert.match(labels.get("tab.next") ?? "", /J/);
  assert.match(labels.get("hint.run") ?? "", /\bf\b/);
  assert.equal(labels.get("mode.set"), undefined, "no taken key lists under its leave step");
  const model = build_help_model(commands, compiled, []);
  const rows_of = (id: string) => model.groups.flatMap((group) => group.commands).find((command) => command.id === id)!.keys.filter((row) => row.mode === "item_visual").map((row) => row.keys);
  assert.ok(rows_of("hint.run").includes("f"));
  assert.ok(rows_of("tab.next").includes("J"));
  // An authored mode.set stays under mode.set: v and V, and the taken keys that start another mode (gV).
  for (const keys of ["v", "V", "gV"]) assert.ok(rows_of("mode.set").includes(keys), keys);
  for (const keys of ["f", "J", "I"]) assert.ok(!rows_of("mode.set").includes(keys), keys);
});

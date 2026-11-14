import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import "../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { page_keymap_for } from "../src/background/page_keymap.ts";
import { leaf_for_focus } from "../src/content/run_leaf.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { build_commands_file } from "../src/shared/registry/index.ts";
import { compile_keymap, create_matcher } from "../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeLeaf, TreeNode } from "../src/shared/prefix_tree.ts";
import { SETTING_SPECS } from "../src/shared/settings_schema.ts";
import { build_config } from "../tools/build-config/build_config.ts";
import { make_tmp_dir } from "./support/tmp_dir.ts";

const MAP = 'div[role="application"][tabindex="0"]';
const MAPS = "https://www.google.com/maps/@42.36,-71.06,15z";

// A stand-in element: `matches` answers for the one selector it carries.
const element = (matching: string | undefined): Element => ({ matches: (selector: string) => selector === matching, closest: (selector: string) => (selector === matching ? element(matching) : null) }) as unknown as Element;
const body = element(undefined);
const leaf = (id: string, extra: Partial<TreeLeaf> = {}): TreeLeaf => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "content", count_rule: "ignore" }], ...extra });

test("the guard runs the bind with no focus, with body focused and with a matching element focused", () => {
  const guarded = leaf("page.send_key", { when_focus: MAP, otherwise: leaf("scroll.lines") });
  for (const focused of [null, body, element(MAP)]) assert.equal(leaf_for_focus(guarded, focused, body), guarded);
});

test("the guard runs the replaced leaf when another element has focus, and nothing when the bind replaced none", () => {
  const otherwise = leaf("scroll.lines");
  assert.equal(leaf_for_focus(leaf("page.send_key", { when_focus: MAP, otherwise }), element("#panel"), body), otherwise);
  assert.equal(leaf_for_focus(leaf("page.send_key", { when_focus: MAP }), element("#panel"), body), undefined);
});

test("focus on an element inside a matching element counts as a match", () => {
  const inside = { matches: () => false, closest: (selector: string) => (selector === MAP ? element(MAP) : null) } as unknown as Element;
  const guarded = leaf("page.send_key", { when_focus: MAP, otherwise: leaf("scroll.lines") });
  assert.equal(leaf_for_focus(guarded, inside, body), guarded);
});

test("a leaf with no guard runs whatever has focus, and a selector that does not parse falls through", () => {
  const plain = leaf("scroll.lines");
  assert.equal(leaf_for_focus(plain, element("#panel"), body), plain);
  const throwing = { matches: () => { throw new SyntaxError("bad selector"); }, closest: () => { throw new SyntaxError("bad selector"); } } as unknown as Element;
  const otherwise = leaf("scroll.lines");
  assert.equal(leaf_for_focus(leaf("page.send_key", { when_focus: "[[", otherwise }), throwing, body), otherwise);
});

const resolve = () => ({ runs_in: "content" as const, label: "x", count: "ignore" as const });
const storage_of = (stored: unknown) => ({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: stored }) }) as never;
const page_tree = async (compiled: CompiledKeymap, url: string) => (await page_keymap_for(storage_of(compiled), [url]))!.keymap.modes.normal!;

test("a guarded bind keeps the leaf it replaced, a guarded bind over a branch keeps none, and an unguarded bind keeps none", async () => {
  const keymap = { normal: { j: { id: "a.j" }, gg: { id: "a.gg" }, k: { id: "a.k" } } };
  const bind = { j: { id: "b.j", when_focus: MAP }, g: { id: "b.g", when_focus: MAP }, k: { id: "b.k" } };
  const { compiled } = compile_keymap(keymap, { site_rules: [{ site: "https://a.test/*", bind }] }, resolve);
  const tree = await page_tree(compiled, "https://a.test/");
  const child = (token: string) => tree.children[token] as TreeLeaf;
  assert.equal(child("j").when_focus, MAP);
  assert.equal(child("j").otherwise?.steps[0]?.invocation.id, "a.j");
  assert.equal(child("j").steps[0]?.invocation.when_focus, undefined, "the guard sits on the leaf, not in the args the router runs");
  assert.equal(child("g").otherwise, undefined);
  assert.equal("otherwise" in child("k"), false);
});

test("a count and a key sequence reach the fallback: 5j falls through with its count, and gg is untouched", async () => {
  const keymap = { normal: { j: { id: "a.j" }, gg: { id: "a.gg" } } };
  const { compiled } = compile_keymap(keymap, { site_rules: [{ site: "https://a.test/*", bind: { j: { id: "b.j", when_focus: MAP } } }] }, resolve);
  const matcher = create_matcher({ ...compiled, modes: { ...compiled.modes, normal: await page_tree(compiled, "https://a.test/") } });
  matcher.feed("normal", "5");
  const counted = matcher.feed("normal", "j");
  assert.equal(counted.kind_, "match");
  if (counted.kind_ !== "match") return;
  assert.equal(counted.count, 5);
  assert.equal(leaf_for_focus(counted.leaf, element("#panel"), body)?.steps[0]?.invocation.id, "a.j");
  matcher.feed("normal", "g");
  const sequence = matcher.feed("normal", "g");
  assert.equal(sequence.kind_ === "match" && sequence.leaf.steps[0]?.invocation.id, "a.gg");
});

test("a keymap binding with when_focus is skipped with a warning, since it replaces nothing", () => {
  const { compiled, warnings } = compile_keymap({ normal: { j: { id: "a.j", when_focus: MAP } } }, {}, resolve);
  assert.equal(compiled.modes.normal?.children["j"], undefined);
  assert.match(warnings.join("\n"), /when_focus works only in a site row bind/);
});

test("a keymap entry with when_focus is skipped before it can drop the default key it extends", () => {
  const { compiled, warnings } = compile_keymap({ normal: { j: { id: "a.j" }, jx: { id: "a.jx", when_focus: MAP } } }, {}, resolve, { engine_labels: {} }, { normal: { j: { id: "a.j" } } });
  assert.equal((compiled.modes.normal?.children["j"] as TreeLeaf | undefined)?.steps[0]?.invocation.id, "a.j");
  assert.match(warnings.join("\n"), /"jx": when_focus works only in a site row bind/);
});

test("a site row takes when_focus on a run table and on an invocation table, and refuses one that is not text", () => {
  const dir = make_tmp_dir("desertfox-focus-");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.toml"), `[[site_rules]]\nsite = "https://a.test/*"\nbind = { j = { run = "tab.next", when_focus = "#map" }, k = { id = "tab.prev", when_focus = "#map" } }\n`);
  const bind = (build_config(dir, build_commands_file(registry).commands).settings.site_rules?.[0] as { bind: Record<string, unknown> }).bind;
  assert.deepEqual(bind.j, { id: "tab.next", when_focus: "#map" });
  assert.deepEqual(bind.k, { id: "tab.prev", when_focus: "#map" });
  assert.equal(SETTING_SPECS.site_rules.check([{ site: "https://a.test/*", bind: { j: { run: "tab.next", when_focus: "#map" } } }]), true);
  assert.equal(SETTING_SPECS.site_rules.check([{ site: "https://a.test/*", bind: { j: { run: "tab.next", when_focus: 3 } } }]), false);
});

function with_defaults(settings: Record<string, unknown>) {
  const { compiled, warnings } = compile_config({ config: { ...empty_config(), settings: settings as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  assert.deepEqual(warnings, []);
  return compiled;
}

test("the shipped maps rows send arrows to the map behind a guard that falls back to the plain keys", async () => {
  const default_j = (DEFAULT_KEYMAP.normal!["j"] as { id: string }).id;
  for (const url of [MAPS, "https://google.com/maps/place/Boston", "https://www.google.com/maps"]) {
    const tree = await page_tree(with_defaults({}), url);
    for (const [key, arrow] of [["h", "ArrowLeft"], ["j", "ArrowDown"], ["k", "ArrowUp"], ["l", "ArrowRight"]] as const) {
      const node = tree.children[key] as TreeLeaf;
      const { key: sent, key_code, target } = node.steps[0]?.invocation.args ?? {};
      assert.deepEqual({ sent, key_code, target }, { sent: arrow, key_code: { h: 37, j: 40, k: 38, l: 39 }[key], target: MAP }, `${url} ${key}`);
      assert.equal(node.when_focus, MAP);
      assert.ok(node.otherwise, `${url} ${key} falls back`);
    }
    assert.equal((tree.children["j"] as TreeLeaf).otherwise?.steps[0]?.invocation.id, default_j);
  }
  for (const url of ["https://www.google.com/search?q=maps", "https://www.google.de/maps", "https://maps.example.org/maps"]) {
    const node: TreeNode | undefined = (await page_tree(with_defaults({}), url)).children["j"];
    assert.equal(node?.kind === "leaf" && node.steps[0]?.invocation.id, default_j, url);
  }
});

test("default_site_rows_off = maps gives Maps the plain keys and leaves the sheets rows on", async () => {
  const node = (await page_tree(with_defaults({ default_site_rows_off: ["maps"] }), MAPS)).children["j"] as TreeLeaf;
  assert.equal(node.when_focus, undefined);
  assert.equal(node.steps[0]?.invocation.id, (DEFAULT_KEYMAP.normal!["j"] as { id: string }).id);
  const sheets = (await page_tree(with_defaults({ default_site_rows_off: ["maps"] }), "https://docs.google.com/spreadsheets/d/abc/edit")).children["j"] as TreeLeaf;
  assert.equal(sheets.steps[0]?.invocation.id, "page.send_key");
});

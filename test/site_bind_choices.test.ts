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
import { site_rules_view } from "../src/background/site_rules_view.ts";
import { leaf_for_page } from "../src/content/run_leaf.ts";
import { ConfigErrors } from "../src/shared/config_build/errors.ts";
import { compile_keymap } from "../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeLeaf } from "../src/shared/prefix_tree.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { build_commands_file } from "../src/shared/registry/index.ts";
import { SETTING_SPECS } from "../src/shared/settings_schema.ts";
import { MAX_BIND_CHOICES } from "../src/shared/table_constants.ts";
import { build_config } from "../tools/build-config/build_config.ts";
import { make_tmp_dir } from "./support/tmp_dir.ts";

const GRID = "ul.grid";
const LIST = "table.list";
const PANEL = "#panel";

// A stand-in document. `shown` and `hidden` name the selectors that find a visible or a hidden match. A selector in `bad` throws as a parse error does.
function page_root({ shown = [] as string[], hidden = [] as string[], bad = [] as string[] } = {}): ParentNode {
  const match = (visible: boolean) => ({ checkVisibility: () => visible, getClientRects: () => (visible ? [{}] : []) });
  return {
    querySelectorAll: (selector: string) => {
      if (bad.includes(selector)) throw new SyntaxError("bad selector");
      return [...(hidden.includes(selector) ? [match(false)] : []), ...(shown.includes(selector) ? [match(true)] : [])];
    },
  } as unknown as ParentNode;
}
const element = (matching: string | undefined): Element => ({ closest: (selector: string) => (selector === matching ? element(matching) : null) }) as unknown as Element;
const body = element(undefined);
const leaf = (id: string, extra: Partial<TreeLeaf> = {}): TreeLeaf => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "content", count_rule: "ignore" }], ...extra });
const id_of = (chosen: TreeLeaf | undefined) => chosen?.steps[0]?.invocation.id;

// grid choice, then list choice, then the replaced key.
const chain = () => leaf("grid", { when_present: GRID, otherwise: leaf("list", { when_present: LIST, otherwise: leaf("plain") }) });

test("the first choice whose guard holds runs, in list order", () => {
  assert.equal(id_of(leaf_for_page(chain(), null, body, page_root({ shown: [GRID, LIST] }))), "grid");
  assert.equal(id_of(leaf_for_page(chain(), null, body, page_root({ shown: [LIST] }))), "list");
});

test("with no choice's guard holding, the key runs the leaf the bind replaced, or nothing when it replaced none", () => {
  assert.equal(id_of(leaf_for_page(chain(), null, body, page_root())), "plain");
  assert.equal(leaf_for_page(leaf("grid", { when_present: GRID }), null, body, page_root()), undefined);
});

test("when_present counts only a shown match: a hidden one falls through", () => {
  assert.equal(id_of(leaf_for_page(chain(), null, body, page_root({ hidden: [GRID], shown: [LIST] }))), "list");
  assert.equal(id_of(leaf_for_page(chain(), null, body, page_root({ hidden: [GRID, LIST] }))), "plain");
});

test("a when_present selector that does not parse matches nothing, so the key falls through", () => {
  assert.equal(id_of(leaf_for_page(chain(), null, body, page_root({ bad: [GRID], shown: [LIST] }))), "list");
});

test("a choice with when_focus and when_present runs only while both hold", () => {
  const both = leaf("both", { when_present: GRID, when_focus: PANEL, otherwise: leaf("plain") });
  assert.equal(id_of(leaf_for_page(both, element(PANEL), body, page_root({ shown: [GRID] }))), "both");
  assert.equal(id_of(leaf_for_page(both, body, body, page_root({ shown: [GRID] }))), "both", "body counts as no focus");
  assert.equal(id_of(leaf_for_page(both, element("#other"), body, page_root({ shown: [GRID] }))), "plain", "focus elsewhere");
  assert.equal(id_of(leaf_for_page(both, element(PANEL), body, page_root())), "plain", "nothing shown");
});

// A config dir holding one site row with the given `bind` table text.
function build_with_bind(bind: string) {
  const dir = make_tmp_dir("desertfox-choices-");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.toml"), `[[site_rules]]\nsite = "https://a.test/*"\nbind = { ${bind} }\n`);
  return build_config(dir, build_commands_file(registry).commands);
}
const problems_of = (bind: string): string => {
  try {
    build_with_bind(bind);
  } catch (error) {
    if (error instanceof ConfigErrors) return error.problems.join("\n");
    throw error;
  }
  return "";
};
const H_CHOICES = `h = [{ run = "page.item --direction=left li.tile", when_present = "${GRID}", label = "Tile left" }, { run = ["page.back", "tab.next"], when_present = "${LIST}" }]`;

test("the build stores a choice list as one step list per choice, with the guards and label on its first step", () => {
  const bind = (build_with_bind(H_CHOICES).settings.site_rules?.[0] as { bind: Record<string, unknown> }).bind;
  assert.deepEqual(bind.h, [
    [{ id: "page.item", args: { direction: "left", selector: "li.tile" }, when_present: GRID, label: "Tile left" }],
    [{ id: "page.back", when_present: LIST }, { id: "tab.next" }],
  ]);
  assert.equal(SETTING_SPECS.site_rules.check([{ site: "https://a.test/*", bind }]), true, "the stored form passes the settings check");
});

test("a choice list states what is wrong with it", () => {
  assert.match(problems_of(`h = [{ run = "page.back" }, { run = "tab.next", when_present = "${LIST}" }]`), /binds "h" in choice 1 with no "when_present" or "when_focus", so the choices after it never run/);
  assert.match(problems_of(`h = [{ run = "page.back", when_present = 3 }]`), /binds "h" in choice 1 with a "label", "intent", "when_focus" or "when_present" that is not text/);
  assert.match(problems_of(`h = [{ run = "page.back", when_shown = "${GRID}" }]`), /binds "h" in choice 1 with the unknown field "when_shown"/);
  assert.match(problems_of(`h = [{ run = "page.back", when_present = "${GRID}" }, "tab.next"]`), /binds "h" to something that mixes choices/);
  assert.match(problems_of(`h = [{ run = "page.back", when_present = "${GRID}" }, { run = "no.such.command" }]`), /bind "h" of "https:\/\/a.test\/\*", choice 2: /);
  const many = Array.from({ length: MAX_BIND_CHOICES + 1 }, () => `{ run = "page.back", when_present = "${GRID}" }`).join(", ");
  assert.match(problems_of(`h = [${many}]`), new RegExp(`binds "h" to more than ${MAX_BIND_CHOICES} choices`));
  assert.equal(problems_of(`h = [{ run = "page.back", when_present = "${GRID}" }, { run = "tab.next" }]`), "", "the last choice needs no guard");
  assert.match(problems_of(`h = [{ id = "page.back", when_present = "${GRID}" }, { id = "tab.next", when_present = "${LIST}" }]`), /binds "h" to something that has "when_present" on step 2, but only the first step can carry a guard/);
  assert.match(problems_of(`h = { run = ["page.back", { id = "tab.next", when_focus = "${PANEL}" }] }`), /has "when_focus" on step 2/);
  assert.equal(SETTING_SPECS.site_rules.check([{ site: "https://a.test/*", bind: { h: [[[{ id: "page.back", when_present: GRID }]]] } }]), false, "a choice cannot be a list of choices");
});

test("a keymap file refuses a choice list, and a keymap entry with when_present is skipped with a warning", () => {
  const dir = make_tmp_dir("desertfox-choices-");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "keymap.toml"), `[normal]\nh = [{ run = "page.back", when_present = "${GRID}" }]\n`);
  assert.throws(() => build_config(dir, build_commands_file(registry).commands), (error: unknown) => error instanceof ConfigErrors && /keymap.normal\["h"\] must be a command string/.test(error.problems.join("\n")));
  const resolve = () => ({ runs_in: "content" as const, label: "x", count: "ignore" as const });
  const { compiled, warnings } = compile_keymap({ normal: { j: { id: "a.j", when_present: GRID } } }, {}, resolve);
  assert.equal(compiled.modes.normal?.children["j"], undefined);
  assert.match(warnings.join("\n"), /"j": when_present works only in a site row bind/);
});

const storage_of = (stored: unknown) => ({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: stored }) }) as never;
const page_tree = async (compiled: CompiledKeymap, url: string) => (await page_keymap_for(storage_of(compiled), [url]))!.keymap.modes.normal!;
function compiled_with(settings: Record<string, unknown>) {
  const { compiled, warnings } = compile_config({ config: { ...empty_config(), settings: settings as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  assert.deepEqual(warnings, []);
  return compiled;
}
const stored_choices = (last_guarded: boolean) => [[{ id: "page.item", args: { selector: "li.tile", direction: "left" }, when_present: GRID }], [{ id: "page.back", ...(last_guarded ? { when_present: LIST } : {}) }]];

test("the page tree chains the choices and puts the replaced key after a guarded last choice", async () => {
  const default_h = (DEFAULT_KEYMAP.normal!["h"] as { id: string }).id;
  const h = (await page_tree(compiled_with({ site_rules: [{ site: "https://a.test/*", bind: { h: stored_choices(true) } }] }), "https://a.test/")).children["h"] as TreeLeaf;
  assert.deepEqual([h.when_present, h.otherwise?.when_present, id_of(h.otherwise?.otherwise), h.otherwise?.otherwise?.otherwise], [GRID, LIST, default_h, undefined]);
  assert.equal(id_of(leaf_for_page(h, null, body, page_root())), default_h);
  const open = (await page_tree(compiled_with({ site_rules: [{ site: "https://a.test/*", bind: { h: stored_choices(false) } }] }), "https://a.test/")).children["h"] as TreeLeaf;
  assert.equal(open.otherwise?.otherwise, undefined, "an unguarded last choice ends the chain");
  assert.equal(id_of(leaf_for_page(open, null, body, page_root())), "page.back");
});

test("otherwise = \"page\" keeps the replaced key off the chain, so a failed guard leaves the key to the page", async () => {
  const guarded = (extra: object) => [{ id: "page.back", when_present: GRID, ...extra }];
  const tree_for = async (bind: object) => (await page_tree(compiled_with({ site_rules: [{ site: "https://a.test/*", bind }] }), "https://a.test/")).children["h"] as TreeLeaf;
  const kept = await tree_for({ h: guarded({}) });
  assert.equal(id_of(leaf_for_page(kept, null, body, page_root())), (DEFAULT_KEYMAP.normal!["h"] as { id: string }).id, "without the field the replaced key runs");
  const page = await tree_for({ h: guarded({ otherwise: "page" }) });
  assert.equal(page.otherwise, undefined);
  assert.equal(leaf_for_page(page, null, body, page_root()), undefined, "no leaf runs, so content.js passes the key");
  assert.equal(id_of(leaf_for_page(page, null, body, page_root({ shown: [GRID] }))), "page.back", "the guard still runs the bind");
  assert.deepEqual(page.steps[0]?.invocation, { id: "page.back", args: {} }, "the field is not an argument of the step");
});

test("the site rules view says a failed otherwise = page bind passes the key to the page", () => {
  const action = (extra: object) => {
    const [row] = site_rules_view(compiled_with({ site_rules: [{ site: "https://a.test/*", bind: { h: [{ id: "page.back", when_present: GRID, ...extra }] } }] }), "https://a.test/").rows;
    return row!.changes.find(({ keys }) => keys === "h")!.action;
  };
  assert.match(action({ otherwise: "page" }), /, else the key goes to the page$/);
  assert.match(action({}), /, else the key without the row$/);
  const later = site_rules_view(compiled_with({ site_rules: [{ site: "https://a.test/*", bind: { h: [[{ id: "page.back", when_present: GRID }], [{ id: "tab.next", when_present: LIST, otherwise: "page" }]] } }] }), "https://a.test/").rows[0]!;
  assert.match(later.changes.find(({ keys }) => keys === "h")!.action, /, else the key goes to the page$/, "the flag on a later choice counts");
});

test("the build stores otherwise on the first step, and refuses a value other than page", () => {
  const bind = (build_with_bind(`h = { run = "page.back", when_present = "${GRID}", otherwise = "page" }`).settings.site_rules?.[0] as { bind: Record<string, unknown> }).bind;
  assert.deepEqual(bind.h, { id: "page.back", when_present: GRID, otherwise: "page" });
  assert.equal(SETTING_SPECS.site_rules.check([{ site: "https://a.test/*", bind }]), true);
  assert.match(problems_of(`h = { run = "page.back", when_present = "${GRID}", otherwise = "next" }`), /otherwise/);
});

test("the site rules view lists each choice with its guard, and a guarded bind stays live", () => {
  const [user] = site_rules_view(compiled_with({ site_rules: [{ site: "https://a.test/*", bind: { h: stored_choices(true) } }] }), "https://a.test/").rows;
  const h = user!.changes.find(({ keys }) => keys === "h")!;
  assert.equal(h.dead, undefined);
  assert.equal(h.action, `Move through items to item on the left while the page shows ${GRID}, else Back while the page shows ${LIST}, else the key without the row`);
  const [open] = site_rules_view(compiled_with({ site_rules: [{ site: "https://a.test/*", bind: { h: stored_choices(false) } }] }), "https://a.test/").rows;
  assert.match(open!.changes.find(({ keys }) => keys === "h")!.action, /, else Back$/);
});

test("the compile checks every choice: a later choice gets its defaults and jump flag, and a bad one drops the bind", async () => {
  const gg = [[{ id: "page.item", args: { selector: "li.tile", direction: "first" }, when_present: GRID }], [{ id: "page.item", args: { selector: "tr.row", direction: "last" }, when_present: LIST }]];
  const tree = await page_tree(compiled_with({ site_rules: [{ site: "https://a.test/*", bind: { G: gg } }] }), "https://a.test/");
  const second = (tree.children["G"] as TreeLeaf).otherwise!.steps[0]!;
  assert.deepEqual([second.invocation.args?.times, second.jump], [1, true]);
  const bad = [[{ id: "tab.next", when_present: GRID }], [{ id: "page.item", args: { selector: "tr.row", direction: "sideways" } }]];
  const { warnings } = compile_config({ config: { ...empty_config(), settings: { site_rules: [{ site: "https://a.test/*", bind: { G: bad } }] } as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  assert.match(warnings.join("\n"), /skipped bind "G" of "https:\/\/a.test\/\*": direction expects one of/);
});

test("a user choice list whose guards all fail falls back to the keymap binding, not to the shipped row's bind", async () => {
  const default_j = (DEFAULT_KEYMAP.normal!["j"] as { id: string }).id;
  const google = "https://www.google.com/search?q=cats";
  const user_j = [[{ id: "tab.next", when_present: GRID }], [{ id: "tab.prev", when_present: LIST }]];
  const j = (await page_tree(compiled_with({ site_rules: [{ site: "https://www.google.com/*", bind: { j: user_j } }] }), google)).children["j"] as TreeLeaf;
  assert.deepEqual([id_of(j), id_of(j.otherwise), id_of(j.otherwise?.otherwise)], ["tab.next", "tab.prev", default_j]);
  assert.equal(id_of(leaf_for_page(j, null, body, page_root())), default_j);
  assert.notEqual(default_j, "page.item");
});

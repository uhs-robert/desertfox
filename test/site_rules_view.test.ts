import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import "../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { site_rules_view } from "../src/background/site_rules_view.ts";
import { registry } from "../src/shared/registry/builtin.ts";

const SHEETS = "https://docs.google.com/spreadsheets/d/abc/edit";
const STOP = { id: "page.stop" };
const RELOAD = { id: "page.reload" };

function compiled_with(settings: Record<string, unknown>) {
  const { compiled, warnings } = compile_config({ config: { ...empty_config(), settings: settings as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  assert.deepEqual(warnings, []);
  return compiled;
}

test("rows come in table order, the user's first, each with its origin and pattern", () => {
  const view = site_rules_view(compiled_with({ site_rules: [{ site: "https://docs.google.com/*", bind: { q: STOP } }, { site: "https://other.test/*", off: true }] }), SHEETS);
  assert.deepEqual(view.rows.map(({ origin, name, site }) => ({ origin, name, site })), [
    { origin: "user", name: undefined, site: "https://docs.google.com/*" },
    { origin: "default", name: "sheets", site: "https://docs.google.com/spreadsheets/*" },
  ]);
});

test("a page no row fits gives an empty list, with or without a keymap", () => {
  assert.deepEqual(site_rules_view(compiled_with({}), "https://example.test/").rows, []);
  assert.deepEqual(site_rules_view(undefined, SHEETS).rows, []);
});

test("a user bind shadows the default bind of the same key, and a bind it does not touch stays live", () => {
  const view = site_rules_view(compiled_with({ site_rules: [{ site: "https://docs.google.com/*", bind: { h: STOP } }] }), SHEETS);
  const [user, shipped] = view.rows;
  assert.deepEqual(user!.changes.map(({ keys, shadowed }) => [keys, shadowed]), [["h", false]]);
  const by_key = Object.fromEntries(shipped!.changes.filter(({ mode }) => mode === undefined).map((change) => [change.keys, change.shadowed]));
  assert.equal(by_key.h, true);
  assert.equal(by_key.j, false);
});

test("a bind names what the key does without the row", () => {
  const [user] = site_rules_view(compiled_with({ site_rules: [{ site: "https://a.test/*", bind: { j: STOP, "<C-q>": RELOAD } }] }), "https://a.test/").rows;
  const j = user!.changes.find(({ keys }) => keys === "j")!;
  assert.match(j.replaces ?? "", /./);
  assert.equal(user!.changes.find(({ keys }) => keys === "<C-q>")!.replaces, undefined);
});

test("default_site_rows_off drops the shipped rows by name", () => {
  const view = site_rules_view(compiled_with({ default_site_rows_off: ["sheets"], site_rules: [{ site: "https://docs.google.com/*", bind: { q: STOP } }] }), SHEETS);
  assert.deepEqual(view.rows.map(({ origin }) => origin), ["user"]);
});

test("the first row that sets the key rule decides it, and a later one is shadowed", () => {
  const [user, shipped] = site_rules_view(compiled_with({ site_rules: [{ site: "https://docs.google.com/*", pass: "j" }] }), SHEETS).rows;
  assert.deepEqual(user!.columns.filter(({ name }) => name === "pass"), [{ name: "pass", value: "j", shadowed: false }]);
  assert.deepEqual(user!.changes, [{ keys: "j", action: "goes to the page", replaces: user!.changes[0]!.replaces, shadowed: false }]);
  assert.equal(shipped!.columns.find(({ name }) => name === "pass")!.shadowed, true);
  assert.equal(shipped!.changes.filter(({ action }) => action === "goes to the page").every(({ shadowed }) => shadowed), true);
});

test("only lists the keys it keeps, and a pass row after it is shadowed", () => {
  const [first, second] = site_rules_view(compiled_with({ default_site_rows_off: ["sheets"], site_rules: [{ site: "https://a.test/*", only: "j k" }, { site: "https://a.test/*", pass: "x" }] }), "https://a.test/").rows;
  assert.deepEqual(first!.changes.map(({ keys, action, shadowed }) => [keys, action, shadowed]), [["j", "stays a DesertFox key", false], ["k", "stays a DesertFox key", false]]);
  assert.equal(second!.columns[0]!.shadowed, true);
});

test("off is a column, and a later off is shadowed by an earlier one", () => {
  const [first, second] = site_rules_view(compiled_with({ default_site_rows_off: ["sheets"], site_rules: [{ site: "https://a.test/*", off: false }, { site: "https://a.test/*", off: true }] }), "https://a.test/").rows;
  assert.deepEqual(first!.columns, [{ name: "off", value: "false", shadowed: false }]);
  assert.deepEqual(second!.columns, [{ name: "off", value: "true", shadowed: true }]);
});

test("a site mode lists its binds under the mode name, shadowed by an earlier row of the same mode", () => {
  const view = site_rules_view(compiled_with({ site_rules: [{ site: "https://docs.google.com/*", modes: { visual: { label: "MINE", bind: { q: STOP } } } }] }), SHEETS);
  const [user, shipped] = view.rows;
  assert.deepEqual(user!.columns, [{ name: "mode visual", value: "MINE", shadowed: false }]);
  assert.deepEqual(user!.changes.map(({ keys, mode, shadowed }) => [keys, mode, shadowed]), [["q", "visual", false]]);
  assert.equal(shipped!.columns.find(({ name }) => name === "mode visual")!.shadowed, true);
  assert.equal(shipped!.changes.filter(({ mode }) => mode === "visual").every(({ shadowed }) => shadowed), true);
});

test("a per-site setting shows as a name and value column, shadowed when an earlier row sets it", () => {
  const [user, shipped] = site_rules_view(compiled_with({ site_rules: [{ site: "https://docs.google.com/*", escape_to_page: false, hint_add: [".a", ".b"] }] }), SHEETS).rows;
  assert.deepEqual(user!.columns, [{ name: "escape_to_page", value: "false", shadowed: false }, { name: "hint_add", value: ".a, .b", shadowed: false }]);
  assert.equal(shipped!.columns.find(({ name }) => name === "escape_to_page")!.shadowed, true);
});

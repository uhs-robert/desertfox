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

function compiled_with(settings: Record<string, unknown>, expected_warnings: string[] = []) {
  const { compiled, warnings } = compile_config({ config: { ...empty_config(), settings: settings as never }, default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} });
  assert.deepEqual(warnings, expected_warnings);
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
  assert.deepEqual(user!.changes.map(({ keys, dead }) => [keys, dead]), [["h", undefined]]);
  const by_key = Object.fromEntries(shipped!.changes.filter(({ mode }) => mode === undefined).map((change) => [change.keys, change.dead]));
  assert.equal(by_key.h, "an earlier row decides it");
  assert.equal(by_key.j, undefined);
});

test("a bind names what the key does without the row", () => {
  const [user] = site_rules_view(compiled_with({ site_rules: [{ site: "https://a.test/*", bind: { j: STOP, "<C-q>": RELOAD } }] }), "https://a.test/").rows;
  const j = user!.changes.find(({ keys }) => keys === "j")!;
  assert.equal(j.replaces, "Scroll down");
  assert.equal(user!.changes.find(({ keys }) => keys === "j")!.action, "Stop loading");
  assert.equal(user!.changes.find(({ keys }) => keys === "<C-q>")!.replaces, undefined);
});

test("default_site_rows_off drops the shipped rows by name", () => {
  const view = site_rules_view(compiled_with({ default_site_rows_off: ["sheets"], site_rules: [{ site: "https://docs.google.com/*", bind: { q: STOP } }] }), SHEETS);
  assert.deepEqual(view.rows.map(({ origin }) => origin), ["user"]);
});

test("the first row that sets the key rule decides it, and a later one is shadowed", () => {
  const [user, shipped] = site_rules_view(compiled_with({ site_rules: [{ site: "https://docs.google.com/*", pass: "j" }] }), SHEETS).rows;
  assert.deepEqual(user!.columns.filter(({ name }) => name === "pass"), [{ name: "pass", value: "j", shadowed: false }]);
  assert.deepEqual(user!.changes, [{ keys: "j", action: "goes to the page", replaces: "Scroll down" }]);
  assert.equal(shipped!.columns.find(({ name }) => name === "pass")!.shadowed, true);
  assert.equal(shipped!.changes.filter(({ action }) => action === "goes to the page").every(({ dead }) => dead === "an earlier row decides it"), true);
});

test("only lists the keys it keeps, and a pass row after it is shadowed", () => {
  const [first, second] = site_rules_view(compiled_with({ default_site_rows_off: ["sheets"], site_rules: [{ site: "https://a.test/*", only: "j k" }, { site: "https://a.test/*", pass: "x" }] }), "https://a.test/").rows;
  assert.deepEqual(first!.changes, [{ keys: "j", action: "stays a DesertFox key" }, { keys: "k", action: "stays a DesertFox key" }]);
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
  assert.deepEqual(user!.changes.map(({ keys, mode, dead }) => [keys, mode, dead]), [["q", "visual", undefined]]);
  assert.equal(shipped!.columns.find(({ name }) => name === "mode visual")!.shadowed, true);
  assert.equal(shipped!.changes.filter(({ mode }) => mode === "visual").every(({ dead }) => dead === "an earlier row decides it"), true);
});

test("a per-site setting shows as a name and value column, shadowed when an earlier row sets it", () => {
  const [user, shipped] = site_rules_view(compiled_with({ site_rules: [{ site: "https://docs.google.com/*", escape_to_page: false, hint_add: [".a", ".b"] }] }), SHEETS).rows;
  assert.deepEqual(user!.columns, [{ name: "escape_to_page", value: "false", shadowed: false }, { name: "hint_add", value: ".a, .b", shadowed: false }]);
  assert.equal(shipped!.columns.find(({ name }) => name === "escape_to_page")!.shadowed, true);
});

const dead_of = (rows: ReturnType<typeof site_rules_view>["rows"], row: number, keys: string, mode?: string) => rows[row]!.changes.find((change) => change.keys === keys && change.mode === mode)!.dead;

test("a decided off kills every key change of the other rows", () => {
  const { rows } = site_rules_view(compiled_with({ site_rules: [{ site: "https://docs.google.com/*", off: true }] }), SHEETS);
  assert.equal(dead_of(rows, 1, "j"), "off for this page");
  assert.equal(dead_of(rows, 1, "<C-a>"), "off for this page");
  assert.equal(dead_of(rows, 1, "h", "visual"), "off for this page");
});

test("pass frees a key another row binds", () => {
  const { rows } = site_rules_view(compiled_with({ default_site_rows_off: ["sheets"], site_rules: [{ site: "https://a.test/*", pass: "j" }, { site: "https://a.test/*", bind: { j: STOP, q: STOP } }] }), "https://a.test/");
  assert.equal(dead_of(rows, 1, "j"), "freed by pass");
  assert.equal(dead_of(rows, 1, "q"), undefined);
});

test("only drops a bind it does not list and keeps one it lists", () => {
  const { rows } = site_rules_view(compiled_with({ default_site_rows_off: ["sheets"], site_rules: [{ site: "https://a.test/*", only: "k q" }, { site: "https://a.test/*", bind: { j: STOP, q: STOP } }] }), "https://a.test/");
  assert.equal(dead_of(rows, 1, "j"), "dropped by only");
  assert.equal(dead_of(rows, 1, "q"), undefined);
});

test("an earlier complete bind of g hides a later row's gx", () => {
  const { rows } = site_rules_view(compiled_with({ default_site_rows_off: ["sheets"], site_rules: [{ site: "https://a.test/*", bind: { g: STOP } }, { site: "https://a.test/*", bind: { gx: RELOAD } }] }, ['site_rules: skipped bind "gx": "g" is already a complete bind for the same site']), "https://a.test/");
  assert.equal(dead_of(rows, 0, "g"), undefined);
  assert.equal(dead_of(rows, 1, "gx"), "g is a complete bind and hides longer keys under it");
});

test("a longer bind under a single-key binding names the binding it takes away", () => {
  const { rows } = site_rules_view(compiled_with({ default_site_rows_off: ["sheets"], site_rules: [{ site: "https://a.test/*", bind: { hq: STOP } }] }), "https://a.test/");
  assert.equal(rows[0]!.changes[0]!.replaces, "Scroll left");
});

test("a mode bind hidden by a shorter bind of the same mode is not live", () => {
  const modes = { m: { label: "M", bind: { g: STOP, gq: RELOAD } } };
  const { rows } = site_rules_view(compiled_with({ default_site_rows_off: ["sheets"], site_rules: [{ site: "https://a.test/*", modes }] }, ['site_rules: skipped bind "gq": "g" is already a complete bind for the same site']), "https://a.test/");
  assert.equal(dead_of(rows, 0, "g", "m"), undefined);
  assert.equal(dead_of(rows, 0, "gq", "m"), "g is a complete bind and hides longer keys under it");
});

test("a mode bind replaces what the page tree holds, so a freed key replaces nothing", () => {
  const modes = { m: { label: "M", bind: { j: STOP, k: STOP } } };
  const { rows } = site_rules_view(compiled_with({ default_site_rows_off: ["sheets"], site_rules: [{ site: "https://a.test/*", pass: "j", modes }] }), "https://a.test/");
  const change = (keys: string) => rows[0]!.changes.find((each) => each.keys === keys && each.mode === "m")!;
  assert.equal(change("j").replaces, undefined);
  assert.equal(change("k").replaces, "Scroll up");
});

test("the editable and scroll target columns show through the generic path", () => {
  const [row] = site_rules_view(compiled_with({ default_site_rows_off: ["sheets"], site_rules: [{ site: "https://a.test/*", editable_add: [".ed"], editable_remove: [".no"], editable_remove_unsized: true, scroll_selector: ".pane" }] }), "https://a.test/").rows;
  assert.deepEqual(row!.columns.map(({ name, value }) => [name, value]), [["editable_add", ".ed"], ["editable_remove", ".no"], ["editable_remove_unsized", "true"], ["scroll_selector", ".pane"]]);
});

test("a strip_tracking row shows as a column, and an earlier row shadows a later one", () => {
  const view = site_rules_view(compiled_with({ site_rules: [{ site: "https://a.test/*", strip_tracking: false }, { site: "https://a.test/*", strip_tracking: true }, { site: "https://b.test/*", strip_tracking: true }] }), "https://a.test/");
  assert.deepEqual(view.rows.map((row) => row.columns.filter(({ name }) => name === "strip_tracking")), [[{ name: "strip_tracking", value: "false", shadowed: false }], [{ name: "strip_tracking", value: "true", shadowed: true }]]);
  assert.deepEqual(site_rules_view(compiled_with({ strip_tracking: false, site_rules: [{ site: "https://b.test/*", strip_tracking: true }] }), "https://b.test/").rows[0]!.columns, [{ name: "strip_tracking", value: "true", shadowed: false }]);
});

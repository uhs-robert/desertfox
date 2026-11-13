import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../src/shared/config.ts";
import { is_setting_name, parse_setting_words, PER_SITE_SETTING_NAMES, SETTING_NAMES, SETTING_SPECS, table_list_rule } from "../src/shared/settings_schema.ts";
import { SETTINGS_TABLE, type SettingRow } from "../src/shared/settings_table.ts";
import { settings_schema } from "../src/shared/config_build/schemas.ts";

test("the editor schema names exactly the settings the checks know", () => {
  const properties = Object.keys((settings_schema().properties as Record<string, unknown>)).sort();
  assert.deepEqual(properties, [...SETTING_NAMES].sort());
});

test("every default passes its own check", () => {
  for (const [name, value] of Object.entries(DEFAULT_SETTINGS)) assert.equal(SETTING_SPECS[name as keyof typeof SETTING_SPECS].check(value), true, name);
});

test("unknown names are not settings", () => {
  assert.equal(is_setting_name("nope"), false);
  assert.equal(is_setting_name("toString"), false);
});

test("a typed value takes the type its setting accepts", () => {
  assert.deepEqual(parse_setting_words("which_key_delay_ms", ["500"]), { value: 500 });
  assert.deepEqual(parse_setting_words("light_intensity", ["4"]), { value: 4 });
  assert.deepEqual(parse_setting_words("newtab_clock_format", ["24"]), { value: 24 });
  assert.deepEqual(parse_setting_words("hint_letters", ["1234"]), { value: "1234" });
  assert.deepEqual(parse_setting_words("newtab_date", ["false"]), { value: false });
  assert.deepEqual(parse_setting_words("newtab_clock", ["true"]), { value: true });
  assert.deepEqual(parse_setting_words("newtab_clock", ["digital"]), { value: "digital" });
  assert.deepEqual(parse_setting_words("cmdline_prompt", ["true"]), { value: "true" });
  assert.deepEqual(parse_setting_words("cmdline_prompt", ["> "]), { value: "> " });
});

test("a list takes one item per word", () => {
  assert.deepEqual(parse_setting_words("next_patterns", ["a.com", "b.com"]), { value: ["a.com", "b.com"] });
  assert.deepEqual(parse_setting_words("open_completion", ["history"]), { value: ["history"] });
});

test("a bad value gives the check text", () => {
  assert.deepEqual(parse_setting_words("light_intensity", ["9"]), { error: "light_intensity: expected a whole number from 1 to 5" });
  assert.deepEqual(parse_setting_words("which_key_delay_ms", ["-1"]), { error: "which_key_delay_ms: expected a number of milliseconds, 0 or more" });
  assert.ok("error" in parse_setting_words("open_completion", ["bookmarks", "bookmarks"]));
});

test("listed values pass their own check", () => {
  for (const name of SETTING_NAMES) {
    for (const value of SETTING_SPECS[name].listed_values?.() ?? []) {
      const parsed = parse_setting_words(name, [value]);
      assert.ok("value" in parsed, `${name} ${value}`);
    }
  }
});

// No setting opts in yet, so the site table's rule is built here with a stand-in column: what a real `per_site` row gets.
test("a site table checks each per-site column with that setting's own check", () => {
  const { fields, exclusive } = SETTINGS_TABLE.site_rules;
  const rule = table_list_rule(fields, exclusive, { which_key_delay_ms: SETTING_SPECS.which_key_delay_ms });
  assert.equal(rule.check([{ site: "*://a.test/*", which_key_delay_ms: 50 }]), true);
  assert.equal(rule.check([{ site: "*://a.test/*", which_key_delay_ms: 50, off: false, pass: "j" }]), true);
  assert.equal(rule.explain!([{ site: "*://a.test/*", which_key_delay_ms: -1 }]), `item 1 has a field "which_key_delay_ms" that is not ${SETTING_SPECS.which_key_delay_ms.expectation}`);
  assert.equal(rule.explain!([{ site: "*://a.test/*", hint_letters: "ab" }]), 'item 1 has the unknown field "hint_letters"');
  assert.match(rule.expectation, /and any per-site setting$/);
});

test("no per-site setting shares a name with a site table field, and none is a table", () => {
  for (const name of PER_SITE_SETTING_NAMES) {
    assert.equal(Object.hasOwn(SETTINGS_TABLE.site_rules.fields, name), false, name);
    assert.notEqual((SETTINGS_TABLE[name] as SettingRow).kind, "site_table", name);
  }
});

test("every setting has a long description, a plain label and a one-line summary", async () => {
  const { SETTING_DOCS, SETTING_HELP } = await import("../src/shared/settings_docs.ts");
  for (const name of SETTING_NAMES) {
    assert.notEqual(SETTING_DOCS[name]?.trim() ?? "", "", `${name} has no long description`);
    assert.notEqual(SETTING_HELP[name]?.label.trim() ?? "", "", `${name} has no label`);
    assert.notEqual(SETTING_HELP[name]?.summary.trim() ?? "", "", `${name} has no summary`);
  }
});

test("the engine form calls the keyword a search word in its messages", async () => {
  const { field_problems } = await import("../src/shared/engine_fields.ts");
  const problems = field_problems({ name: "a", url: "https://x/{query}", keyword: "TOO LONG!" });
  assert.deepEqual(problems, ["The search word is one to eight lower case letters or digits."]);
});

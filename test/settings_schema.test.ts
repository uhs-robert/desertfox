import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../src/shared/config.ts";
import { is_setting_name, parse_setting_words, SETTING_NAMES, SETTING_SPECS, setting_is_valid } from "../src/shared/settings_schema.ts";
import { settings_schema } from "../tools/build-config/schemas.ts";

test("the editor schema names exactly the settings the checks know", () => {
  const properties = Object.keys((settings_schema().properties as Record<string, unknown>)).sort();
  assert.deepEqual(properties, [...SETTING_NAMES].sort());
});

test("every default passes its own check", () => {
  for (const [name, value] of Object.entries(DEFAULT_SETTINGS)) assert.equal(setting_is_valid(name, value), true, name);
});

test("unknown names are not settings", () => {
  assert.equal(is_setting_name("nope"), false);
  assert.equal(is_setting_name("toString"), false);
  assert.equal(setting_is_valid("nope", 1), false);
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
  assert.deepEqual(parse_setting_words("ignore_sites", ["a.com", "b.com"]), { value: ["a.com", "b.com"] });
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

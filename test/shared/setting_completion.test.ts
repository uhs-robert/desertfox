import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { completion_of, is_setting_name, SETTING_COMPLETION } from "../../src/shared/setting_completion.ts";
import { SETTING_NAMES, SETTING_SPECS } from "../../src/shared/settings_schema.ts";

test("the generated rows match the setting rules, in table order", () => {
  assert.deepEqual(
    SETTING_COMPLETION,
    SETTING_NAMES.map((name) => {
      const spec = SETTING_SPECS[name];
      return { name, settable: spec.settable, is_toggle: spec.is_toggle, is_list: spec.is_list, expectation: spec.expectation, values: spec.listed_values?.() ?? [] };
    }),
  );
});

test("is_setting_name and completion_of agree with the rules", () => {
  for (const name of SETTING_NAMES) {
    assert.ok(is_setting_name(name));
    assert.equal(completion_of(name).name, name);
  }
  assert.ok(!is_setting_name("nope"));
  assert.ok(!is_setting_name("constructor"));
});

// The page bundle must not carry the setting rules, the table or the theme names. A value import of any of them, or of a module that reaches them, puts them back.
const BANNED = /\b(settings_schema|settings_table|theme_names|registry\/index|registry\/check_args)(\.ts)?["']/;
const VALUE_IMPORT = /^import\s+(?!type\b)[^;]*?from\s+["'][^"']+["'];?$/gm;

function sources_under(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources_under(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

test("the command line page and its registry files import no setting rules at runtime", () => {
  const registry = ["check_shape", "command_line", "params", "summary", "usage", "define"].map((name) => `src/shared/registry/${name}.ts`);
  const offenders = [...sources_under("src/cmdline"), ...registry].filter((path) => (readFileSync(path, "utf8").match(VALUE_IMPORT) ?? []).some((line) => BANNED.test(line.replace(/\s+/g, " "))));
  assert.deepEqual(offenders, []);
});

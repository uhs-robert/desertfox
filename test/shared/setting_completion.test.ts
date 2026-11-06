import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
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

// The page bundle must not carry the setting rules, the table, the theme names or the registry definer. Bundling the real entry catches every import path, static or not.
test("the command line page bundle has no setting rules in its inputs", async () => {
  const result = await build({ bundle: true, format: "iife", target: "firefox140", logLevel: "silent", entryPoints: { cmdline_page: "src/cmdline/page.ts" }, write: false, metafile: true, minify: true, outdir: "dist" });
  const offenders = Object.keys(result.metafile.inputs).filter((path) => /settings_schema|settings_table|theme_names|registry\/define/.test(path));
  assert.deepEqual(offenders, []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG_FORMAT_VERSION } from "../../src/shared/config.ts";
import { empty_config, pick_config } from "../../src/background/config_load.ts";

const file = (marker: string) => ({ format_version: CONFIG_FORMAT_VERSION, css: marker });

test("the files config config.reload stored is used", () => {
  const picked = pick_config(file("files"));
  assert.equal(picked.source, "files");
  assert.equal(picked.config.css, "files");
  assert.deepEqual(picked.config.keymap, {});
});
test("no files, or an empty slot, runs on defaults", () => {
  assert.deepEqual(pick_config(undefined), { config: empty_config(), source: "defaults", warnings: [] });
  assert.deepEqual(pick_config({}), { config: empty_config(), source: "defaults", warnings: [] });
});
test("a wrong format version warns and runs on defaults", () => {
  const picked = pick_config({ format_version: 9 });
  assert.equal(picked.source, "defaults");
  assert.equal(picked.warnings.length, 1);
});
test("a version 1 file, written before the open_target rename, is rejected", () => {
  const picked = pick_config({ format_version: 1, css: "old" });
  assert.equal(picked.source, "defaults");
  assert.equal(picked.warnings.length, 1);
});
test("a snippet that cannot be run safely is dropped with a warning", () => {
  const good = { id: "app.ok", label: "Ok", intent: "Does it.", matches: ["https://a.test/*"], code: "1" };
  const no_matches = { ...good, id: "app.none", matches: [] };
  const no_code = { id: "app.nocode", label: "x", intent: "x", matches: ["https://a.test/*"] };
  const picked = pick_config({ format_version: CONFIG_FORMAT_VERSION, snippets: [good, no_matches, no_code, "text"] });
  assert.deepEqual(picked.config.snippets, [good]);
  assert.equal(picked.warnings.length, 3);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG_FORMAT_VERSION } from "../../src/shared/config.ts";
import { empty_config, pick_config } from "../../src/background/config_load.ts";

const file = (marker: string) => ({ format_version: CONFIG_FORMAT_VERSION, css: marker });

test("the files config config.reload stored wins over managed storage", () => {
  const picked = pick_config(file("files"), file("managed"));
  assert.equal(picked.source, "files");
  assert.equal(picked.config.css, "files");
  assert.deepEqual(picked.config.keymap, {});
});
test("managed storage is used until a reload stores the files", () => {
  assert.equal(pick_config(undefined, file("managed")).source, "managed");
  assert.equal(pick_config({}, file("managed")).source, "managed");
});
test("neither runs on defaults", () => {
  assert.deepEqual(pick_config(undefined, undefined), { config: empty_config(), source: "defaults", warnings: [] });
});
test("a wrong format version warns and falls through", () => {
  const picked = pick_config({ format_version: 9 }, file("managed"));
  assert.equal(picked.source, "managed");
  assert.equal(picked.warnings.length, 1);
});
test("a version 1 file, written before the open_target rename, is rejected", () => {
  const picked = pick_config({ format_version: 1, css: "old" }, undefined);
  assert.equal(picked.source, "defaults");
  assert.equal(picked.warnings.length, 1);
});
test("a snippet that cannot be run safely is dropped with a warning", () => {
  const good = { id: "app.ok", label: "Ok", intent: "Does it.", matches: ["https://a.test/*"], code: "1" };
  const no_matches = { ...good, id: "app.none", matches: [] };
  const no_code = { id: "app.nocode", label: "x", intent: "x", matches: ["https://a.test/*"] };
  const picked = pick_config({ format_version: CONFIG_FORMAT_VERSION, snippets: [good, no_matches, no_code, "text"] }, undefined);
  assert.deepEqual(picked.config.snippets, [good]);
  assert.equal(picked.warnings.length, 3);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG_FORMAT_VERSION } from "../../src/shared/config.ts";
import { empty_config, pick_config } from "../../src/background/config_load.ts";

const file = (marker: string) => ({ format_version: CONFIG_FORMAT_VERSION, css: marker });

test("managed wins over imported", () => {
  const picked = pick_config(file("managed"), file("imported"));
  assert.equal(picked.source, "managed");
  assert.equal(picked.config.css, "managed");
  assert.deepEqual(picked.config.keymap, {});
});
test("imported is used without managed", () => {
  assert.equal(pick_config(undefined, file("imported")).source, "imported");
  assert.equal(pick_config({}, file("imported")).source, "imported");
});
test("neither runs on defaults", () => {
  assert.deepEqual(pick_config(undefined, undefined), { config: empty_config(), source: "defaults", warnings: [] });
});
test("a wrong format version warns and falls through", () => {
  const picked = pick_config({ format_version: 9 }, file("imported"));
  assert.equal(picked.source, "imported");
  assert.equal(picked.warnings.length, 1);
});
test("a version 1 file, written before the open_target rename, is rejected", () => {
  const picked = pick_config({ format_version: 1, css: "old" }, undefined);
  assert.equal(picked.source, "defaults");
  assert.equal(picked.warnings.length, 1);
});

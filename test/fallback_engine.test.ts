import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { empty_config, pick_config } from "../src/background/config_load.ts";
import { clipboard_target } from "../src/commands/url_build.ts";
import { CONFIG_FORMAT_VERSION, DEFAULT_SETTINGS, FALLBACK_ENGINE, FALLBACK_ENGINE_NAME, with_fallback_engines } from "../src/shared/config.ts";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";
import { ConfigErrors } from "../tools/build-config/errors.ts";

const commands = read_commands_file(join(import.meta.dirname, "fixtures", "build-config", "commands.json"));

function config_dir_with(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "oasisfox-fallback-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

test("default_engine names the fallback engine", () => {
  assert.equal(DEFAULT_SETTINGS.default_engine, FALLBACK_ENGINE_NAME);
  assert.equal(FALLBACK_ENGINE_NAME, "duck");
});

test("with no config the fallback is the only engine", () => {
  assert.deepEqual(pick_config(undefined, undefined).config.search_engines, { duck: FALLBACK_ENGINE });
  assert.deepEqual(empty_config().search_engines, { duck: FALLBACK_ENGINE });
});

test("a config with engines keeps the fallback beside them", () => {
  const raw = { format_version: CONFIG_FORMAT_VERSION, search_engines: { arch: { url: "https://a.example/?q=%s", label: "Arch" } } };
  const engines = pick_config(raw, undefined).config.search_engines;
  assert.deepEqual(Object.keys(engines).sort(), ["arch", "duck"]);
});

test("a config without a search_engines section still gets the fallback", () => {
  assert.deepEqual(pick_config({ format_version: CONFIG_FORMAT_VERSION, keymap: {} }, undefined).config.search_engines, { duck: FALLBACK_ENGINE });
});

test("a user duck replaces the fallback whole", () => {
  const mine = { url: "https://mine.example/?q=%s", label: "Mine" };
  assert.deepEqual(with_fallback_engines({ duck: mine }), { duck: mine });
});

test("clipboard text searches DuckDuckGo with the default setting and the fallback map", () => {
  const url = clipboard_target("rust lifetimes", DEFAULT_SETTINGS.default_engine, with_fallback_engines({}));
  assert.equal(url, "https://duckduckgo.com/?q=rust%20lifetimes");
});

test("build-config: duck is a known engine without a search_engines.toml", () => {
  const ok = config_dir_with({ "settings.toml": 'default_engine = "duck"', "keymap.toml": '[search_keys]\nd = "duck"' });
  assert.doesNotThrow(() => build_config(ok, commands));
  assert.deepEqual(build_config(ok, commands).search_engines, {});
});

test("build-config: an unknown default_engine still fails", () => {
  const dir = config_dir_with({ "settings.toml": 'default_engine = "ghost"' });
  assert.throws(
    () => build_config(dir, commands),
    (error) => error instanceof ConfigErrors && error.problems.some((problem) => /unknown search engine "ghost"/.test(problem)),
  );
});

import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "smol-toml";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";

const SAMPLE = join(import.meta.dirname, "..", "examples", "engines.toml");
const commands = read_commands_file(join(import.meta.dirname, "fixtures", "build-config", "commands.json"));
const engines = parse(readFileSync(SAMPLE, "utf8")) as Record<string, { url?: unknown; label?: unknown }>;

test("the sample holds 40 engines and none of the four left to personal configs", () => {
  assert.equal(Object.keys(engines).length, 40);
  for (const name of ["1337", "calendar", "drive", "gmail"]) assert.ok(!(name in engines), name);
});

test("every sample engine has a label and an https URL with %s", () => {
  for (const [name, engine] of Object.entries(engines)) {
    assert.ok(typeof engine.label === "string" && engine.label !== "", `${name} label`);
    assert.ok(typeof engine.url === "string" && engine.url.startsWith("https://") && engine.url.includes("%s"), `${name} url`);
  }
});

test("copied as search_engines.toml the sample builds clean", () => {
  const dir = mkdtempSync(join(tmpdir(), "oasisfox-sample-"));
  copyFileSync(SAMPLE, join(dir, "search_engines.toml"));
  assert.equal(Object.keys(build_config(dir, commands).search_engines).length, 40);
});

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const CLI = join(import.meta.dirname, "..", "tools", "build-config", "cli.ts");
const FIXTURES = join(import.meta.dirname, "fixtures", "build-config");

// HOME is a tmp dir so a stray write would show there, not in the real home.
function run_cli(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "desertfox-home-"));
  const config_dir = mkdtempSync(join(tmpdir(), "desertfox-cfg-"));
  const result = spawnSync(
    process.execPath,
    [CLI, config_dir, "--commands", join(FIXTURES, "commands.json"), ...args],
    { env: { ...process.env, HOME: home }, encoding: "utf8" },
  );
  return { result, home, config_dir };
}

test("a bare run lints, exits 0 and writes nothing", () => {
  const { result, home, config_dir } = run_cli([]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(home), []);
  assert.deepEqual(readdirSync(config_dir), []);
});

test("--live and --out are no longer flags", () => {
  for (const args of [["--live"], ["--out", join(tmpdir(), "desertfox-never.json")]]) {
    const { result } = run_cli(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Unknown option '${args[0]}'`));
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  }
});

test("--schemas writes the data schemas and nothing else", () => {
  const schemas_dir = mkdtempSync(join(tmpdir(), "desertfox-schemas-"));
  const { result, home } = run_cli(["--schemas", schemas_dir]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(readdirSync(schemas_dir).every((name) => name.endsWith(".schema.json")));
  assert.deepEqual(readdirSync(home), []);
});

test("an unreadable commands file exits non-zero", () => {
  const { result } = run_cli(["--commands", join(FIXTURES, "missing.json")]);
  assert.notEqual(result.status, 0);
});

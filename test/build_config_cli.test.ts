import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EXTENSION_ID } from "../tools/build-config/output.ts";

const CLI = join(import.meta.dirname, "..", "tools", "build-config", "cli.ts");
const FIXTURES = join(import.meta.dirname, "fixtures", "build-config");

// HOME is a tmp dir so no case can touch the real live config.
function run_cli(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "oasisfox-home-"));
  const config_dir = mkdtempSync(join(tmpdir(), "oasisfox-cfg-"));
  const result = spawnSync(
    process.execPath,
    [CLI, config_dir, "--commands", join(FIXTURES, "commands.json"), ...args],
    { env: { ...process.env, HOME: home }, encoding: "utf8" },
  );
  return { result, home };
}

test("no output flag exits 2 and writes nothing", () => {
  const { result, home } = run_cli([]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--out or --live/);
  assert.deepEqual(readdirSync(home), []);
});

test("--out and --live together exit 2 and write nothing", () => {
  const { result, home } = run_cli(["--live", "--out", join(tmpdir(), "oasisfox-never.json")]);
  assert.equal(result.status, 2);
  assert.deepEqual(readdirSync(home), []);
});

test("--out writes only the given path and its engines file", () => {
  const out_dir = mkdtempSync(join(tmpdir(), "oasisfox-out-"));
  const { result, home } = run_cli(["--out", join(out_dir, "x.json")]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(out_dir).sort(), ["x.engines.jsonl", "x.json"]);
  assert.deepEqual(readdirSync(home), []);
});

test("--live writes the managed storage file under HOME", () => {
  const { result, home } = run_cli(["--live"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(home, ".mozilla", "managed-storage", `${EXTENSION_ID}.json`)));
  assert.deepEqual(readdirSync(home), [".mozilla"]);
});

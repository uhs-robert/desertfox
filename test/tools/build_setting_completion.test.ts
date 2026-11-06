import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../../tools/build_setting_completion.ts", import.meta.url).pathname;
const run = (flag: string, out: string) => spawnSync(process.execPath, ["--no-warnings", script, flag, "--out", out], { encoding: "utf8" });
const scratch = () => join(mkdtempSync(join(tmpdir(), "desertfox-completion-")), "setting_completion.ts");

test("--check counts a missing module as stale and does not create it", () => {
  const out = scratch();
  const result = run("--check", out);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stale/);
  assert.equal(existsSync(out), false);
});

test("--check fails on an edited module and passes after --write", () => {
  const out = scratch();
  assert.equal(run("--write", out).status, 0);
  assert.equal(run("--check", out).status, 0);
  writeFileSync(out, readFileSync(out, "utf8") + "// edited\n");
  assert.equal(run("--check", out).status, 1);
});

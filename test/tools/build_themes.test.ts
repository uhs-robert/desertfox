import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../../tools/build_themes.ts", import.meta.url).pathname;

test("--check counts a missing module as stale and does not create it", () => {
  const out = join(mkdtempSync(join(tmpdir(), "oasisfox-themes-")), "themes.ts");
  const run = spawnSync(process.execPath, ["--no-warnings", script, "--check", "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /stale/);
  assert.equal(existsSync(out), false);
});

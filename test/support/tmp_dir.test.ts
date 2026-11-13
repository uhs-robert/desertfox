import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { make_tmp_dir } from "./tmp_dir.ts";

const helper_url = new URL("./tmp_dir.ts", import.meta.url).href;

// The child test fails on purpose, so it runs in its own process and the parent only checks what it left behind.
const child_source = `
import { test } from "node:test";
import { make_tmp_dir } from ${JSON.stringify(helper_url)};
test("body throws", (t) => {
  process.stderr.write("DIR=" + make_tmp_dir("tmp-dir-test-", t) + "\\n");
  throw new Error("deliberate");
});
`;

test("the directory is removed when the test body throws", (t) => {
  const run = spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", child_source], {
    encoding: "utf8",
    env: { ...process.env, TMPDIR: make_tmp_dir("tmp-dir-parent-", t) },
  });
  assert.notEqual(run.status, 0, "the child test is meant to fail");
  const dir = /DIR=(.+)/.exec(run.stderr)?.[1];
  assert.ok(dir, run.stderr);
  assert.equal(existsSync(dir), false);
});

test("without a test context the directory is removed when the process exits", (t) => {
  const source = `
import { make_tmp_dir } from ${JSON.stringify(helper_url)};
process.stdout.write(make_tmp_dir("tmp-dir-test-"));
`;
  const run = spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", source], {
    encoding: "utf8",
    env: { ...process.env, TMPDIR: make_tmp_dir("tmp-dir-parent-", t) },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(existsSync(run.stdout), false);
});

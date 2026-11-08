import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { make_run_dir, sweep_dead_run_dirs } = await import(join(import.meta.dirname, "session.mjs"));

// Each test sweeps a private folder that stands in for /tmp, so no real run folder is touched.
function with_tmp_root(body: (tmp_root: string) => void) {
  const tmp_root = mkdtempSync(join(tmpdir(), "run-dirs-test-"));
  try {
    body(tmp_root);
  } finally {
    rmSync(tmp_root, { recursive: true, force: true });
  }
}
const left_run_dir = (tmp_root: string, name: string, owner?: string) => {
  const run_dir = join(tmp_root, `desertfox-key-run-${name}`);
  mkdirSync(join(run_dir, "s1"), { recursive: true });
  if (owner !== undefined) writeFileSync(join(run_dir, "owner"), owner);
  return run_dir;
};
// A pid that just exited, so no process holds it unless the kernel reuses it at once.
const dead_pid = () => spawnSync("true").pid;
const own_start_ticks = () => {
  const stat = readFileSync(`/proc/${process.pid}/stat`, "latin1");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
};

test("the sweep keeps the run folder of a live run", () => with_tmp_root((tmp_root) => {
  const run_dir = make_run_dir(tmp_root);
  sweep_dead_run_dirs(tmp_root);
  assert.ok(existsSync(run_dir));
}));

test("the sweep removes the run folder of a run that is gone", () => with_tmp_root((tmp_root) => {
  const run_dir = left_run_dir(tmp_root, "dead", `${dead_pid()} 12345\n`);
  sweep_dead_run_dirs(tmp_root);
  assert.ok(!existsSync(run_dir));
}));

test("the sweep removes a run folder whose pid now belongs to a newer process", () => with_tmp_root((tmp_root) => {
  // This process is alive, but its start time differs from the one recorded, as after a pid reuse.
  const run_dir = left_run_dir(tmp_root, "reused", `${process.pid} ${Number(own_start_ticks()) - 1}\n`);
  sweep_dead_run_dirs(tmp_root);
  assert.ok(!existsSync(run_dir));
}));

test("the sweep skips a run folder with no owner file or an unreadable one", () => with_tmp_root((tmp_root) => {
  const no_owner = left_run_dir(tmp_root, "no_owner");
  const garbled = left_run_dir(tmp_root, "garbled", "not a pid\n");
  sweep_dead_run_dirs(tmp_root);
  assert.ok(existsSync(no_owner));
  assert.ok(existsSync(garbled));
}));

test("the sweep leaves other folders in the tmp root alone", () => with_tmp_root((tmp_root) => {
  const other = join(tmp_root, "desertfox-key-abc");
  mkdirSync(other);
  writeFileSync(join(other, "owner"), `${dead_pid()} 1\n`);
  sweep_dead_run_dirs(tmp_root);
  assert.ok(existsSync(other));
}));

test("the sweep removes the owner file last, so a removal that stops midway leaves the folder to the next sweep", () => with_tmp_root((tmp_root) => {
  const run_dir = left_run_dir(tmp_root, "stuck", `${dead_pid()} 12345\n`);
  // A read-only folder with a file in it cannot be emptied, which stands in for a worker that keeps writing.
  const stuck = join(run_dir, "s1");
  writeFileSync(join(stuck, "file"), "x");
  chmodSync(stuck, 0o500);
  try {
    sweep_dead_run_dirs(tmp_root);
    assert.ok(existsSync(join(run_dir, "owner")));
  } finally {
    chmodSync(stuck, 0o700);
  }
  sweep_dead_run_dirs(tmp_root);
  assert.ok(!existsSync(run_dir));
}));

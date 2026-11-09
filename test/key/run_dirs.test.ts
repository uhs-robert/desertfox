import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { make_run_dir, sweep_dead_run_dirs, kill_session_now, runtime_dir_of } = await import(join(import.meta.dirname, "session.mjs"));

// Each test sweeps a private folder that stands in for /tmp, so no real run folder is touched.
async function with_tmp_root(body: (tmp_root: string) => void | Promise<void>) {
  const tmp_root = mkdtempSync(join(tmpdir(), "run-dirs-test-"));
  try {
    await body(tmp_root);
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

test("the sweep keeps the run folder of a live run", () => with_tmp_root(async (tmp_root) => {
  const run_dir = make_run_dir(tmp_root);
  await sweep_dead_run_dirs(tmp_root);
  assert.ok(existsSync(run_dir));
}));

test("the sweep removes the run folder of a run that is gone", () => with_tmp_root(async (tmp_root) => {
  const run_dir = left_run_dir(tmp_root, "dead", `${dead_pid()} 12345\n`);
  await sweep_dead_run_dirs(tmp_root);
  assert.ok(!existsSync(run_dir));
}));

test("the sweep removes a run folder whose pid now belongs to a newer process", () => with_tmp_root(async (tmp_root) => {
  // This process is alive, but its start time differs from the one recorded, as after a pid reuse.
  const run_dir = left_run_dir(tmp_root, "reused", `${process.pid} ${Number(own_start_ticks()) - 1}\n`);
  await sweep_dead_run_dirs(tmp_root);
  assert.ok(!existsSync(run_dir));
}));

test("the sweep skips a run folder with no owner file or an unreadable one", () => with_tmp_root(async (tmp_root) => {
  const no_owner = left_run_dir(tmp_root, "no_owner");
  const garbled = left_run_dir(tmp_root, "garbled", "not a pid\n");
  await sweep_dead_run_dirs(tmp_root);
  assert.ok(existsSync(no_owner));
  assert.ok(existsSync(garbled));
}));

test("the sweep leaves other folders in the tmp root alone", () => with_tmp_root(async (tmp_root) => {
  const other = join(tmp_root, "desertfox-key-abc");
  mkdirSync(other);
  writeFileSync(join(other, "owner"), `${dead_pid()} 1\n`);
  await sweep_dead_run_dirs(tmp_root);
  assert.ok(existsSync(other));
}));

test("the sweep removes the owner file last, so a removal that stops midway leaves the folder to the next sweep", () => with_tmp_root(async (tmp_root) => {
  const run_dir = left_run_dir(tmp_root, "stuck", `${dead_pid()} 12345\n`);
  // A read-only folder with a file in it cannot be emptied, which stands in for a worker that keeps writing.
  const stuck = join(run_dir, "s1");
  writeFileSync(join(stuck, "file"), "x");
  chmodSync(stuck, 0o500);
  try {
    await sweep_dead_run_dirs(tmp_root);
    assert.ok(existsSync(join(run_dir, "owner")));
  } finally {
    chmodSync(stuck, 0o700);
  }
  await sweep_dead_run_dirs(tmp_root);
  assert.ok(!existsSync(run_dir));
}));

// A process whose environment names a path in the folder, as a worker's TMPDIR or a session's HOME does.
const start_carrier = (env: Record<string, string>, seconds: number) => spawn("sleep", [String(seconds)], { env: { ...process.env, ...env }, stdio: "ignore" });
const exited = (child: ReturnType<typeof spawn>) => new Promise((resolve) => child.once("exit", resolve));

test("the sweep keeps a dead run's folder, owner file included, while a process still carries it", () => with_tmp_root(async (tmp_root) => {
  const run_dir = left_run_dir(tmp_root, "carried", `${dead_pid()} 12345\n`);
  const carrier = start_carrier({ TMPDIR: join(run_dir, "s1") }, 30);
  try {
    await sweep_dead_run_dirs(tmp_root, { carrier_wait_ms: 300 });
    assert.ok(existsSync(join(run_dir, "owner")));
  } finally {
    carrier.kill("SIGKILL");
    await exited(carrier);
  }
  await sweep_dead_run_dirs(tmp_root, { carrier_wait_ms: 300 });
  assert.ok(!existsSync(run_dir));
}));

test("the sweep waits for a dead run's last process to exit, then removes the folder", () => with_tmp_root(async (tmp_root) => {
  const run_dir = left_run_dir(tmp_root, "dying", `${dead_pid()} 12345\n`);
  start_carrier({ HOME: join(run_dir, "s1", "home") }, 0.5);
  await sweep_dead_run_dirs(tmp_root, { carrier_wait_ms: 3000 });
  assert.ok(!existsSync(run_dir));
}));

test("kill_session_now kills every process of a session and removes its runtime dir", async () => {
  const name = `unit${process.pid.toString(36)}`;
  const runtime_dir = runtime_dir_of(name);
  mkdirSync(runtime_dir, { recursive: true });
  const member = start_carrier({ XDG_RUNTIME_DIR: runtime_dir }, 30);
  const member_exit = exited(member);
  try {
    await new Promise((resolve) => member.once("spawn", resolve));
    kill_session_now(name);
    assert.ok(!existsSync(runtime_dir));
    await member_exit;
    assert.equal(member.signalCode, "SIGKILL");
  } finally {
    member.kill("SIGKILL");
    rmSync(runtime_dir, { recursive: true, force: true });
  }
});

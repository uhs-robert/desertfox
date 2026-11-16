import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";

const { make_run_dir, runtime_dir_of, stop_session_named, sweep_orphan_compositors } = await import(join(import.meta.dirname, "session.mjs"));

// A stand-in for labwc: perl treats `-C <file>` as "run that file", so the command line reads `labwc -C <path>` as labwc's does,
// and the script clears the dumpable flag as a file-capability exec does, so its /proc/<pid>/environ is EACCES (x86_64 prctl).
const PERL_SCRIPT = "syscall(157, 4, 0); $| = 1; print qq(ready\\n); sleep 300;\n";
const skip = process.arch !== "x64" ? "the stand-in clears the dumpable flag with the x86_64 prctl number" : false;

const started: ChildProcess[] = [];
// Started in its own process group, as start_child does.
async function start_fake_labwc(script_path: string): Promise<ChildProcess> {
  mkdirSync(join(script_path, ".."), { recursive: true });
  writeFileSync(script_path, PERL_SCRIPT);
  const child = spawn("perl", ["-C", script_path], { argv0: "labwc", detached: true, stdio: ["ignore", "pipe", "ignore"] });
  started.push(child);
  const lines = createInterface({ input: child.stdout! });
  await new Promise((resolve_ready) => lines.once("line", resolve_ready));
  return child;
}
const is_running = (pid: number) => {
  try {
    const state = readFileSync(`/proc/${pid}/stat`, "latin1");
    return state.slice(state.lastIndexOf(")") + 2)[0] !== "Z";
  } catch {
    return false;
  }
};
const start_ticks = (pid: number) => {
  const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
  return String(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
};
const wait_gone = async (pid: number) => {
  for (let attempt = 0; attempt < 100 && is_running(pid); attempt++) await new Promise((resolve_wait) => setTimeout(resolve_wait, 50));
};
const dead_owner = `99999999 12345\n`;
const session_labwc = (run_dir: string) => join(run_dir, "s1", "desertfox-key-abc", "session", "labwc");

async function with_tmp_root(body: (tmp_root: string) => Promise<void>) {
  const tmp_root = mkdtempSync(join(tmpdir(), "labwc-sweep-test-"));
  try {
    await body(tmp_root);
  } finally {
    for (const child of started.splice(0)) try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ }
    rmSync(tmp_root, { recursive: true, force: true });
  }
}
const dead_run_dir = (tmp_root: string, name: string, owner: string = dead_owner) => {
  const run_dir = join(tmp_root, `desertfox-key-run-${name}`);
  mkdirSync(run_dir, { recursive: true });
  writeFileSync(join(run_dir, "owner"), owner);
  return run_dir;
};
const quietly = async <T>(body: () => Promise<T>): Promise<{ result: T; logged: string[] }> => {
  const logged: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => { logged.push(parts.join(" ")); };
  try {
    return { result: await body(), logged };
  } finally {
    console.log = original;
  }
};

test("the stand-in labwc has an unreadable environment, like the real one", { skip }, () => with_tmp_root(async (tmp_root) => {
  const child = await start_fake_labwc(session_labwc(dead_run_dir(tmp_root, "a")));
  assert.throws(() => readFileSync(`/proc/${child.pid}/environ`), { code: "EACCES" });
}));

test("the sweep stops a labwc of a dead run, reports its unreadable environment, and leaves the other cases alone", { skip }, () => with_tmp_root(async (tmp_root) => {
  const dead = await start_fake_labwc(session_labwc(dead_run_dir(tmp_root, "dead")));
  const reused_run = dead_run_dir(tmp_root, "reused", `${process.pid} ${Number(start_ticks(process.pid)) - 1}\n`);
  const reused = await start_fake_labwc(session_labwc(reused_run));
  const live = await start_fake_labwc(session_labwc(make_run_dir(tmp_root)));
  const other_job = await start_fake_labwc(join(tmp_root, "db-measure", "session", "labwc"));
  const { logged } = await quietly(() => sweep_orphan_compositors(tmp_root));
  await wait_gone(dead.pid!);
  assert.ok(!is_running(dead.pid!), "the labwc of a dead run is stopped");
  assert.ok(!is_running(reused.pid!), "a run whose pid now belongs to a newer process is dead");
  assert.ok(is_running(live.pid!), "the labwc of a live run is spared");
  assert.ok(is_running(other_job.pid!), "a labwc outside a run folder is spared");
  assert.ok(logged.some((line) => line.includes(String(dead.pid)) && line.includes("EACCES")), `the unreadable environment is reported: ${logged.join("|")}`);
}));

test("the sweep stops a labwc whose run folder is gone", { skip }, () => with_tmp_root(async (tmp_root) => {
  const run_dir = dead_run_dir(tmp_root, "gone");
  const orphan = await start_fake_labwc(session_labwc(run_dir));
  rmSync(run_dir, { recursive: true });
  await quietly(() => sweep_orphan_compositors(tmp_root));
  await wait_gone(orphan.pid!);
  assert.ok(!is_running(orphan.pid!));
}));

test("the sweep spares a labwc under a run folder with no owner file", { skip }, () => with_tmp_root(async (tmp_root) => {
  const run_dir = join(tmp_root, "desertfox-key-run-fresh");
  const fresh = await start_fake_labwc(session_labwc(run_dir));
  await quietly(() => sweep_orphan_compositors(tmp_root));
  assert.ok(is_running(fresh.pid!));
  assert.ok(existsSync(run_dir));
}));

// stop_session_named stops a session whose environment scan sees nothing: the recorded process group goes.
async function session_with_recorded_labwc(tmp_root: string, name: string, recorded_ticks: (real: string) => string) {
  const runtime_dir = runtime_dir_of(name);
  mkdirSync(runtime_dir, { recursive: true, mode: 0o700 });
  const child = await start_fake_labwc(session_labwc(dead_run_dir(tmp_root, name)));
  writeFileSync(join(runtime_dir, "pids"), `${child.pid} ${recorded_ticks(start_ticks(child.pid!))}\n`);
  return child;
}

test("stopping a session ends the recorded group of its non-dumpable labwc", { skip }, () => with_tmp_root(async (tmp_root) => {
  const name = `lsw${process.pid.toString(36)}`;
  const child = await session_with_recorded_labwc(tmp_root, name, (real) => real);
  await stop_session_named(name);
  await wait_gone(child.pid!);
  assert.ok(!is_running(child.pid!));
  assert.ok(!existsSync(runtime_dir_of(name)));
}));

test("stopping a session spares a recorded pid whose start time differs, a reused pid", { skip }, () => with_tmp_root(async (tmp_root) => {
  const name = `lsx${process.pid.toString(36)}`;
  const child = await session_with_recorded_labwc(tmp_root, name, (real) => String(Number(real) - 1));
  await stop_session_named(name);
  assert.ok(is_running(child.pid!), "another process holds the pid now");
  assert.ok(!existsSync(runtime_dir_of(name)));
}));

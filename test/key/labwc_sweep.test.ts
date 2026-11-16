import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";

const { make_run_dir, runtime_dir_of, stop_session_named, sweep_orphan_compositors } = await import(join(import.meta.dirname, "session.mjs"));

// A stand-in for labwc: perl treats `-C <file>` as "run that file", so the command line reads `labwc -C <path>` as labwc's does,
// and the script clears the dumpable flag as a file-capability exec does, so its /proc/<pid>/environ is EACCES (x86_64 prctl).
const perl_script = (comm: string) => `syscall(157, 4, 0); my $comm = "${comm}"; syscall(157, 15, $comm); $| = 1; print qq(ready\\n); sleep 300;\n`;
const skip = process.arch !== "x64" ? "the stand-in clears the dumpable flag with the x86_64 prctl number" : false;

const started: ChildProcess[] = [];
// Session runtime dirs a test made, removed with the rest in with_tmp_root's finally.
const runtime_dirs: string[] = [];
// Started in its own process group, as start_child does.
// `comm` is the name /proc/<pid>/stat shows. `detached: false` leaves it in the test's group, so kill(-pid) cannot reach it.
async function start_fake_labwc(script_path: string, { comm = "labwc", detached = true } = {}): Promise<ChildProcess> {
  mkdirSync(join(script_path, ".."), { recursive: true });
  writeFileSync(script_path, perl_script(comm));
  const child = spawn("perl", ["-C", script_path], { argv0: "labwc", detached, stdio: ["ignore", "pipe", "ignore"] });
  started.push(child);
  const lines = createInterface({ input: child.stdout! });
  // A stand-in that exits or never answers fails the test at once, so its finally still removes the dirs.
  await new Promise<void>((resolve_ready, reject_ready) => {
    const timer = setTimeout(() => reject_ready(new Error("the stand-in labwc was not ready within 5 s")), 5000);
    child.once("exit", (code) => reject_ready(new Error(`the stand-in labwc exited (${code}) before it was ready`)));
    lines.once("line", () => { clearTimeout(timer); resolve_ready(); });
  });
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
    for (const child of started.splice(0)) {
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* not a group leader */ }
      try { process.kill(child.pid!, "SIGKILL"); } catch { /* gone */ }
    }
    rmSync(tmp_root, { recursive: true, force: true });
    for (const dir of runtime_dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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
async function session_with_recorded_labwc(tmp_root: string, name: string, recorded_ticks: (real: string) => string, options = {}) {
  const runtime_dir = runtime_dir_of(name);
  runtime_dirs.push(runtime_dir);
  mkdirSync(runtime_dir, { recursive: true, mode: 0o700 });
  const child = await start_fake_labwc(session_labwc(dead_run_dir(tmp_root, name)), options);
  writeFileSync(join(runtime_dir, "pids"), `${child.pid} ${recorded_ticks(start_ticks(child.pid!))}\n`, { flag: "a" });
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

test("a trailing slash on the tmp root does not make the sweep stop a live run's labwc", { skip }, () => with_tmp_root(async (tmp_root) => {
  const live = await start_fake_labwc(session_labwc(make_run_dir(tmp_root)));
  const dead = await start_fake_labwc(session_labwc(dead_run_dir(tmp_root, "dead")));
  await quietly(() => sweep_orphan_compositors(`${tmp_root}/`));
  await wait_gone(dead.pid!);
  assert.ok(is_running(live.pid!), "the live run's labwc is spared");
  assert.ok(!is_running(dead.pid!), "the dead run's labwc is still stopped");
}));

test("the sweep spares a labwc while a process still carries its dead run's folder", { skip }, () => with_tmp_root(async (tmp_root) => {
  const run_dir = dead_run_dir(tmp_root, "stopping");
  const labwc = await start_fake_labwc(session_labwc(run_dir));
  // An orphaned worker that is still tearing down its session carries the run folder in TMPDIR.
  const worker = spawn("sleep", ["300"], { env: { ...process.env, TMPDIR: join(run_dir, "s1") }, stdio: "ignore" });
  try {
    await quietly(() => sweep_orphan_compositors(tmp_root));
    assert.ok(is_running(labwc.pid!));
    worker.kill("SIGKILL");
    await new Promise((resolve_exit) => worker.once("exit", resolve_exit));
    await quietly(() => sweep_orphan_compositors(tmp_root));
    await wait_gone(labwc.pid!);
    assert.ok(!is_running(labwc.pid!), "once the worker is gone the labwc is stopped");
  } finally {
    worker.kill("SIGKILL");
  }
}));

test("a recorded process whose name holds spaces and parentheses is still stopped", { skip }, () => with_tmp_root(async (tmp_root) => {
  const name = `lsy${process.pid.toString(36)}`;
  const child = await session_with_recorded_labwc(tmp_root, name, (real) => real, { comm: "a (b) c d" });
  assert.match(readFileSync(`/proc/${child.pid}/stat`, "latin1"), /\(a \(b\) c d\)/);
  await stop_session_named(name);
  await wait_gone(child.pid!);
  assert.ok(!is_running(child.pid!));
}));

test("stopping a session throws when a recorded process survives, after it stopped every other one", { skip }, () => with_tmp_root(async (tmp_root) => {
  const name = `lsz${process.pid.toString(36)}`;
  const stoppable = await session_with_recorded_labwc(tmp_root, name, (real) => real);
  // Not a group leader, so the group kill finds no group and this one outlives the stop.
  const survivor = await session_with_recorded_labwc(tmp_root, name, (real) => real, { detached: false });
  await assert.rejects(stop_session_named(name), new RegExp(`still run from .* after SIGKILL: ${survivor.pid}$`));
  await wait_gone(stoppable.pid!);
  assert.ok(!is_running(stoppable.pid!));
  assert.ok(is_running(survivor.pid!));
}));

test("stopping a session ends a group member that ignores SIGTERM after its leader exited", { skip }, () => with_tmp_root(async () => {
  const name = `lsg${process.pid.toString(36)}`;
  const runtime_dir = runtime_dir_of(name);
  runtime_dirs.push(runtime_dir);
  mkdirSync(runtime_dir, { recursive: true, mode: 0o700 });
  // The leader dies on SIGTERM. Its child stays in the group, ignores SIGTERM and says so once it does.
  const code = 'use POSIX; $| = 1; if (fork()) { sleep 300 } else { $SIG{TERM} = "IGNORE"; print qq(ready\\n); sleep 300 }';
  const leader = spawn("perl", ["-e", code], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  started.push(leader);
  await new Promise<void>((resolve_ready, reject_ready) => {
    const timer = setTimeout(() => reject_ready(new Error("the member was not ready within 5 s")), 5000);
    createInterface({ input: leader.stdout! }).once("line", () => { clearTimeout(timer); resolve_ready(); });
  });
  writeFileSync(join(runtime_dir, "pids"), `${leader.pid} ${start_ticks(leader.pid!)}\n`);
  const member = readdirSync("/proc").filter((entry) => /^\d+$/.test(entry)).map(Number).find((pid) => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
      return pid !== leader.pid && Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]) === leader.pid;
    } catch {
      return false;
    }
  });
  assert.ok(member !== undefined, "the member is in the leader's group");
  await stop_session_named(name);
  await wait_gone(leader.pid!);
  await wait_gone(member!);
  assert.ok(!is_running(leader.pid!));
  assert.ok(!is_running(member!), "the member that ignored SIGTERM is killed");
}));

test("stopping a session spares an unrelated group whose pgid a dead recorded leader once held", { skip }, () => with_tmp_root(async () => {
  const name = `lsh${process.pid.toString(36)}`;
  const runtime_dir = runtime_dir_of(name);
  runtime_dirs.push(runtime_dir);
  mkdirSync(runtime_dir, { recursive: true, mode: 0o700 });
  // A process of ours that took the pid, called setsid and exited, as a reused pid would: its child keeps the group.
  const code = 'use POSIX; $| = 1; setsid(); if (fork()) { exit 0 } else { print qq(ready\\n); sleep 300 }';
  const stranger = spawn("perl", ["-e", code], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  started.push(stranger);
  await new Promise<void>((resolve_ready, reject_ready) => {
    const timer = setTimeout(() => reject_ready(new Error("the stranger was not ready within 5 s")), 5000);
    createInterface({ input: stranger.stdout! }).once("line", () => { clearTimeout(timer); resolve_ready(); });
  });
  const child = readdirSync("/proc").filter((entry) => /^\d+$/.test(entry)).map(Number).find((pid) => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
      return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]) === stranger.pid && pid !== stranger.pid;
    } catch {
      return false;
    }
  });
  // Reaped, so no zombie leader with other start ticks is left for the stop to compare.
  for (let attempt = 0; attempt < 100 && existsSync(`/proc/${stranger.pid}`); attempt++) await new Promise((resolve_wait) => setTimeout(resolve_wait, 50));
  assert.ok(child !== undefined && !existsSync(`/proc/${stranger.pid}`), "the stranger's leader is gone and its child lives in the group");
  writeFileSync(join(runtime_dir, "pids"), `${stranger.pid} 1\n`);
  await stop_session_named(name);
  assert.ok(is_running(child!), "a group of a leader that was dead before the stop is left alone");
}));

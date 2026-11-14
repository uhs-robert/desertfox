import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// @ts-expect-error The rig is plain JavaScript without types.
import { close_window, judge_window, owns_profile, pick_close_targets, profile_dir_of, read_state, state_file_of, unit_of, write_state } from "../tools/measure/rivals/compare.mjs";

const window_of = (dir: string, tool: string, pid: number, start_ticks: number) => ({ tool, pid, start_ticks, port: 40000 + pid, profile: profile_dir_of(dir, tool) });

test("the state file round-trips, and a missing file is an empty list", () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-state-"));
  try {
    assert.deepEqual(read_state(dir), []);
    const windows = [window_of(dir, "desertfox", 100, 5000), window_of(dir, "vimium", 101, 5001)];
    write_state(dir, windows);
    assert.deepEqual(read_state(dir), windows);
    assert.equal(statSync(state_file_of(dir)).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a damaged state file or an unknown tool throws instead of guessing", () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-state-"));
  try {
    writeFileSync(state_file_of(dir), "{not json");
    assert.throws(() => read_state(dir));
    writeFileSync(state_file_of(dir), JSON.stringify({ windows: [{ tool: "firefox", pid: 1, start_ticks: 1, port: 1, profile: "/home" }] }));
    assert.throws(() => read_state(dir), /not a compare state file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("close targets are the recorded pids whose start ticks still match", () => {
  const dir = "/c";
  const windows = [
    window_of(dir, "desertfox", 100, 5000),
    window_of(dir, "vimium", 101, 5001),
    window_of(dir, "vimiumc", 102, 5002),
    window_of(dir, "tridactyl", 0, 0),
  ];
  const live: Record<number, number> = { 100: 5000, 101: 9999 };
  const { running, gone } = pick_close_targets(windows, (pid: number) => live[pid] ?? null);
  assert.deepEqual(running.map((w: { tool: string }) => w.tool), ["desertfox"]);
  assert.deepEqual(gone.map((w: { tool: string }) => w.tool), ["vimium", "vimiumc", "tridactyl"]);
});

test("a profile is deleted only at the path made for its tool", () => {
  assert.equal(owns_profile("/c", window_of("/c", "vimium", 1, 1)), true);
  assert.equal(owns_profile("/c", { ...window_of("/c", "vimium", 1, 1), profile: "/home/user/.mozilla" }), false);
});

// A fake machine: `alive` maps a pid to its start ticks, and a signal removes the pid unless it is listed in `immune`.
function fake_deps(alive: Record<number, number>, options: { immune?: number[]; unit_stops?: boolean; profile_pid?: number | null } = {}) {
  const signals: string[] = [];
  const stopped_units: string[] = [];
  return {
    signals,
    stopped_units,
    read_start_ticks: (pid: number) => alive[pid] ?? null,
    signal: (pid: number, signal: string) => { signals.push(`${signal} ${pid}`); if (!options.immune?.includes(pid)) delete alive[pid]; },
    sleep: async () => {},
    stop_unit: (unit: string) => { stopped_units.push(unit); return options.unit_stops ?? true; },
    remove_profile: () => {},
    remove_window_files: () => {},
    find_pid: () => options.profile_pid ?? null,
    grace_ms: 0,
    kill_wait_ms: 0,
  };
}

test("close stops a recorded window and its unit", async () => {
  const w = window_of("/c", "vimium", 101, 5001);
  const deps = fake_deps({ 101: 5001 });
  const result = await close_window("/c", w, deps);
  assert.equal(result.gone, true);
  assert.deepEqual(deps.signals, ["SIGTERM 101"]);
  assert.deepEqual(deps.stopped_units, [unit_of("vimium")]);
});

test("a window recorded with pid 0 is found by its profile and stopped", async () => {
  const w = window_of("/c", "tridactyl", 0, 0);
  const deps = fake_deps({ 777: 9000 }, { profile_pid: 777 });
  const result = await close_window("/c", w, deps);
  assert.equal(result.gone, true);
  assert.deepEqual(deps.signals, ["SIGTERM 777"]);
});

test("a pid-0 record with a foreign profile path finds nothing to signal", async () => {
  const w = { ...window_of("/c", "tridactyl", 0, 0), profile: "/home/user/.mozilla/x" };
  const deps = fake_deps({ 777: 9000 }, { profile_pid: 777 });
  const result = await close_window("/c", w, deps);
  assert.deepEqual(deps.signals, []);
  assert.equal(result.gone, true);
});

test("a process that survives SIGKILL, or a unit that will not stop, keeps the window", async () => {
  const w = window_of("/c", "vimiumc", 102, 5002);
  const stuck = fake_deps({ 102: 5002 }, { immune: [102] });
  assert.equal((await close_window("/c", w, stuck)).gone, false);
  assert.deepEqual(stuck.signals, ["SIGTERM 102", "SIGKILL 102"]);
  const unit_stuck = fake_deps({ 102: 5002 }, { unit_stops: false });
  assert.equal((await close_window("/c", w, unit_stuck)).gone, false);
});

test("a recycled pid is left alone", async () => {
  const w = window_of("/c", "vimium", 101, 5001);
  const deps = fake_deps({ 101: 6000 });
  const result = await close_window("/c", w, deps);
  assert.deepEqual(deps.signals, []);
  assert.equal(result.gone, true);
});

test("a window is judged by its own add-on alone, and DesertFox must be the temporary build", () => {
  const own = { id: "desertfox@uhs-robert", version: "1.0", temporary: true };
  const addon = { id: "desertfox@uhs-robert", version: "1.0" };
  assert.equal(judge_window("desertfox", addon, [own]), null);
  assert.match(judge_window("desertfox", addon, [{ ...own, temporary: false }]) ?? "", /temporary install/);
  assert.match(judge_window("vimium", { id: "v", version: "2" }, [{ id: "v", version: "2", temporary: true }, own]) ?? "", /another add-on is active/);
  assert.match(judge_window("vimium", { id: "v", version: "2" }, []) ?? "", /not active/);
  assert.match(judge_window("vimium", { id: "v", version: "2" }, [{ id: "v", version: "3", temporary: true }]) ?? "", /expected 2/);
});

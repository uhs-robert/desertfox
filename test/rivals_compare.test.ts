import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
// @ts-expect-error The rig is plain JavaScript without types.
import { close_window, close_windows, COMPARE_TOOLS, judge_window, owns_profile, parse_open_args, pick_close_targets, profile_dir_of, start_failure_message, prune_dead_windows, read_state, state_file_of, tools_to_open, unit_of, write_state } from "../tools/measure/rivals/compare.mjs";

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
  assert.deepEqual(result.lines, ["Vimium: closed"]);
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

test("a window the unit stop already ended counts as closed, and one gone before close as already gone", async () => {
  const alive: Record<number, number> = { 101: 5001 };
  const deps = { ...fake_deps(alive), stop_unit: () => { delete alive[101]; return true; } };
  assert.deepEqual((await close_window("/c", window_of("/c", "vimium", 101, 5001), deps)).lines, ["Vimium: closed"]);
  const gone = await close_window("/c", window_of("/c", "vimium", 101, 5001), fake_deps({}));
  assert.deepEqual(gone.lines, ["Vimium: already gone"]);
});

// Fake liveness: `alive` maps pid to ticks, `by_profile` maps a profile path to the pid of a Firefox on it, `units` lists active units.
const liveness_of = (alive: Record<number, number>, by_profile: Record<string, number> = {}, units: string[] = []) => ({
  ticks_of_pid: (pid: number) => alive[pid] ?? null,
  find_pid: (profile: string) => by_profile[profile] ?? null,
  unit_active: (unit: string) => units.includes(unit),
});
const tools_of = (windows: { tool: string }[]) => windows.map((w) => w.tool);

test("open drops windows closed by hand, with their profiles, and keeps the running ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-prune-"));
  try {
    const windows = [window_of(dir, "desertfox", 100, 5000), window_of(dir, "vimium", 101, 5001), window_of(dir, "vimiumc", 102, 5002), window_of(dir, "tridactyl", 0, 0)];
    for (const w of windows) mkdirSync(w.profile, { recursive: true });
    write_state(dir, windows);
    const { running, dropped } = prune_dead_windows(dir, liveness_of({ 100: 5000, 102: 7777 }));
    assert.deepEqual(tools_of(running), ["desertfox"]);
    assert.deepEqual(tools_of(dropped), ["vimium", "vimiumc", "tridactyl"]);
    assert.deepEqual(tools_of(read_state(dir)), ["desertfox"]);
    assert.equal(existsSync(windows[0].profile), true);
    assert.equal(existsSync(windows[1].profile), false);
    assert.deepEqual(tools_to_open(COMPARE_TOOLS, running), ["vimium", "vimiumc", "tridactyl"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pid-0 record whose Firefox runs on its profile is adopted, not pruned", () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-prune-"));
  try {
    const w = window_of(dir, "tridactyl", 0, 0);
    mkdirSync(w.profile, { recursive: true });
    write_state(dir, [w]);
    const { running, dropped } = prune_dead_windows(dir, liveness_of({ 777: 9000 }, { [w.profile]: 777 }));
    assert.deepEqual(dropped, []);
    assert.deepEqual(running, [{ ...w, pid: 777, start_ticks: 9000 }]);
    assert.deepEqual(read_state(dir), running);
    assert.equal(existsSync(w.profile), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Firefox that restarted under a new pid is adopted, and an active unit alone keeps the record", () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-prune-"));
  try {
    const restarted = window_of(dir, "vimium", 101, 5001);
    const unit_only = window_of(dir, "vimiumc", 0, 0);
    for (const w of [restarted, unit_only]) mkdirSync(w.profile, { recursive: true });
    write_state(dir, [restarted, unit_only]);
    const { running, dropped } = prune_dead_windows(dir, liveness_of({ 300: 8000 }, { [restarted.profile]: 300 }, [unit_of("vimiumc")]));
    assert.deepEqual(dropped, []);
    assert.deepEqual(running, [{ ...restarted, pid: 300, start_ticks: 8000 }, unit_only]);
    assert.equal(existsSync(unit_only.profile), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("when every window is dead, pruning removes the state file so open starts clean", () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-prune-"));
  try {
    write_state(dir, [window_of(dir, "vimium", 101, 5001)]);
    const { running } = prune_dead_windows(dir, liveness_of({}));
    assert.deepEqual(running, []);
    assert.equal(existsSync(state_file_of(dir)), false);
    assert.deepEqual(prune_dead_windows(dir, liveness_of({})), { running: [], dropped: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("close tolerates dead entries and closes only the tools it is given", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-close-"));
  try {
    write_state(dir, [window_of(dir, "desertfox", 100, 5000), window_of(dir, "vimium", 101, 5001)]);
    const deps = fake_deps({ 100: 5000 });
    assert.equal(await close_windows(dir, deps, ["vimium"]), true);
    assert.deepEqual(deps.signals, []);
    assert.deepEqual(read_state(dir).map((w: { tool: string }) => w.tool), ["desertfox"]);
    assert.equal(await close_windows(dir, deps), true);
    assert.equal(existsSync(state_file_of(dir)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--tool picks one window, no flag picks all, and an unknown tool is refused", () => {
  assert.deepEqual(parse_open_args(["--tool", "vimium", "https://a.test"]), { urls: ["https://a.test"], wanted: ["vimium"] });
  assert.deepEqual(parse_open_args(["https://a.test", "--tool", "tridactyl"]).wanted, ["tridactyl"]);
  assert.deepEqual(parse_open_args(["https://a.test"]), { urls: ["https://a.test"], wanted: COMPARE_TOOLS });
  assert.throws(() => parse_open_args(["--tool", "firefox"]), /--tool takes one of/);
  assert.deepEqual(tools_to_open(["vimium"], [window_of("/c", "vimium", 1, 1)]), []);
});

test("a failed start names the tool and carries the last 20 lines of its log", () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-log-"));
  try {
    const log = join(dir, "firefox.log");
    writeFileSync(log, Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
    const message = start_failure_message("tridactyl", "no debugger connection", log);
    assert.match(message, /^tridactyl: no debugger connection/);
    assert.match(message, /line 30$/);
    assert.match(message, /line 11\n/);
    assert.doesNotMatch(message, /line 10\n/);
    assert.match(start_failure_message("vimium", "x", join(dir, "missing.log")), /\(no log\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// usage: node tools/owner_test/cli.ts <open|reload|status|close> [worktree] [':set name value']...
// Opens a real Firefox window with a worktree's build for the maintainer's hands-on test. See README.md.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { close_window } from "./close.ts";
import { check_hint } from "./hints.ts";
import { check_environment, firefox_pid_for, real_close_deps, sleep, start_unit } from "./system.ts";
import { canonical_worktree, default_roots, unit_name, window_paths, type WindowPaths } from "./paths.ts";
import { is_same_process, parse_debug_port, read_start_ticks } from "./process_guard.ts";
import { flock_argv, LOCK_BUSY_EXIT, LOCK_HELD_ENV } from "./lock.ts";
import { Refusal } from "./refusal.ts";
import { probe_window, reload_window, type ProbeOutcome } from "./rdp_probe.ts";
import { seed_user_js } from "./profile.ts";
import { discard_state_of_failed_spawn, read_state, write_state, type WindowState } from "./state.ts";
import { stamp_label, stamp_manifest, tail_lines, web_ext_args } from "./web_ext.ts";

const MIN_FREE_BYTES = 2 * 1024 ** 3;
const START_TIMEOUT_MS = 90_000;

function fail(message: string): never {
  throw new Refusal(message);
}

function git(worktree: string, ...args: string[]): string {
  return execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" }).trim();
}

function check_worktree(worktree: string): void {
  if (!existsSync(join(worktree, "src", "manifest.json")) || !existsSync(join(worktree, "package.json"))) fail(`${worktree} is not a DesertFox checkout`);
  if (!existsSync(join(worktree, "node_modules", ".bin", "web-ext"))) fail(`${worktree} has no node_modules/.bin/web-ext. Run npm install there first.`);
}

function build_and_stamp(worktree: string): string {
  const build = spawnSync("npm", ["run", "--silent", "build"], { cwd: worktree, stdio: "inherit" });
  if (build.status !== 0) fail("the build failed");
  const dirty = git(worktree, "status", "--porcelain", "--untracked-files=no") !== "";
  const label = stamp_label(git(worktree, "rev-parse", "--abbrev-ref", "HEAD"), git(worktree, "rev-parse", "--short", "HEAD"), dirty, new Date().toISOString());
  const manifest_file = join(worktree, "dist", "manifest.json");
  writeFileSync(manifest_file, JSON.stringify(stamp_manifest(JSON.parse(readFileSync(manifest_file, "utf8")), label), null, 2));
  return label;
}

async function close(paths: WindowPaths): Promise<boolean> {
  const result = await close_window(paths, real_close_deps());
  for (const line of result.lines) console.log(line);
  return result.complete;
}

function debug_port_of(profile: string): number | null {
  const pid = firefox_pid_for(profile);
  return pid === null ? null : parse_debug_port(readFileSync(`/proc/${pid}/cmdline`, "utf8"));
}

const WRONG_BUILD_NO_PORT: ProbeOutcome = { ok: false, message: "WRONG BUILD: no debugger port found for the test window", permissions: "" };

async function probe_once(state: WindowState, expected_stamp: string, deadline_ms: number): Promise<ProbeOutcome> {
  const port = debug_port_of(state.profile);
  return port === null ? WRONG_BUILD_NO_PORT : probe_window(port, expected_stamp, deadline_ms);
}

async function wait_for_probe(state: WindowState, label: string, timeout_ms: number): Promise<ProbeOutcome> {
  const deadline = Date.now() + timeout_ms;
  let last: ProbeOutcome = { ok: false, message: "WRONG BUILD: the test window did not answer in time", permissions: "" };
  while (Date.now() < deadline) {
    try {
      last = await probe_once(state, label, Math.min(10_000, Math.max(1000, deadline - Date.now())));
      if (last.ok) return last;
    } catch (error) {
      last = { ok: false, message: `the test window did not answer yet: ${(error as Error).message}`, permissions: "" };
    }
    await sleep(1000);
  }
  return last;
}

function check_free_space(cache_root: string): void {
  mkdirSync(cache_root, { recursive: true });
  const stats = statfsSync(cache_root);
  if (stats.bavail * stats.bsize < MIN_FREE_BYTES) fail(`less than 2 GB free under ${cache_root}`);
}

// Stops early when web-ext has exited, so a crash fails in a second and not after the whole timeout.
async function wait_for_install(log_file: string, web_ext_alive: () => boolean): Promise<boolean> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(log_file) && readFileSync(log_file, "utf8").includes("as a temporary add-on")) return true;
    if (!web_ext_alive()) return false;
    await sleep(500);
  }
  return false;
}

function print_report(state: WindowState, hints: string[], permissions: string, heading: string): void {
  console.log(heading);
  console.log(`build: ${state.stamp}`);
  console.log(`profile: ${state.profile}`);
  console.log(`log: ${state.log}`);
  if (permissions) console.log(`optional permissions granted now: ${permissions}`);
  if (hints.length > 0) console.log(`Commands to type:\n${hints.map((hint) => `  ${hint}`).join("\n")}`);
  console.log(`Reload after a rebuild: just owner-test-reload ${state.worktree}`);
  console.log(`Close with: just owner-test-close ${state.worktree}`);
}

async function open(worktree: string, paths: WindowPaths, hints: string[]): Promise<void> {
  check_environment("owner-test");
  check_worktree(worktree);
  for (const hint of hints) {
    const checked = check_hint(hint);
    if (!checked.ok) fail(checked.error);
  }
  const label = build_and_stamp(worktree);
  // A second open on this worktree replaces its window. Other worktrees keep theirs: the state file, profile folder and unit are keyed by worktree.
  if (existsSync(paths.state_file) && !(await close(paths))) fail("the old window of this worktree is not closed, so no new one is opened over its profile. Fix that first, then run again.");
  check_free_space(paths.cache_root);
  mkdirSync(paths.profile_dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(paths.profile_dir, "user.js"), seed_user_js(readFileSync(join(worktree, "test", "key", "user.js"), "utf8")));
  rmSync(paths.log_file, { force: true });
  const state: WindowState = {
    worktree, profile: paths.profile_dir, log: paths.log_file, stamp: label, started: new Date().toISOString(), unit: null,
    web_ext_pid: 0, web_ext_start_ticks: 0, firefox_pid: 0, firefox_start_ticks: 0,
  };
  write_state(paths.state_file, state);
  const started = start_unit({
    unit: unit_name(paths.key), command: join(worktree, "node_modules", ".bin", "web-ext"), args: web_ext_args({ dist: join(worktree, "dist"), profile: paths.profile_dir }),
    cwd: worktree, log_file: paths.log_file, who: "owner-test",
  });
  if (discard_state_of_failed_spawn(started, paths.state_file)) fail("the plain spawn of web-ext returned no process id, so no window started. Its state file is removed. Run again.");
  state.unit = started.unit;
  state.web_ext_pid = started.pid;
  state.web_ext_start_ticks = read_start_ticks(started.pid) ?? 0;
  write_state(paths.state_file, state);
  if (!(await wait_for_install(paths.log_file, () => is_same_process(state.web_ext_pid, state.web_ext_start_ticks)))) {
    // The log is the one diagnostic of a failed start, and close deletes it, so show its end first.
    const log_tail = existsSync(paths.log_file) ? tail_lines(readFileSync(paths.log_file, "utf8"), 40) : "(no log)";
    await close(paths);
    fail(`web-ext did not install the add-on. Last lines of its log:\n${log_tail}`);
  }
  const firefox = firefox_pid_for(paths.profile_dir);
  state.firefox_pid = firefox ?? 0;
  state.firefox_start_ticks = firefox === null ? 0 : (read_start_ticks(firefox) ?? 0);
  write_state(paths.state_file, state);
  const result = await wait_for_probe(state, label, 30_000);
  if (!result.ok) fail(`${result.message}\nThe window is still open. Close it with: just owner-test-close ${worktree}`);
  print_report(state, hints, result.permissions, "test window open");
}

async function reload(worktree: string, paths: WindowPaths): Promise<void> {
  const read = read_state(paths.state_file);
  if (read.kind !== "ok") fail(read.kind === "none" ? "no test window is open for this worktree. Run just owner-test first." : `the state file is unreadable: ${read.reason}`);
  const state = read.state;
  if (!is_same_process(state.web_ext_pid, state.web_ext_start_ticks)) fail("the test window is gone. Run just owner-test to open a new one.");
  const label = build_and_stamp(worktree);
  const port = debug_port_of(state.profile);
  if (port === null) fail("no debugger port found for the test window");
  await reload_window(port, 15_000);
  const result = await wait_for_probe(state, label, 30_000);
  if (!result.ok) fail(result.message);
  state.stamp = label;
  write_state(paths.state_file, state);
  print_report(state, [], result.permissions, "test window reloaded");
}

// Re-probes the loaded build, because the policy beta can still take over after the first check.
async function status(paths: WindowPaths): Promise<void> {
  const read = read_state(paths.state_file);
  if (read.kind === "none") return console.log("nothing open");
  if (read.kind === "corrupt") return console.log(`state file is unreadable: ${read.reason}`);
  const { state } = read;
  if (!is_same_process(state.web_ext_pid, state.web_ext_start_ticks)) return console.log("stale: its processes are gone. Close cleans it.");
  console.log(`profile: ${state.profile}`);
  const result = await probe_once(state, state.stamp, 10_000).catch((error: Error) => ({ ok: false, message: `the test window did not answer: ${error.message}`, permissions: "" }));
  console.log(result.ok ? `open, loaded build matches: ${state.stamp}` : result.message);
  if (!result.ok) process.exitCode = 1;
}

const { positionals } = parseArgs({ allowPositionals: true });
const [action = "open", worktree_arg = ".", ...raw_hints] = positionals;
const hints = raw_hints.filter((hint) => hint.trim() !== "");
const roots = default_roots(process.env, homedir());

// open, reload and close run one at a time per worktree: the cli runs itself again under flock(1), which the kernel releases when that run ends.
function rerun_under_lock(lock_file: string): never {
  const run = spawnSync("flock", flock_argv(lock_file, [process.execPath, ...process.execArgv, ...process.argv.slice(1)]), {
    stdio: "inherit",
    env: { ...process.env, [LOCK_HELD_ENV]: "1" },
  });
  if (run.status === LOCK_BUSY_EXIT) fail("another owner-test call on this worktree is still running");
  if (run.error) fail(`could not run flock: ${run.error.message}`);
  process.exit(run.status ?? 1);
}

try {
  const worktree = existsSync(worktree_arg) ? canonical_worktree(worktree_arg) : fail(`${worktree_arg} does not exist`);
  const paths = window_paths(worktree, roots);
  const locked = action === "open" || action === "reload" || action === "close";
  if (locked && process.env[LOCK_HELD_ENV] !== "1") rerun_under_lock(paths.lock_file);
  if (action === "open") await open(worktree, paths, hints);
  else if (action === "reload") await reload(worktree, paths);
  else if (action === "status") await status(paths);
  else if (action === "close") process.exitCode = (await close(paths)) ? 0 : 1;
  else fail(`unknown action ${action}. Use open, reload, status or close.`);
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`owner-test: ${error.message}`);
  process.exit(1);
}
// A debugger socket that never connected must not keep the process alive.
process.exit(process.exitCode ?? 0);

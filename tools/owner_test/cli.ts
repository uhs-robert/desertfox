// usage: node tools/owner_test/cli.ts <open|reload|status|close> [worktree] [':set name value']...
// Opens a real Firefox window with a worktree's build for the owner's hands-on test. See README.md.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, rmdirSync, statfsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { close_window, type CloseDeps } from "./close.ts";
import { check_hint } from "./hints.ts";
import { default_roots, unit_name, window_paths, type Roots, type WindowPaths } from "./paths.ts";
import { is_same_process, parse_debug_port, read_start_ticks } from "./process_guard.ts";
import { judge_probe } from "./probe.ts";
import { seed_user_js } from "./profile.ts";
import { read_state, write_state, type WindowState } from "./state.ts";
import { RELOAD_FILE_NAME, stamp_label, stamp_manifest, web_ext_args } from "./web_ext.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const EXTENSION_ID = "desertfox@uhs-robert";
const MIN_FREE_BYTES = 2 * 1024 ** 3;
const START_TIMEOUT_MS = 90_000;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

class Refusal extends Error {}

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

// The window must show on the owner's desktop. The nested key-test session keeps its runtime dir under /tmp.
function check_environment(): void {
  if (!process.env.WAYLAND_DISPLAY) fail("WAYLAND_DISPLAY is not set, so there is no desktop to open a window on.");
  if (process.env.DESERTFOX_CONFIG_DIR || (process.env.XDG_RUNTIME_DIR ?? "").startsWith("/tmp/")) fail("this looks like the nested key-test session. Run owner-test from the owner's own session.");
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

// The reload file is written last: one write, one reload, after the build is complete.
function touch_reload_file(worktree: string, label: string): void {
  writeFileSync(join(worktree, "dist", RELOAD_FILE_NAME), `${label}\n`);
}

function real_close_deps(): CloseDeps {
  return {
    read_start_ticks: (pid) => read_start_ticks(pid),
    signal: (pid, signal) => {
      try { process.kill(pid, signal); } catch { /* already gone */ }
    },
    sleep,
    stop_unit: (unit) => void spawnSync("systemctl", ["--user", "stop", unit], { stdio: "ignore" }),
    remove_profile: (profile) => rmSync(profile, { recursive: true, force: true }),
    remove_window_files: (log, window_dir) => {
      rmSync(log, { force: true });
      try { rmdirSync(window_dir); } catch { /* not empty or gone */ }
    },
  };
}

async function close(paths: WindowPaths, roots: Roots): Promise<boolean> {
  const result = await close_window(paths.state_file, roots, real_close_deps());
  for (const line of result.lines) console.log(line);
  return result.closed;
}

function firefox_pid_for(profile: string): number | null {
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const words = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
      if (words.includes("-start-debugger-server") && words.includes(profile)) return Number(entry);
    } catch { /* the process ended */ }
  }
  return null;
}

async function probe(state: WindowState, expected_stamp: string): Promise<{ message: string; ok: boolean; permissions: string }> {
  const pid = firefox_pid_for(state.profile);
  const port = pid === null ? null : parse_debug_port(readFileSync(`/proc/${pid}/cmdline`, "utf8"));
  if (port === null) return { ok: false, message: "WRONG BUILD: no debugger port found for the test window", permissions: "" };
  const { connect_rdp, evaluate_in_background } = await import(join(REPO_ROOT, "test", "key", "rdp.mjs"));
  const rdp = await connect_rdp(port);
  try {
    const { addons } = await rdp.request("root", { type: "listAddons" });
    const addon = addons.find((entry: { id: string }) => entry.id === EXTENSION_ID);
    let loaded_stamp: string | null = null;
    let permissions = "";
    if (addon?.temporarilyInstalled === true) {
      const info = await evaluate_in_background(rdp, EXTENSION_ID, "browser.permissions.getAll().then((granted) => ({ version_name: browser.runtime.getManifest().version_name ?? null, granted }))");
      loaded_stamp = info.version_name;
      permissions = JSON.stringify(info.granted);
    }
    const verdict = judge_probe({ addon, loaded_stamp, expected_stamp });
    return { ok: verdict.ok, message: verdict.ok ? "ok" : verdict.message, permissions };
  } finally {
    rdp.close();
  }
}

async function wait_for_probe(state: WindowState, label: string, timeout_ms: number) {
  const deadline = Date.now() + timeout_ms;
  let last = { ok: false, message: "WRONG BUILD: the test window did not answer in time", permissions: "" };
  while (Date.now() < deadline) {
    try {
      last = await probe(state, label);
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

// Through a systemd user unit when possible, so the window outlives the agent's own scope and has a memory cap. Plain detached spawn otherwise.
function start_window(worktree: string, paths: WindowPaths, dist: string): { unit: string | null; pid: number } {
  const args = web_ext_args({ dist, profile: paths.profile_dir });
  const web_ext = join(worktree, "node_modules", ".bin", "web-ext");
  const unit = unit_name(paths.key);
  const env_args = ["WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DISPLAY", "HOME", "PATH", "DBUS_SESSION_BUS_ADDRESS", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]
    .filter((name) => process.env[name]).map((name) => `--setenv=${name}=${process.env[name]}`);
  const unit_run = spawnSync("systemd-run", [
    "--user", "--collect", "--quiet", `--unit=${unit}`, "-p", "MemoryMax=4G", `--working-directory=${worktree}`,
    "-p", `StandardOutput=append:${paths.log_file}`, "-p", `StandardError=append:${paths.log_file}`,
    ...env_args, "--", web_ext, ...args,
  ], { stdio: "ignore" });
  if (unit_run.status === 0) {
    const pid = Number(spawnSync("systemctl", ["--user", "show", "-p", "MainPID", "--value", unit], { encoding: "utf8" }).stdout.trim());
    return { unit, pid };
  }
  const log_fd = openSync(paths.log_file, "a");
  const child = spawn(web_ext, args, { cwd: worktree, detached: true, stdio: ["ignore", log_fd, log_fd] });
  child.unref();
  closeSync(log_fd);
  return { unit: null, pid: child.pid ?? 0 };
}

async function wait_for_install(log_file: string): Promise<boolean> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(log_file) && readFileSync(log_file, "utf8").includes("as a temporary add-on")) return true;
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

async function open(worktree: string, paths: WindowPaths, roots: Roots, hints: string[]): Promise<void> {
  check_environment();
  check_worktree(worktree);
  for (const hint of hints) {
    const checked = check_hint(hint);
    if (!checked.ok) fail(checked.error);
  }
  const label = build_and_stamp(worktree);
  // A second open on this worktree replaces its window. Other worktrees keep theirs: the state file and profile folder are keyed by worktree.
  if (existsSync(paths.state_file)) await close(paths, roots);
  check_free_space(paths.cache_root);
  mkdirSync(paths.profile_dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(paths.profile_dir, "user.js"), seed_user_js(readFileSync(join(worktree, "test", "key", "user.js"), "utf8")));
  rmSync(paths.log_file, { force: true });
  const dist = join(worktree, "dist");
  touch_reload_file(worktree, label);
  const state: WindowState = {
    worktree, profile: paths.profile_dir, log: paths.log_file, stamp: label, started: new Date().toISOString(), unit: null,
    web_ext_pid: 0, web_ext_start_ticks: 0, firefox_pid: 0, firefox_start_ticks: 0,
  };
  write_state(paths.state_file, state);
  const started = start_window(worktree, paths, dist);
  state.unit = started.unit;
  state.web_ext_pid = started.pid;
  state.web_ext_start_ticks = read_start_ticks(started.pid) ?? 0;
  write_state(paths.state_file, state);
  if (!(await wait_for_install(paths.log_file))) {
    await close(paths, roots);
    fail(`web-ext did not install the add-on in ${START_TIMEOUT_MS / 1000} s. See ${paths.log_file} (removed with the window; rerun to see it again).`);
  }
  const firefox = firefox_pid_for(paths.profile_dir);
  state.firefox_pid = firefox ?? 0;
  state.firefox_start_ticks = firefox === null ? 0 : (read_start_ticks(firefox) ?? 0);
  write_state(paths.state_file, state);
  const result = await wait_for_probe(state, label, 30_000);
  if (!result.ok) {
    console.error(result.message);
    console.error(`The window is still open. Close it with: just owner-test-close ${worktree}`);
    process.exit(1);
  }
  print_report(state, hints, result.permissions, "test window open");
}

async function reload(worktree: string, paths: WindowPaths): Promise<void> {
  const read = read_state(paths.state_file);
  if (read.kind !== "ok") fail(read.kind === "none" ? "no test window is open for this worktree. Run just owner-test first." : `the state file is unreadable: ${read.reason}`);
  const state = read.state;
  if (!is_same_process(state.web_ext_pid, state.web_ext_start_ticks)) fail("the test window is gone. Run just owner-test to open a new one.");
  const label = build_and_stamp(worktree);
  touch_reload_file(worktree, label);
  const result = await wait_for_probe(state, label, 30_000);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  state.stamp = label;
  write_state(paths.state_file, state);
  print_report(state, [], result.permissions, "test window reloaded");
}

function status(paths: WindowPaths): void {
  const read = read_state(paths.state_file);
  if (read.kind === "none") return console.log("nothing open");
  if (read.kind === "corrupt") return console.log(`state file is unreadable: ${read.reason}`);
  const alive = is_same_process(read.state.web_ext_pid, read.state.web_ext_start_ticks);
  console.log(`${alive ? "open" : "stale (its processes are gone; close cleans it)"}: ${read.state.stamp}`);
  console.log(`profile: ${read.state.profile}`);
}

const { positionals } = parseArgs({ allowPositionals: true });
const [action = "open", worktree_arg = ".", ...hints] = positionals;
const worktree = resolve(worktree_arg);
const roots = default_roots(process.env, homedir());
const paths = window_paths(worktree, roots);

try {
  if (action === "open") await open(worktree, paths, roots, hints);
  else if (action === "reload") await reload(worktree, paths);
  else if (action === "status") status(paths);
  else if (action === "close") await close(paths, roots);
  else fail(`unknown action ${action}. Use open, reload, status or close.`);
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`owner-test: ${error.message}`);
  process.exit(1);
}

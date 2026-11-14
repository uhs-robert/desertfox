import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { close_window, type CloseDeps } from "../tools/owner_test/close.ts";
import { check_hint } from "../tools/owner_test/hints.ts";
import { is_strictly_inside, window_paths, worktree_key, type Roots } from "../tools/owner_test/paths.ts";
import { judge_probe } from "../tools/owner_test/probe.ts";
import { is_same_process, parse_debug_port, parse_start_ticks, read_start_ticks } from "../tools/owner_test/process_guard.ts";
import { seed_user_js } from "../tools/owner_test/profile.ts";
import { read_state, write_state, type WindowState } from "../tools/owner_test/state.ts";
import { stamp_manifest, web_ext_args } from "../tools/owner_test/web_ext.ts";
import { make_tmp_dir } from "./support/tmp_dir.ts";

function make_roots(t: test.TestContext): Roots {
  const base = make_tmp_dir("desertfox-owner-test-", t);
  return { state_home: join(base, "state"), cache_home: join(base, "cache") };
}

// A window on disk: state file, profile folder with a file in it, and the log.
function make_window(worktree: string, roots: Roots, patch: Partial<WindowState> = {}) {
  const paths = window_paths(worktree, roots);
  mkdirSync(paths.profile_dir, { recursive: true });
  writeFileSync(join(paths.profile_dir, "prefs.js"), "x");
  writeFileSync(paths.log_file, "log");
  const state: WindowState = {
    worktree, profile: paths.profile_dir, log: paths.log_file, stamp: "s", started: "now", unit: null,
    web_ext_pid: 4001, web_ext_start_ticks: 111, firefox_pid: 4002, firefox_start_ticks: 222, ...patch,
  };
  write_state(paths.state_file, state);
  return { paths, state };
}

// Fake system: `ticks` maps a live pid to its start ticks. A SIGTERM ends the process unless `ignore_term` names it.
function fake_system(ticks: Map<number, number>, ignore_term = new Set<number>()) {
  const signals: string[] = [];
  const removed: string[] = [];
  const stopped_units: string[] = [];
  const deps: CloseDeps = {
    read_start_ticks: (pid) => ticks.get(pid) ?? null,
    signal: (pid, signal) => {
      signals.push(`${signal} ${pid}`);
      if (signal === "SIGKILL" || !ignore_term.has(pid)) ticks.delete(pid);
    },
    sleep: async () => {},
    stop_unit: (unit) => void stopped_units.push(unit),
    remove_profile: (profile) => void removed.push(profile),
    remove_window_files: () => {},
    grace_ms: 300,
  };
  return { deps, signals, removed, stopped_units };
}

test("close signals a process whose start ticks match", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots);
  const system = fake_system(new Map([[4001, 111], [4002, 222]]));
  const result = await close_window(paths.state_file, roots, system.deps);
  assert.deepEqual(system.signals, ["SIGTERM 4001", "SIGTERM 4002"]);
  assert.equal(result.closed, true);
  assert.equal(existsSync(paths.state_file), false);
});

test("close never signals a recycled pid", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots);
  // Both pids now belong to other processes with other start ticks.
  const system = fake_system(new Map([[4001, 999], [4002, 998]]));
  const result = await close_window(paths.state_file, roots, system.deps);
  assert.deepEqual(system.signals, []);
  assert.match(result.lines.join("\n"), /now belongs to another process/);
  assert.equal(existsSync(paths.state_file), false);
});

test("close does not SIGKILL a pid that was recycled during the grace wait", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots);
  const ticks = new Map([[4001, 111]]);
  const system = fake_system(ticks, new Set([4001]));
  // The original process ends on SIGTERM's heels and another one takes its pid.
  system.deps.sleep = async () => void ticks.set(4001, 777);
  await close_window(paths.state_file, roots, system.deps);
  assert.deepEqual(system.signals, ["SIGTERM 4001"]);
});

test("close escalates to SIGKILL when the process ignores SIGTERM", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots);
  const system = fake_system(new Map([[4001, 111], [4002, 222]]), new Set([4002]));
  await close_window(paths.state_file, roots, system.deps);
  assert.deepEqual(system.signals, ["SIGTERM 4001", "SIGTERM 4002", "SIGKILL 4002"]);
});

test("a stale state file with dead processes is cleaned and nothing is killed", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots);
  const system = fake_system(new Map());
  const result = await close_window(paths.state_file, roots, system.deps);
  assert.deepEqual(system.signals, []);
  assert.deepEqual(system.removed, [paths.profile_dir]);
  assert.equal(result.closed, true);
  assert.equal(existsSync(paths.state_file), false);
});

test("a state that never started a process kills nothing", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots, { web_ext_pid: 0, web_ext_start_ticks: 0, firefox_pid: 0, firefox_start_ticks: 0 });
  const system = fake_system(new Map([[1, 1]]));
  await close_window(paths.state_file, roots, system.deps);
  assert.deepEqual(system.signals, []);
});

test("close with no state file says nothing is open", async (t) => {
  const roots = make_roots(t);
  const result = await close_window(window_paths("/w/a", roots).state_file, roots, fake_system(new Map()).deps);
  assert.deepEqual(result, { lines: ["nothing open"], closed: false });
});

test("close deletes only the profile its own worktree maps to", async (t) => {
  const roots = make_roots(t);
  const outside = make_tmp_dir("desertfox-owner-test-outside-", t);
  const own = window_paths("/w/a", roots);
  const other = window_paths("/w/b", roots);
  const bad_profiles = [outside, roots.cache_home, own.cache_root, other.profile_dir, join(own.profile_dir, ".."), join(own.cache_root, "..", "x"), "/", "/home"];
  for (const profile of bad_profiles) {
    make_window("/w/a", roots, { profile });
    const system = fake_system(new Map());
    const result = await close_window(own.state_file, roots, system.deps);
    assert.deepEqual(system.removed, [], `deleted for ${profile}`);
    assert.match(result.lines.join("\n"), /left alone/);
  }
});

test("close treats a corrupt state file as untrusted and deletes nothing", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots);
  writeFileSync(paths.state_file, '{"worktree": "/w/a", "profile": "/", "web_ext_pid": "1"');
  const system = fake_system(new Map([[1, 1]]));
  const result = await close_window(paths.state_file, roots, system.deps);
  assert.deepEqual([system.signals, system.removed], [[], []]);
  assert.equal(result.closed, false);
  assert.equal(existsSync(paths.state_file), false);
});

test("two worktrees keep separate state, profile and unit names", async (t) => {
  const roots = make_roots(t);
  const a = make_window("/w/a", roots, { web_ext_pid: 10, firefox_pid: 11 });
  const b = make_window("/w/b", roots, { web_ext_pid: 20, firefox_pid: 21 });
  assert.notEqual(a.paths.state_file, b.paths.state_file);
  assert.notEqual(a.paths.profile_dir, b.paths.profile_dir);
  assert.notEqual(worktree_key("/x/one/repo"), worktree_key("/x/two/repo"));
  // Closing a leaves b's state, profile and processes alone.
  const system = fake_system(new Map([[10, 111], [11, 222], [20, 111], [21, 222]]));
  await close_window(a.paths.state_file, roots, system.deps);
  assert.deepEqual(system.signals, ["SIGTERM 10", "SIGTERM 11"]);
  assert.deepEqual(system.removed, [a.paths.profile_dir]);
  const still = read_state(b.paths.state_file);
  assert.equal(still.kind === "ok" && still.state.web_ext_pid, 20);
  assert.equal(existsSync(b.paths.profile_dir), true);
});

test("a second close after a close is a no-op", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots);
  const system = fake_system(new Map());
  await close_window(paths.state_file, roots, system.deps);
  const again = await close_window(paths.state_file, roots, system.deps);
  assert.equal(again.lines[0], "nothing open");
});

test("path guard: strictly inside, no root, no escape", () => {
  assert.equal(is_strictly_inside("/c/root", "/c/root/a/profile"), true);
  assert.equal(is_strictly_inside("/c/root", "/c/root"), false);
  assert.equal(is_strictly_inside("/c/root", "/c/rootx/a"), false);
  assert.equal(is_strictly_inside("/c/root", "/c/root/../other"), false);
});

test("state file: written atomically with mode 0600, read back, corrupt reported", (t) => {
  const roots = make_roots(t);
  const { paths, state } = make_window("/w/a", roots);
  assert.equal(statSync(paths.state_file).mode & 0o777, 0o600);
  assert.deepEqual(read_state(paths.state_file), { kind: "ok", state });
  writeFileSync(paths.state_file, "{not json");
  assert.equal(read_state(paths.state_file).kind, "corrupt");
  writeFileSync(paths.state_file, JSON.stringify({ ...state, web_ext_pid: "7" }));
  assert.equal(read_state(paths.state_file).kind, "corrupt");
  assert.equal(read_state(join(paths.state_file, "..", "missing.json")).kind, "none");
});

test("process guard reads this process's own start ticks and rejects a wrong count", () => {
  const ticks = read_start_ticks(process.pid);
  assert.ok(ticks !== null && ticks > 0);
  assert.equal(is_same_process(process.pid, ticks), true);
  assert.equal(is_same_process(process.pid, ticks + 1), false);
  assert.equal(is_same_process(process.pid, 0), false);
  assert.equal(is_same_process(999_999_999, 5), false);
});

test("start ticks parse past a command name with spaces and parentheses", () => {
  const rest = Array.from({ length: 50 }, (_, index) => String(index + 3));
  rest[19] = "424242";
  assert.equal(parse_start_ticks(`123 (my (odd) name) ${rest.join(" ")}`), 424242);
  assert.equal(parse_start_ticks("123 (short) S 1"), null);
});

test("debug port comes from the Firefox command line", () => {
  assert.equal(parse_debug_port(["firefox", "-profile", "/p", "-start-debugger-server", "6123", "-no-remote"].join("\0")), 6123);
  assert.equal(parse_debug_port("firefox\0-no-remote"), null);
});

test("seed drops the two page prefs and the notification line, keeps the rest", () => {
  const base = readFileSync(join(import.meta.dirname, "key", "user.js"), "utf8");
  const seeded = seed_user_js(base);
  for (const name of ["browser.newtabpage.enabled", "browser.startup.page", "alerts.useSystemBackend"]) assert.ok(!seeded.includes(`"${name}"`), name);
  assert.ok(seeded.includes('"extensions.autoDisableScopes", 0'));
  assert.ok(seeded.includes('"browser.aboutwelcome.enabled"'));
  assert.ok(seeded.includes('"browser.cache.disk.enable", false'));
  assert.ok(!seeded.includes("//"));
  // A reordered file seeds the same.
  assert.equal(seed_user_js('user_pref("browser.startup.page", 0);\nuser_pref("a.b", 1);'), 'user_pref("a.b", 1);\n' + seed_user_js("").trim() + "\n");
});

test("hints: accept a valid set, reject unknown names, bad values and non-set lines", () => {
  assert.equal(check_hint(":set newtab_weather true").ok, true);
  assert.equal(check_hint(":set which_key_border round").ok, true);
  for (const bad of [":set no_such_setting true", ":set newtab_weather maybe", ":set which_key_border triangle", "set newtab_weather true", ":set newtab_weather", ":map x y"]) {
    assert.equal(check_hint(bad).ok, false, bad);
  }
});

test("web-ext arguments keep the profile, take no input, stay out of the running Firefox and watch one file", () => {
  const args = web_ext_args({ dist: "/w/a/dist", profile: "/p" });
  for (const wanted of ["--keep-profile-changes", "--no-input", "--args=-no-remote"]) assert.ok(args.includes(wanted), wanted);
  assert.equal(args[args.indexOf("--watch-file") + 1], "/w/a/dist/.owner-test-reload");
  assert.equal(args[args.indexOf("--firefox-profile") + 1], "/p");
  assert.ok(!args.includes("--no-reload"));
});

test("stamp sets version_name and leaves version", () => {
  assert.deepEqual(stamp_manifest({ version: "0.1.24", name: "x" }, "owner-test b@abc"), { version: "0.1.24", name: "x", version_name: "owner-test b@abc" });
});

test("probe: the stamped temporary add-on passes, the policy beta and a stale stamp fail", () => {
  const stamp = "owner-test b@abc t1";
  assert.deepEqual(judge_probe({ addon: { id: "x", temporarilyInstalled: true }, loaded_stamp: stamp, expected_stamp: stamp }), { ok: true });
  const beta = judge_probe({ addon: { id: "x", temporarilyInstalled: false, version: "0.1.24.3" }, loaded_stamp: null, expected_stamp: stamp });
  assert.ok(!beta.ok && /WRONG BUILD.*0\.1\.24\.3/.test(beta.message));
  assert.equal(judge_probe({ addon: { id: "x", temporarilyInstalled: true }, loaded_stamp: "owner-test b@abc t0", expected_stamp: stamp }).ok, false);
  assert.equal(judge_probe({ addon: undefined, loaded_stamp: null, expected_stamp: stamp }).ok, false);
});

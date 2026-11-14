import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { close_window, type CloseDeps } from "../tools/owner_test/close.ts";
import { check_hint } from "../tools/owner_test/hints.ts";
import { canonical_worktree, is_strictly_inside, unit_name, window_paths, worktree_key, type Roots } from "../tools/owner_test/paths.ts";
import { judge_probe } from "../tools/owner_test/probe.ts";
import { is_same_process, parse_debug_port, parse_start_ticks, read_start_ticks } from "../tools/owner_test/process_guard.ts";
import { seed_user_js } from "../tools/owner_test/profile.ts";
import { read_state, write_state, type WindowState } from "../tools/owner_test/state.ts";
import { stamp_manifest, tail_lines, web_ext_args } from "../tools/owner_test/web_ext.ts";
import { flock_argv, LOCK_BUSY_EXIT } from "../tools/owner_test/lock.ts";
import { Refusal } from "../tools/owner_test/refusal.ts";
import { spawn } from "node:child_process";
import { probe_window, reload_window } from "../tools/owner_test/rdp_probe.ts";
import net from "node:net";
import { symlinkSync } from "node:fs";
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
    stop_unit: (unit) => {
      stopped_units.push(unit);
      return true;
    },
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
  const result = await close_window(paths, system.deps);
  assert.deepEqual(system.signals, ["SIGTERM 4001", "SIGTERM 4002"]);
  assert.equal(result.closed, true);
  assert.equal(existsSync(paths.state_file), false);
});

test("close never signals a recycled pid", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots);
  // Both pids now belong to other processes with other start ticks.
  const system = fake_system(new Map([[4001, 999], [4002, 998]]));
  const result = await close_window(paths, system.deps);
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
  await close_window(paths, system.deps);
  assert.deepEqual(system.signals, ["SIGTERM 4001"]);
});

test("close escalates to SIGKILL when the process ignores SIGTERM", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots);
  const system = fake_system(new Map([[4001, 111], [4002, 222]]), new Set([4002]));
  await close_window(paths, system.deps);
  assert.deepEqual(system.signals, ["SIGTERM 4001", "SIGTERM 4002", "SIGKILL 4002"]);
});

test("a stale state file with dead processes is cleaned and nothing is killed", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots);
  const system = fake_system(new Map());
  const result = await close_window(paths, system.deps);
  assert.deepEqual(system.signals, []);
  assert.deepEqual(system.removed, [paths.profile_dir]);
  assert.equal(result.closed, true);
  assert.equal(existsSync(paths.state_file), false);
});

test("a record with no pids is proof only when a recorded unit is confirmed stopped", async (t) => {
  const roots = make_roots(t);
  const no_pids = { web_ext_pid: 0, web_ext_start_ticks: 0, firefox_pid: 0, firefox_start_ticks: 0 };
  // Plain spawn (no unit): the record proves nothing, so the profile and state stay.
  const plain = make_window("/w/a", roots, no_pids);
  const plain_system = fake_system(new Map([[1, 1]]));
  const plain_result = await close_window(plain.paths, plain_system.deps);
  assert.deepEqual([plain_result.complete, plain_system.signals, plain_system.removed], [false, [], []]);
  assert.equal(existsSync(plain.paths.state_file), true);
  // A unit that is confirmed gone: carry on and clean up.
  const unit = make_window("/w/b", roots, { ...no_pids, unit: "u" });
  const unit_system = fake_system(new Map());
  const unit_result = await close_window(unit.paths, unit_system.deps);
  assert.deepEqual([unit_result.complete, unit_system.removed], [true, [unit.paths.profile_dir]]);
  // A unit that still runs after the stop: incomplete.
  const stuck = make_window("/w/c", roots, { ...no_pids, unit: "u" });
  const stuck_system = fake_system(new Map());
  stuck_system.deps.stop_unit = () => false;
  assert.equal((await close_window(stuck.paths, stuck_system.deps)).complete, false);
  assert.equal(existsSync(stuck.paths.profile_dir), true);
});

test("a record of another worktree signals nothing, even when its pids match live processes", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots, { worktree: "/w/b" });
  const system = fake_system(new Map([[4001, 111], [4002, 222]]));
  const result = await close_window(paths, system.deps);
  assert.deepEqual([system.signals, system.removed, result.complete], [[], [], false]);
  assert.match(result.lines.join("\n"), /another worktree/);
  assert.equal(existsSync(paths.state_file), true);
});

test("a worktree whose name starts with two dots keys and guards like any other", () => {
  assert.equal(is_strictly_inside("/c/root", "/c/root/..review/profile"), true);
  assert.equal(is_strictly_inside("/c/root", "/c/root/../review"), false);
  assert.match(worktree_key("/x/..review"), /^\.\.review-[0-9a-f]{10}$/);
});

test("close with no state file says nothing is open", async (t) => {
  const roots = make_roots(t);
  const result = await close_window(window_paths("/w/a", roots), fake_system(new Map()).deps);
  assert.deepEqual(result, { lines: ["nothing open"], closed: false, complete: true });
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
    const result = await close_window(own, system.deps);
    assert.deepEqual(system.removed, [], `deleted for ${profile}`);
    assert.match(result.lines.join("\n"), /left alone|nothing was signalled/);
  }
});

test("close treats a corrupt state file as untrusted and deletes nothing", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots);
  writeFileSync(paths.state_file, '{"worktree": "/w/a", "profile": "/", "web_ext_pid": "1"');
  const system = fake_system(new Map([[1, 1]]));
  const result = await close_window(paths, system.deps);
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
  await close_window(a.paths, system.deps);
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
  await close_window(paths, system.deps);
  const again = await close_window(paths, system.deps);
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
  for (const name of ["browser.newtabpage.enabled", "alerts.useSystemBackend"]) assert.ok(!seeded.includes(`"${name}"`), name);
  assert.ok(seeded.includes('"extensions.autoDisableScopes", 0'));
  assert.ok(seeded.includes('"browser.aboutwelcome.enabled"'));
  assert.ok(seeded.includes('"browser.cache.disk.enable", false'));
  assert.ok(seeded.includes('user_pref("browser.startup.page", 1);'));
  assert.ok(!seeded.includes("//"));
  // A reordered file seeds the same.
  assert.ok(!seed_user_js('user_pref("browser.startup.page", 0);').includes("startup.page\", 0"));
});

test("hints: accept a valid set, reject unknown names, bad values and non-set lines", () => {
  assert.equal(check_hint(":set newtab_weather true").ok, true);
  assert.equal(check_hint(":set which_key_border round").ok, true);
  for (const bad of [":set no_such_setting true", ":set newtab_weather maybe", ":set which_key_border triangle", "set newtab_weather true", ":set newtab_weather", ":map x y"]) {
    assert.equal(check_hint(bad).ok, false, bad);
  }
});

test("web-ext arguments keep the profile, take no input, stay out of the running Firefox, reload by hand and keep the start page", () => {
  const args = web_ext_args({ dist: "/w/a/dist", profile: "/p" });
  for (const wanted of ["--keep-profile-changes", "--no-input", "--args=-no-remote"]) assert.ok(args.includes(wanted), wanted);
  assert.ok(args.includes("--no-reload"), "web-ext's own watcher stays off");
  assert.ok(!args.includes("--watch-file"));
  assert.ok(args.includes("--pref=browser.startup.page=1") && args.includes("--pref=browser.startup.homepage=about:home"));
  assert.equal(args[args.indexOf("--firefox-profile") + 1], "/p");
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

test("close stops its own unit by name even when the state is corrupt or missing, and ignores a unit named in the file", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots, { unit: "desertfox-owner-test-other-0000000000" });
  const stopped_ok = fake_system(new Map());
  await close_window(paths, stopped_ok.deps);
  assert.deepEqual(stopped_ok.stopped_units, [unit_name(paths.key)]);
  writeFileSync(paths.state_file, "{broken");
  const stopped_corrupt = fake_system(new Map());
  await close_window(paths, stopped_corrupt.deps);
  assert.deepEqual(stopped_corrupt.stopped_units, [unit_name(paths.key)]);
});

test("close ignores the worktree named in the state file and uses the caller's", async (t) => {
  const roots = make_roots(t);
  const victim = window_paths("/w/b", roots);
  // A state file filed under a, naming b's profile: nothing of b is deleted.
  const { paths } = make_window("/w/a", roots, { worktree: "/w/b", profile: victim.profile_dir });
  const system = fake_system(new Map());
  await close_window(paths, system.deps);
  assert.deepEqual(system.removed, []);
});

test("a symlinked worktree maps to the same window as its real path", (t) => {
  const base = make_tmp_dir("desertfox-owner-test-link-", t);
  mkdirSync(join(base, "real"));
  symlinkSync(join(base, "real"), join(base, "link"));
  assert.equal(worktree_key(canonical_worktree(join(base, "link"))), worktree_key(canonical_worktree(join(base, "real"))));
});

// Runs a short script under flock(1) with the cli's own arguments. The script logs start and end with a pause between, so overlap shows in the log.
function run_locked(lock_file: string, log_file: string, name: string, wait_seconds = 10) {
  const script = `const fs = require("node:fs"); fs.appendFileSync(process.argv[1], process.argv[2] + " start\\n"); setTimeout(() => { fs.appendFileSync(process.argv[1], process.argv[2] + " end\\n"); }, 400);`;
  return spawn("flock", flock_argv(lock_file, [process.execPath, "-e", script, log_file, name], wait_seconds), { stdio: "ignore" });
}
const exit_of = (child: ReturnType<typeof spawn>) => new Promise<number | null>((done) => child.on("exit", done));

test("lock: two calls on one worktree run one after the other", async (t) => {
  const dir = make_tmp_dir("desertfox-owner-test-lock-", t);
  const log_file = join(dir, "log");
  const children = [run_locked(join(dir, "w.lock"), log_file, "a"), run_locked(join(dir, "w.lock"), log_file, "b")];
  await Promise.all(children.map(exit_of));
  const events = readFileSync(log_file, "utf8").trim().split("\n").map((line) => line.split(" ")[1]);
  assert.deepEqual(events, ["start", "end", "start", "end"]);
});

test("lock: two worktrees do not block each other", async (t) => {
  const dir = make_tmp_dir("desertfox-owner-test-lock-", t);
  const log_file = join(dir, "log");
  const children = [run_locked(join(dir, "a.lock"), log_file, "a"), run_locked(join(dir, "b.lock"), log_file, "b")];
  await Promise.all(children.map(exit_of));
  const events = readFileSync(log_file, "utf8").trim().split("\n").map((line) => line.split(" ")[1]);
  assert.deepEqual(events.slice(0, 2), ["start", "start"]);
});

test("lock: a call that waits too long exits with the busy code, and a dead holder leaves no stale lock", async (t) => {
  const dir = make_tmp_dir("desertfox-owner-test-lock-", t);
  const lock_file = join(dir, "w.lock");
  const holder = spawn("flock", flock_argv(lock_file, ["sleep", "30"]), { stdio: "ignore" });
  await new Promise((done) => setTimeout(done, 300));
  const waiter = spawn("flock", flock_argv(lock_file, ["true"], 1), { stdio: "ignore" });
  assert.equal(await exit_of(waiter), LOCK_BUSY_EXIT);
  // The holder is our own child. Killing it stands in for a crashed call: the kernel frees the lock.
  holder.kill("SIGKILL");
  await exit_of(holder);
  assert.equal(await exit_of(spawn("flock", flock_argv(lock_file, ["true"], 5), { stdio: "ignore" })), 0);
});

test("lock: the command does not inherit the lock fd, so a child it starts does not hold the lock", async (t) => {
  const dir = make_tmp_dir("desertfox-owner-test-lock-", t);
  const lock_file = join(dir, "w.lock");
  // The command starts a long-lived child and exits at once, like open does with the window.
  const starter = spawn("flock", flock_argv(lock_file, ["sh", "-c", "sleep 30 & echo $! > " + join(dir, "pid")]), { stdio: "ignore" });
  await exit_of(starter);
  const later = spawn("flock", flock_argv(lock_file, ["true"], 3), { stdio: "ignore" });
  assert.equal(await exit_of(later), 0);
  process.kill(Number(readFileSync(join(dir, "pid"), "utf8")), "SIGKILL");
});

// A debugger that takes the connection and never says anything.
async function silent_debugger(t: test.TestContext): Promise<number> {
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => void sockets.push(socket));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => {
    sockets.forEach((socket) => socket.destroy());
    server.close();
  });
  return (server.address() as net.AddressInfo).port;
}

test("probe and reload fail within their deadline against a debugger that never answers", async (t) => {
  const port = await silent_debugger(t);
  for (const call of [() => probe_window(port, "stamp", 600), () => reload_window(port, 600)]) {
    const started = Date.now();
    await assert.rejects(call());
    assert.ok(Date.now() - started < 3000, "failed late");
  }
});

test("reload sends the reload request to the add-on's actor", async (t) => {
  const received: Array<{ to: string; type?: string }> = [];
  const frame = (packet: object) => { const text = JSON.stringify(packet); return Buffer.from(`${Buffer.byteLength(text)}:${text}`); };
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.write(frame({ from: "root", applicationType: "browser" }));
    let pending = "";
    socket.on("data", (chunk) => {
      pending += chunk.toString();
      const colon = pending.indexOf(":");
      const length = Number(pending.slice(0, colon));
      if (colon < 0 || pending.length < colon + 1 + length) return;
      const packet = JSON.parse(pending.slice(colon + 1, colon + 1 + length));
      pending = pending.slice(colon + 1 + length);
      received.push(packet);
      if (packet.type === "listAddons") socket.write(frame({ from: "root", addons: [{ id: "desertfox@uhs-robert", actor: "addon1", temporarilyInstalled: true }] }));
      else socket.write(frame({ from: packet.to }));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => { sockets.forEach((socket) => socket.destroy()); server.close(); });
  await reload_window((server.address() as net.AddressInfo).port, 3000);
  assert.deepEqual(received.map((packet) => `${packet.to} ${packet.type}`), ["root listAddons", "addon1 reload"]);
});

test("tail_lines keeps the last lines", () => {
  assert.equal(tail_lines("a\nb\nc\n", 2), "b\nc");
});

test("close waits for the process to be gone after SIGKILL, and keeps the profile and state if it stays", async (t) => {
  const roots = make_roots(t);
  const { paths } = make_window("/w/a", roots);
  // Stubborn: SIGKILL takes effect only after three polls.
  const ticks = new Map([[4001, 111], [4002, 222]]);
  const system = fake_system(ticks, new Set([4002]));
  let polls_after_kill = 0;
  const kill_signal = system.deps.signal;
  let killed = false;
  system.deps.signal = (pid, signal) => {
    system.signals.push(`${signal} ${pid}`);
    if (pid === 4001) ticks.delete(pid);
    if (signal === "SIGKILL" && pid === 4002) killed = true;
    void kill_signal;
  };
  system.deps.sleep = async () => {
    if (killed && ++polls_after_kill >= 3) ticks.delete(4002);
  };
  const slow = await close_window(paths, system.deps);
  assert.equal(slow.closed, true);

  const { paths: other } = make_window("/w/b", roots, { web_ext_pid: 5001, firefox_pid: 5002 });
  const immortal = new Map([[5001, 111], [5002, 222]]);
  const stuck = fake_system(immortal);
  stuck.deps.signal = (pid, signal) => void stuck.signals.push(`${signal} ${pid}`);
  stuck.deps.kill_wait_ms = 300;
  const result = await close_window(other, stuck.deps);
  assert.equal(result.closed, false);
  assert.match(result.lines.join("\n"), /still running after SIGKILL/);
  assert.deepEqual(stuck.removed, []);
  assert.equal(existsSync(other.state_file), true);
  assert.equal(existsSync(other.profile_dir), true);
});

test("probe exits on its own when the TCP connect never completes", async (t) => {
  // A listener whose event loop is blocked never accepts, so once its backlog is full further connects hang.
  const listener_script = `const net = require("node:net"); const server = net.createServer(); server.listen({ port: 0, host: "127.0.0.1", backlog: 1 }, () => { console.log(server.address().port); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); });`;
  const listener = spawn(process.execPath, ["-e", listener_script], { stdio: ["ignore", "pipe", "ignore"] });
  t.after(() => void listener.kill("SIGKILL"));
  const port = Number(await new Promise<string>((done) => listener.stdout.once("data", (chunk) => done(String(chunk).trim()))));
  const fillers = Array.from({ length: 6 }, () => net.connect(port, "127.0.0.1").on("error", () => {}));
  t.after(() => fillers.forEach((socket) => socket.destroy()));
  await new Promise((done) => setTimeout(done, 300));
  const probe_script = `import { probe_window } from ${JSON.stringify(join(import.meta.dirname, "..", "tools", "owner_test", "rdp_probe.ts"))}; probe_window(${port}, "stamp", 600).then(() => console.log("passed"), (error) => console.log("rejected " + error.constructor.name));`;
  const started = Date.now();
  const child = spawn(process.execPath, ["--no-warnings", "--input-type=module", "-e", probe_script], { stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  const code = await exit_of(child);
  assert.equal(code, 0);
  assert.equal(output.trim(), "rejected Refusal");
  assert.ok(Date.now() - started < 5000, "the child lingered");
});

test("a reload that the debugger does not answer is a Refusal, not a stack trace", async (t) => {
  const port = await silent_debugger(t);
  await assert.rejects(reload_window(port, 400), Refusal);
});

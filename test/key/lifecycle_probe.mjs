// Lifecycle probes of the key-test coordinator: signals at startup and mid-run, a killed worker, a crashed Firefox,
// the deadline, distinct debug ports, a sweep that spares a live run, and a SIGKILLed run that the next run cleans up.
// Each probe runs a real, small run.mjs and checks the exit code, the output, the merged report's `incomplete` field,
// and that nothing is left in /tmp or running. Run it through `just key-test-lifecycle`, which takes the key-test lock.
// `node test/key/lifecycle_probe.mjs [probe name...]` runs the named probes, or all of them.
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run_execfile = promisify(execFile);
const key_test_dir = dirname(fileURLToPath(import.meta.url));
const repo_dir = resolve(key_test_dir, "../..");
const RUNTIME_PREFIX = `dfk-${process.getuid()}-`;
const RUN_DIR_PREFIX = "desertfox-key-run-";
const SHARDS = 3;
const SHARD_STAGGER_MS = 300;
// p0_core_keys is the longest piece, so the first shard is mid-piece for a while. No p11_find: its own flake is not a lifecycle matter.
const LONG_PIECES = "p0_core_keys,p9_tabs_bookmarks,p3_tab_keys,p3_scroll_zoom,p13_help_command,p15_follow";
const SHORT_PIECES = "p3_scroll_zoom";
const RUN_LIMIT_MS = 120000;
const SETTLE_MS = 15000;

const sleep = (ms) => new Promise((resolve_sleep) => setTimeout(resolve_sleep, ms));

async function wait_for(what, check, timeout_ms) {
  const deadline = Date.now() + timeout_ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout_ms} ms waiting for ${what}`);
    await sleep(50);
  }
}

function read_proc(pid, file) {
  try {
    return readFileSync(`/proc/${pid}/${file}`, "latin1");
  } catch {
    return undefined;
  }
}

const all_pids = () => readdirSync("/proc").filter((entry) => /^\d+$/.test(entry)).map(Number).filter((pid) => pid !== process.pid);
const environ_of = (pid) => Object.fromEntries((read_proc(pid, "environ") ?? "").split("\0").filter((pair) => pair.includes("=")).map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]));
const parent_of = (pid) => {
  const stat = read_proc(pid, "stat");
  return stat === undefined ? undefined : Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
};

// The worker processes of one coordinator, with the shard number and debug port the coordinator gave each.
function workers_of(coordinator_pid) {
  return all_pids().filter((pid) => parent_of(pid) === coordinator_pid && (read_proc(pid, "cmdline") ?? "").includes("worker.mjs")).map((pid) => {
    const environ = environ_of(pid);
    return { pid, shard: Number(environ.KEY_TEST_STARTUP_DELAY_MS) / SHARD_STAGGER_MS + 1, debug_port: Number(environ.KEY_TEST_DEBUG_PORT), runtime_dir: `/tmp/${RUNTIME_PREFIX}ok${pid.toString(36)}` };
  });
}

// The main Firefox process of one session: it carries the session's runtime dir, and its parent is not a Firefox.
function firefox_of(runtime_dir) {
  return all_pids().find((pid) => read_proc(pid, "comm")?.trim() === "firefox" && environ_of(pid).XDG_RUNTIME_DIR === runtime_dir && read_proc(parent_of(pid), "comm")?.trim() !== "firefox");
}

const tmp_entries = () => readdirSync("/tmp").filter((name) => name.startsWith(RUNTIME_PREFIX) || name.startsWith(RUN_DIR_PREFIX));

// Processes of a key-test run: anything that carries a session dir, and any run.mjs or worker.mjs of this checkout.
function stray_processes() {
  return all_pids().filter((pid) => {
    const environ = environ_of(pid);
    if (Object.values(environ).some((value) => value.startsWith(`/tmp/${RUNTIME_PREFIX}`))) return true;
    const cmdline = read_proc(pid, "cmdline") ?? "";
    return cmdline.includes(join(key_test_dir, "run.mjs")) || cmdline.includes(join(key_test_dir, "worker.mjs"));
  });
}

// Runs started and not yet exited, so a probe that fails early does not leave one running.
const live_runs = new Set();

async function stop_live_runs() {
  for (const pid of live_runs) {
    try { process.kill(-pid, "SIGINT"); } catch { /* gone */ }
  }
  await wait_for("started runs to exit", () => live_runs.size === 0, 30000).catch(() => {
    for (const pid of live_runs) {
      try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
    }
  });
}

// Starts run.mjs in its own process group, so a signal to -pid is a Ctrl-C of the whole run.
function start_run({ pieces = LONG_PIECES, shards = SHARDS, deadline_s, work_dir }) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("KEY_TEST_")));
  Object.assign(env, { KEY_TEST_PIECES: pieces, KEY_TEST_SHARDS: String(shards), KEY_TEST_TIMINGS_FILE: join(work_dir, "timings.json") });
  if (deadline_s) env.KEY_TEST_DEADLINE_S = String(deadline_s);
  const child = spawn(process.execPath, [join(key_test_dir, "run.mjs")], { cwd: repo_dir, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const lines = [];
  const waiters = [];
  const on_line = (line) => {
    lines.push(line);
    for (const waiter of [...waiters]) if (waiter.pattern.test(line)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(line); }
  };
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on("line", on_line);
  const exited = new Promise((resolve_exit) => child.on("exit", (code, signal) => resolve_exit({ code, signal })));
  let exit_result;
  live_runs.add(child.pid);
  exited.then((result) => { exit_result = result; live_runs.delete(child.pid); });
  return {
    pid: child.pid,
    lines,
    timings_path: env.KEY_TEST_TIMINGS_FILE,
    exited,
    has_exited: () => exit_result !== undefined,
    // Resolves with the first output line that matches, including lines that came before the call.
    line_matching(pattern, timeout_ms = 60000) {
      const seen = lines.find((line) => pattern.test(line));
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve_line, reject_line) => {
        const timer = setTimeout(() => reject_line(new Error(`no output line matched ${pattern} within ${timeout_ms} ms`)), timeout_ms);
        waiters.push({ pattern, resolve: (line) => { clearTimeout(timer); resolve_line(line); } });
      });
    },
    signal_group: (signal) => process.kill(-child.pid, signal),
    signal_coordinator: (signal) => process.kill(child.pid, signal),
  };
}

async function finish(run) {
  const timer = setTimeout(() => { try { run.signal_group("SIGKILL"); } catch { /* gone */ } }, RUN_LIMIT_MS);
  const exit = await run.exited;
  clearTimeout(timer);
  const output = run.lines.join("\n");
  let report;
  try {
    report = JSON.parse(readFileSync(run.timings_path, "utf8"));
  } catch {
    report = undefined;
  }
  return { ...exit, output, report };
}

// Nothing of the run stays in /tmp or in the process table. Processes get a moment to go after the coordinator exits.
async function assert_nothing_left() {
  await wait_for("the run's processes and folders to go", () => tmp_entries().length === 0 && stray_processes().length === 0, SETTLE_MS).catch(() => undefined);
  const problems = [];
  if (tmp_entries().length > 0) problems.push(`left in /tmp: ${tmp_entries().join(", ")}`);
  const strays = stray_processes();
  if (strays.length > 0) problems.push(`still running: ${strays.map((pid) => `${pid} ${(read_proc(pid, "cmdline") ?? "").replaceAll("\0", " ").slice(0, 80)}`).join("; ")}`);
  return problems;
}

function check(problems, condition, message) {
  if (!condition) problems.push(message);
}

function check_stopped_by(problems, result, { signal_name, exit_code }) {
  check(problems, result.code === exit_code, `exit code ${result.code} (signal ${result.signal}), want ${exit_code}`);
  check(problems, result.output.includes(`key-test: stopping all shards: received ${signal_name}`), `no "stopping all shards: received ${signal_name}" line`);
  check(problems, /key-test incomplete \(received /.test(result.output), 'no "key-test incomplete" line');
  check(problems, result.report?.incomplete?.reason === `received ${signal_name}`, `report.incomplete.reason is ${JSON.stringify(result.report?.incomplete?.reason)}`);
  // Only the coordinator's own FAIL lines count (a worker died, a startup failed). A case or piece step in flight when the signal lands prints an "[sN] FAIL" line as its session is torn down, which is the stop itself.
  const fail_line = result.output.split("\n").find((line) => /^FAIL /.test(line));
  check(problems, fail_line === undefined, `a signal stop printed a FAIL line: ${fail_line}`);
}

const first_case_line = /\[s\d+\] (PASS|FAIL) /;

// A signal after the run printed its piece count lands while the workers start their sessions.
function startup_probe({ signal, signal_name, exit_code, delay_ms, to_group }) {
  return async (context) => {
    const run = start_run(context);
    await run.line_matching(/^key-test: \d+ pieces on/);
    await sleep(delay_ms);
    (to_group ? run.signal_group : run.signal_coordinator)(signal);
    const result = await finish(run);
    const problems = [];
    check_stopped_by(problems, result, { signal_name, exit_code });
    check(problems, result.report?.incomplete?.not_started?.length > 0 || result.report?.incomplete?.in_flight?.length > 0, "report.incomplete lists no piece");
    return { problems, result };
  };
}

function mid_run_probe({ signal, signal_name, exit_code, to_group }) {
  return async (context) => {
    const run = start_run(context);
    await run.line_matching(first_case_line);
    (to_group ? run.signal_group : run.signal_coordinator)(signal);
    const result = await finish(run);
    const problems = [];
    check_stopped_by(problems, result, { signal_name, exit_code });
    check(problems, result.report?.incomplete?.in_flight?.length > 0, "report.incomplete.in_flight is empty, so no piece was running at the signal");
    return { problems, result };
  };
}

// The orphaned workers of a killed coordinator get this long to stop their sessions and exit.
const ORPHAN_EXIT_MS = 3000;

// SIGKILLs the coordinator alone, mid-case or while the sessions start, then reruns.
function sigkill_coordinator_probe({ wait_for_orphans, startup_delay_ms }) {
  return async (context) => {
    const first = start_run(context);
    if (startup_delay_ms === undefined) {
      await first.line_matching(first_case_line);
    } else {
      await first.line_matching(/^key-test: \d+ pieces on/);
      await sleep(startup_delay_ms);
    }
    const sessions_at_kill = tmp_entries().filter((name) => name.startsWith(RUNTIME_PREFIX)).length;
    first.signal_coordinator("SIGKILL");
    await first.exited;
    const problems = [];
    check(problems, sessions_at_kill > 0, "no session had started at the kill, so the probe did not reach the session stop it tests");
    check(problems, tmp_entries().some((name) => name.startsWith(RUN_DIR_PREFIX)), "the killed run left no run folder, so the probe did not reach the leak it tests");
    if (wait_for_orphans) {
      await wait_for("the orphaned workers and their sessions to exit", () => stray_processes().length === 0, ORPHAN_EXIT_MS).catch(() => {
        problems.push(`still running ${ORPHAN_EXIT_MS / 1000} s after the kill: ${stray_processes().map((pid) => `${pid} ${(read_proc(pid, "cmdline") ?? "").replaceAll("\0", " ").slice(0, 60)}`).join("; ")}`);
      });
    }
    return { problems: [...problems, ...await rerun_after_kill(context)] };
  };
}

const probes = {
  "int-group-mid-run": mid_run_probe({ signal: "SIGINT", signal_name: "SIGINT", exit_code: 130, to_group: true }),
  "term-group-mid-run": mid_run_probe({ signal: "SIGTERM", signal_name: "SIGTERM", exit_code: 143, to_group: true }),
  // The one probe that signals the coordinator alone: the workers learn of the stop only through its SIGTERM.
  "int-coordinator-mid-run": mid_run_probe({ signal: "SIGINT", signal_name: "SIGINT", exit_code: 130, to_group: false }),
  "int-group-at-0.5s": startup_probe({ signal: "SIGINT", signal_name: "SIGINT", exit_code: 130, delay_ms: 500, to_group: true }),
  "term-group-at-1s": startup_probe({ signal: "SIGTERM", signal_name: "SIGTERM", exit_code: 143, delay_ms: 1000, to_group: true }),
  "int-group-at-2s": startup_probe({ signal: "SIGINT", signal_name: "SIGINT", exit_code: 130, delay_ms: 2000, to_group: true }),
  "term-coordinator-at-1s": startup_probe({ signal: "SIGTERM", signal_name: "SIGTERM", exit_code: 143, delay_ms: 1000, to_group: false }),

  async "kill-worker"(context) {
    const run = start_run(context);
    const line = await run.line_matching(first_case_line);
    const shard = Number(/^\[s(\d+)\]/.exec(line)[1]);
    const worker = workers_of(run.pid).find((entry) => entry.shard === shard);
    const problems = [];
    check(problems, worker !== undefined, `no worker process for shard s${shard}`);
    if (worker) process.kill(worker.pid, "SIGKILL");
    const result = await finish(run);
    check(problems, result.code === 1, `exit code ${result.code} (signal ${result.signal}), want 1`);
    check(problems, new RegExp(`^FAIL \\S+: worker s${shard} died \\(signal SIGKILL\\) while running it`, "m").test(result.output), `no "worker s${shard} died (signal SIGKILL)" line`);
    check(problems, result.report?.incomplete?.in_flight?.length === 1, `report.incomplete.in_flight is ${JSON.stringify(result.report?.incomplete?.in_flight)}, want the one lost piece`);
    check(problems, result.report?.shards?.length === SHARDS, "the report lists a different number of shards");
    return { problems, result };
  },

  async "crash-firefox"(context) {
    const run = start_run(context);
    const line = await run.line_matching(first_case_line);
    const shard = Number(/^\[s(\d+)\]/.exec(line)[1]);
    const worker = workers_of(run.pid).find((entry) => entry.shard === shard);
    const firefox = worker ? firefox_of(worker.runtime_dir) : undefined;
    const problems = [];
    check(problems, firefox !== undefined, `no Firefox process in the session of shard s${shard}`);
    if (firefox) process.kill(firefox, "SIGSEGV");
    const result = await finish(run);
    check(problems, result.code === 1, `exit code ${result.code} (signal ${result.signal}), want 1`);
    check(problems, new RegExp(`^FAIL shard s${shard}: the connection to Firefox was lost during \\S+`, "m").test(result.output), `no "shard s${shard}: the connection to Firefox was lost" line`);
    check(problems, result.report !== undefined, "no merged report");
    return { problems, result };
  },

  async deadline(context) {
    const run = start_run({ ...context, deadline_s: 8 });
    const result = await finish(run);
    const problems = [];
    check(problems, result.code === 1, `exit code ${result.code} (signal ${result.signal}), want 1`);
    check(problems, result.output.includes("key-test: stopping all shards: the 8 s deadline passed (KEY_TEST_DEADLINE_S)"), "no deadline stop line");
    check(problems, result.report?.incomplete?.reason === "the 8 s deadline passed (KEY_TEST_DEADLINE_S)", `report.incomplete.reason is ${JSON.stringify(result.report?.incomplete?.reason)}`);
    check(problems, result.report?.incomplete?.in_flight?.length + result.report?.incomplete?.not_started?.length > 0, "report.incomplete lists no piece");
    return { problems, result };
  },

  async "distinct-ports"(context) {
    const run = start_run(context);
    const seen_shards = new Set();
    for (let shard = 1; shard <= SHARDS; shard++) await run.line_matching(new RegExp(`^\\[s${shard}\\] (PASS|FAIL) `));
    const workers = workers_of(run.pid);
    const problems = [];
    check(problems, workers.length === SHARDS, `${workers.length} workers, want ${SHARDS}`);
    const ports = workers.map((worker) => worker.debug_port);
    check(problems, new Set(ports).size === SHARDS && ports.every((port) => port > 0), `debug ports ${ports.join(", ")} are not ${SHARDS} distinct values`);
    for (const worker of workers) seen_shards.add(worker.shard);
    check(problems, seen_shards.size === SHARDS, "the workers do not map to distinct shards");
    const { stdout: listening } = await run_execfile("ss", ["-ltnH"]);
    for (const port of ports) check(problems, new RegExp(`:${port}\\s`).test(listening), `nothing listens on debug port ${port}`);
    const sessions = workers.map((worker) => worker.runtime_dir);
    check(problems, sessions.every((dir) => existsSync(dir)) && new Set(sessions).size === SHARDS, "the sessions do not have distinct runtime dirs");
    run.signal_group("SIGINT");
    return { problems, result: await finish(run) };
  },

  // A second process that sweeps while a run is live must stop nothing: every owner is alive.
  async "foreign-sweep"(context) {
    const run = start_run(context);
    for (let shard = 1; shard <= SHARDS; shard++) await run.line_matching(new RegExp(`^\\[s${shard}\\] (PASS|FAIL) `));
    const before = tmp_entries();
    const sweep_script = `import { sweep_dead_sessions, sweep_dead_run_dirs } from ${JSON.stringify(join(key_test_dir, "session.mjs"))}; await sweep_dead_sessions(); await sweep_dead_run_dirs();`;
    const { stdout, stderr } = await run_execfile(process.execPath, ["--input-type=module", "-e", sweep_script]);
    const problems = [];
    check(problems, stdout.trim() === "" && stderr.trim() === "", `the foreign sweep printed: ${stdout}${stderr}`.trim());
    check(problems, JSON.stringify(tmp_entries()) === JSON.stringify(before), "the foreign sweep changed /tmp");
    check(problems, workers_of(run.pid).length === SHARDS && !run.has_exited(), "the foreign sweep stopped a worker or the run");
    run.signal_group("SIGINT");
    return { problems, result: await finish(run) };
  },

  // The coordinator dies without a handler. Its workers see the closed channel and tear down. The run folder stays, and the next run sweeps it.
  // The rerun starts at once, so its sweep races the dying workers.
  "sigkill-coordinator-then-rerun": sigkill_coordinator_probe({ wait_for_orphans: false }),
  // The same kill, but the orphaned workers must stop their sessions and exit on their own, before any rerun.
  "sigkill-coordinator-orphans-exit": sigkill_coordinator_probe({ wait_for_orphans: true }),
  // A kill while the sessions start: each orphan must kill its half-started session.
  "sigkill-coordinator-at-startup": sigkill_coordinator_probe({ wait_for_orphans: true, startup_delay_ms: 1500 }),

  // The whole group dies at once: the sessions stay up as well, owned by dead workers.
  async "sigkill-group-then-rerun"(context) {
    const first = start_run(context);
    await first.line_matching(first_case_line);
    first.signal_group("SIGKILL");
    await first.exited;
    const problems = [];
    check(problems, tmp_entries().some((name) => name.startsWith(RUNTIME_PREFIX)), "the killed group left no session, so the probe did not reach the leak it tests");
    check(problems, tmp_entries().some((name) => name.startsWith(RUN_DIR_PREFIX)), "the killed group left no run folder");
    return { problems: [...problems, ...await rerun_after_kill(context)] };
  },
};

// A small run after a kill: its sweep removes what the dead run left, and it passes.
async function rerun_after_kill(context) {
  const stale = tmp_entries();
  const second = start_run({ ...context, pieces: SHORT_PIECES, shards: 1 });
  const result = await finish(second);
  const problems = [];
  check(problems, result.code === 0, `the rerun exited ${result.code} (signal ${result.signal}), want 0`);
  check(problems, /^\d+ of \d+ cases passed$/m.test(result.output) && !result.report?.incomplete, "the rerun did not pass in full");
  check(problems, stale.every((name) => !tmp_entries().includes(name)), `the rerun left ${stale.filter((name) => tmp_entries().includes(name)).join(", ")} from the killed run`);
  return problems;
}

async function run_probe(name, body) {
  const work_dir = mkdtempSync(join(tmpdir(), "desertfox-lifecycle-"));
  const started = Date.now();
  let problems;
  let output = "";
  try {
    const before = tmp_entries();
    if (before.length > 0 || stray_processes().length > 0) throw new Error(`a key-test run or its leftovers exist before the probe: ${before.join(", ")} ${stray_processes().join(" ")}`);
    const outcome = await body({ work_dir });
    problems = outcome.problems;
    output = outcome.result?.output ?? "";
    problems.push(...await assert_nothing_left());
  } catch (error) {
    problems = [`probe error: ${error.message}`];
    await stop_live_runs();
    problems.push(...await assert_nothing_left());
  } finally {
    rmSync(work_dir, { recursive: true, force: true });
  }
  console.log(`${problems.length === 0 ? "PASS" : "FAIL"} ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  for (const problem of problems) console.log(`  ${problem}`);
  if (problems.length > 0 && output) console.log(output.split("\n").slice(-30).map((line) => `  | ${line}`).join("\n"));
  return problems.length === 0;
}

const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !(name in probes));
if (unknown.length > 0) {
  console.error(`lifecycle_probe: no probe named ${unknown.join(", ")}. Probes: ${Object.keys(probes).join(", ")}`);
  process.exit(2);
}
let failed = 0;
for (const [name, body] of Object.entries(probes)) {
  if (wanted.length > 0 && !wanted.includes(name)) continue;
  if (!await run_probe(name, body)) failed++;
}
console.log(failed === 0 ? "lifecycle: all probes passed" : `lifecycle: ${failed} probe${failed === 1 ? "" : "s"} failed`);
process.exit(failed === 0 ? 0 : 1);

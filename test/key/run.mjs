// The key test: real key presses in nested sessions, results read from pages that report to a local server.
// This file is the coordinator. It forks one worker.mjs per shard, hands out pieces from one queue, merges the shards'
// timings into one file, prints the summary and sets the exit code. harness.mjs holds the session and the helpers.
import { fork } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { make_run_dir, stop_session_named, sweep_dead_run_dirs, sweep_dead_sessions } from "./session.mjs";
import { build_incomplete, classify_exit, create_ledger, final_exit_code, load_weights, pick_debug_ports, piece_name_of, queue_order, stale_weight_warnings } from "./shards.mjs";
import { default_timings_path, merge_reports, summary_text, write_report } from "./timings.mjs";

const key_test_dir = dirname(fileURLToPath(import.meta.url));
const repo_dir = resolve(key_test_dir, "../..");
// 8 shards peak at about 8.5 GB, under the recipe's 14 GB throttle, and finish about 9 s sooner than 6.
const DEFAULT_SHARDS = 8;
const DEFAULT_DEADLINE_S = 230;
// Eight nested compositors and Firefoxes that start at once can push a session start past its own waits.
const STARTUP_STAGGER_MS = 300;
// A worker's own teardown (the session stop) gets this long after SIGTERM before it is killed.
const STOP_GRACE_MS = 10000;
const SETUP_ERROR_EXIT = 2;

// KEY_TEST_PIECES=p7_caret,p11_find runs only those pieces, in that order when one shard runs them. KEY_TEST_ORDER=reverse runs them last to first, on one shard.
function chosen_piece_files() {
  const all = readdirSync(key_test_dir).filter((name) => /^p\d+_.*\.mjs$/.test(name)).sort();
  const wanted = [...new Set((process.env.KEY_TEST_PIECES ?? "").split(",").map((name) => name.trim().replace(/\.mjs$/, "")).filter(Boolean))];
  if (process.env.KEY_TEST_PIECES !== undefined && wanted.length === 0) throw new Error(`KEY_TEST_PIECES names no piece: "${process.env.KEY_TEST_PIECES}"`);
  const unknown = wanted.filter((name) => !all.includes(`${name}.mjs`));
  if (unknown.length > 0) throw new Error(`KEY_TEST_PIECES names no piece: ${unknown.join(", ")}`);
  const files = wanted.length === 0 ? all : wanted.map((name) => `${name}.mjs`);
  if (process.env.KEY_TEST_ORDER === "reverse") files.reverse();
  else if (process.env.KEY_TEST_ORDER) throw new Error(`KEY_TEST_ORDER must be "reverse" or unset, got ${process.env.KEY_TEST_ORDER}`);
  return files;
}

function positive_integer_from_env(name, fallback) {
  const text = process.env[name];
  if (text === undefined || text === "") return fallback;
  if (!/^[1-9]\d*$/.test(text)) throw new Error(`${name} must be a whole number above 0, got "${text}"`);
  return Number(text);
}

// Reverse order means nothing across a shared queue, so it runs on one shard.
function chosen_shard_count(piece_count) {
  const reverse = process.env.KEY_TEST_ORDER === "reverse";
  const asked = positive_integer_from_env("KEY_TEST_SHARDS", reverse ? 1 : DEFAULT_SHARDS);
  if (reverse && asked > 1) throw new Error(`KEY_TEST_ORDER=reverse needs one shard, got KEY_TEST_SHARDS=${asked}`);
  return Math.min(asked, piece_count);
}

function read_setup() {
  try {
    const piece_files = chosen_piece_files();
    return { piece_files, shard_count: chosen_shard_count(piece_files.length), deadline_s: positive_integer_from_env("KEY_TEST_DEADLINE_S", DEFAULT_DEADLINE_S) };
  } catch (error) {
    console.error(`key-test: ${error.message}`);
    process.exit(SETUP_ERROR_EXIT);
  }
}

async function main() {
  const started_at = Date.now();
  const elapsed_ms = () => Date.now() - started_at;
  const { piece_files, shard_count, deadline_s } = read_setup();
  const { weights, source: weights_source } = load_weights({ logs_dir: join(repo_dir, ".logs"), chosen_file: process.env.KEY_TEST_WEIGHTS });
  // One shard keeps the caller's order, so a sequence that a shard logged replays exactly with KEY_TEST_SHARDS=1 KEY_TEST_PIECES=<sequence>.
  const queue = shard_count === 1 ? piece_files : queue_order(piece_files, weights);
  const ledger = create_ledger(queue);
  const merged_path = default_timings_path(repo_dir);
  const diagnostics_root = merged_path.replace(/\.json$/, "-diagnostics");
  console.log(`key-test: ${piece_files.length} pieces on ${shard_count} shard${shard_count === 1 ? "" : "s"}, weights from ${weights_source}`);

  await sweep_dead_sessions();
  await sweep_dead_run_dirs();
  const debug_ports = await pick_debug_ports(shard_count);
  // Holds each shard's timings file and, through TMPDIR, each worker's session files, so one removal leaves nothing behind in /tmp.
  // Made after the sweep, because a signal before the handlers below kills the coordinator outright.
  const run_dir = make_run_dir();

  const failures = [];
  const results = [];
  let stop_reason;
  let stop_exit_code;

  const shards = Array.from({ length: shard_count }, (_, index) => {
    const shard = index + 1;
    const worker_tmp = join(run_dir, `s${shard}`);
    mkdirSync(worker_tmp);
    const timings_file = join(run_dir, `shard-${shard}.json`);
    const child = fork(join(key_test_dir, "worker.mjs"), [], {
      silent: true,
      env: {
        ...process.env,
        KEY_TEST_DEBUG_PORT: String(debug_ports[index]),
        KEY_TEST_STARTUP_DELAY_MS: String(index * STARTUP_STAGGER_MS),
        KEY_TEST_TIMINGS_FILE: timings_file,
        KEY_TEST_DIAGNOSTICS_DIR: join(diagnostics_root, `s${shard}`),
        TMPDIR: worker_tmp,
      },
    });
    return { shard, child, name: `ok${child.pid.toString(36)}`, timings_file, state: "starting", startup_ms: undefined, finished_ms: undefined, exit: undefined, startup_failure: undefined, last_lines: [] };
  });

  // Live lines, so nothing is lost when the run is killed. The tag says which shard printed them.
  for (const entry of shards) {
    for (const stream of [entry.child.stdout, entry.child.stderr]) {
      createInterface({ input: stream }).on("line", (line) => {
        entry.last_lines = [...entry.last_lines.slice(-4), line];
        console.log(`[s${entry.shard}] ${line}`);
      });
    }
  }

  function stop_worker(entry) {
    entry.state = "stopping";
    entry.child.send({ type: "stop" });
  }

  function hand_out(entry) {
    if (stop_reason) return;
    const piece_file = ledger.take(entry.shard, elapsed_ms());
    if (piece_file === undefined) {
      stop_worker(entry);
      return;
    }
    entry.state = "busy";
    entry.child.send({ type: "run", piece_file });
  }

  let all_exited;
  const all_exited_promise = new Promise((resolve_exited) => { all_exited = resolve_exited; });

  for (const entry of shards) {
    // A send to a worker that died after its last message fails here, and the exit handler records the death.
    entry.child.on("error", (error) => console.log(`key-test: s${entry.shard}: ${error.message}`));
    entry.child.on("message", (message) => {
      if (message.type === "ready") {
        entry.startup_ms = elapsed_ms();
        hand_out(entry);
      } else if (message.type === "startup_failed") {
        entry.startup_failure = message.reason;
      } else if (message.type === "piece_done") {
        ledger.finish(message.piece_file, elapsed_ms());
        results.push(...message.results.map((result) => ({ ...result, piece: message.piece_file, shard: entry.shard })));
        if (message.firefox_lost) {
          failures.push(`shard s${entry.shard}: the connection to Firefox was lost during ${message.piece_file} (${message.firefox_lost}), so the shard took no more pieces`);
          stop_worker(entry);
          return;
        }
        hand_out(entry);
      }
    });
    entry.child.on("exit", async (code, signal) => {
      entry.exit = { code, signal };
      entry.finished_ms = elapsed_ms();
      const piece_file = ledger.in_flight_of(entry.shard);
      const { failure, clean_exit } = classify_exit({ exit: entry.exit, state: entry.state, in_flight_piece: piece_file, startup_ms: entry.startup_ms, startup_failure: entry.startup_failure, last_lines: entry.last_lines, stop_reason, shard: entry.shard });
      if (failure) failures.push(failure);
      // A worker that died without its own teardown leaves its session up. Its marker names a dead pid, so the next sweep would stop it, but this run stops it now.
      if (!clean_exit) await stop_session_named(entry.name).catch((error) => console.log(`key-test: s${entry.shard}: ${error.message}`));
      entry.state = "exited";
      if (shards.every((other) => other.state === "exited")) all_exited();
    });
  }

  function stop_all(reason, exit_code) {
    if (stop_reason) return;
    stop_reason = reason;
    stop_exit_code = exit_code;
    console.log(`key-test: stopping all shards: ${reason}`);
    for (const entry of shards) if (entry.exit === undefined) entry.child.kill("SIGTERM");
    setTimeout(() => {
      for (const entry of shards) {
        if (entry.exit !== undefined) continue;
        console.log(`key-test: s${entry.shard} did not stop within ${STOP_GRACE_MS / 1000} s, killing it`);
        entry.child.kill("SIGKILL");
      }
    }, STOP_GRACE_MS).unref();
  }

  const deadline_timer = setTimeout(() => stop_all(`the ${deadline_s} s deadline passed (KEY_TEST_DEADLINE_S)`, 1), deadline_s * 1000);
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) process.on(signal, () => stop_all(`received ${signal}`, code));

  await all_exited_promise;
  clearTimeout(deadline_timer);
  const total_ms = elapsed_ms();

  const in_flight = ledger.in_flight();
  const not_started = ledger.not_started();
  const incomplete = build_incomplete({ stop_reason, in_flight, not_started });
  const shard_reports = shards.map((entry) => {
    try {
      return { shard: entry.shard, report: JSON.parse(readFileSync(entry.timings_file, "utf8")) };
    } catch {
      return { shard: entry.shard, report: undefined };
    }
  });
  const shard_info = shards.map((entry) => ({
    shard: entry.shard,
    name: entry.name,
    startup_ms: entry.startup_ms,
    busy_ms: ledger.busy_ms_of(entry.shard, total_ms),
    // How long this shard sat finished while others still ran: the slack of the balance.
    idle_ms: total_ms - entry.finished_ms,
    finished_ms: entry.finished_ms,
    pieces: ledger.sequence_of(entry.shard),
    exit: entry.exit,
  }));
  const failed = results.filter((result) => !result.pass);
  const exit_code = final_exit_code({ failed_case_count: failed.length, failure_count: failures.length, incomplete, stop_reason, stop_exit_code });
  const failed_cases = failed.map(({ piece, name, reason, shard }) => ({ piece, name, reason, shard }));
  const merged = merge_reports(shard_reports, { total_ms, shards: shard_info, incomplete, filter: process.env.KEY_TEST_ONLY || undefined });
  // The flake tracker (flakes.mjs) reads these three from the report. Without them a failed case would exist only on stdout.
  Object.assign(merged, { failed_cases, failures, exit_code });
  try {
    write_report(merged_path, merged);
  } catch (error) {
    console.error(`key-test timings not written: ${error.message}`);
  }
  rmSync(run_dir, { recursive: true, force: true });

  console.log(summary_text(merged));
  console.log(`key-test timings written to ${merged_path}`);
  for (const warning of stale_weight_warnings(merged.pieces, weights)) console.log(`stale weight: ${warning} (just key-test-weights refreshes the weights)`);
  for (const entry of shard_info) console.log(`s${entry.shard} sequence: ${entry.pieces.map(piece_name_of).join(",")}`);

  if (failed.length > 0) {
    console.log("failed cases:");
    for (const piece_file of new Set(failed.map((result) => result.piece))) {
      const of_piece = failed.filter((result) => result.piece === piece_file);
      console.log(`  ${piece_file} (s${of_piece[0].shard})`);
      for (const result of of_piece) console.log(`    ${result.name}: ${result.reason}`);
    }
  }
  for (const failure of failures) console.log(`FAIL ${failure}`);
  if (incomplete) console.log(`key-test incomplete (${incomplete.reason}): in flight ${in_flight.join(", ") || "none"}; not started ${not_started.join(", ") || "none"}`);
  const setup_ran = results.filter((result) => result.setup).length;
  if (setup_ran > 0) console.log(`${setup_ran} setup cases ran only because KEY_TEST_ONLY filtered the run`);
  console.log(`${results.length - failed.length} of ${results.length} cases passed`);
  process.exit(exit_code);
}

main().catch((error) => {
  console.error(`key-test aborted: ${error.stack}`);
  process.exit(1);
});

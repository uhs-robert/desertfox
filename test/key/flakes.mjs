// Flake-rate tracking. `just key-test-flakes` runs the key test several times and keeps each run's merged report.
// This file folds those reports into one JSON line per batch, appends it to the history file and raises the alert.
//   node test/key/flakes.mjs sweep
//   node test/key/flakes.mjs fold <commit> <report>...   (a missing or unreadable report is a run error)
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { sweep_dead_run_dirs, sweep_dead_sessions } from "./session.mjs";

export const FAIL_ALERT_RUNS = 2;
export const RUN_ERROR_ALERT_RUNS = 3;

export const history_path = () => process.env.KEY_TEST_FLAKES_HISTORY || join(homedir(), ".local", "state", "desertfox", "key-test-flakes.jsonl");

// A run error is a run with no report: the lock wait timed out or the run died before it wrote one.
// `reports` has one entry per run, undefined for a run error. A batch with fewer than half its runs completed is too thin to read.
export function fold_batch(reports, { commit, at }) {
  const completed = reports.filter(Boolean);
  const cases = new Map();
  const entry_of = (piece, name) => {
    const key = `${piece}\n${name}`;
    if (!cases.has(key)) cases.set(key, { piece, case: name, fail: 0, suspects: 0 });
    return cases.get(key);
  };
  for (const report of completed) {
    const failed_here = new Set((report.failed_cases ?? []).map((failed) => `${failed.piece}\n${failed.name}`));
    for (const key of failed_here) {
      const [piece, name] = key.split("\n");
      entry_of(piece, name).fail += 1;
    }
  }
  for (const report of completed) {
    for (const suspect of report.lost_key_suspects ?? []) {
      const entry = [...cases.values()].find((candidate) => candidate.case === suspect.case && candidate.piece === suspect.piece);
      if (entry) entry.suspects += 1;
    }
  }
  const is_clean = (report) => report.exit_code === 0 && (report.failures ?? []).length === 0 && (report.failed_cases ?? []).length === 0;
  const failing = [...cases.values()].sort((left, right) => right.fail - left.fail || left.case.localeCompare(right.case));
  return {
    at,
    commit,
    runs: reports.length,
    clean_runs: completed.filter(is_clean).length,
    run_errors: reports.length - completed.length,
    too_thin: completed.length * 2 < reports.length,
    cases: failing,
  };
}

// Why the batch needs the owner, or an empty list.
export function alert_reasons(line) {
  const reasons = [];
  for (const failing of line.cases) {
    if (failing.fail >= FAIL_ALERT_RUNS) reasons.push(`${failing.piece} "${failing.case}" failed in ${failing.fail} of ${line.runs} runs`);
  }
  if (line.run_errors >= RUN_ERROR_ALERT_RUNS) reasons.push(`${line.run_errors} of ${line.runs} runs errored`);
  return reasons;
}

export function summary_lines(line) {
  const lines = [`key-test-flakes ${line.commit}: ${line.clean_runs} of ${line.runs} runs clean, ${line.run_errors} run errors`];
  if (line.too_thin) lines.push("batch too thin to read: fewer than half the runs completed");
  for (const failing of line.cases) lines.push(`${failing.piece}  "${failing.case}"  failed ${failing.fail}/${line.runs}  lost-key suspects ${failing.suspects}`);
  return lines;
}

function read_report(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

// A timer has no session bus address in its environment.
function notify(text) {
  const bus = process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=/run/user/${process.getuid()}/bus`;
  const result = spawnSync("notify-send", ["-u", "critical", "desertfox key-test flakes", text], { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: bus }, stdio: "ignore" });
  if (result.error || result.status !== 0) console.error("key-test-flakes: notify-send failed");
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === "sweep") {
    await sweep_dead_sessions();
    await sweep_dead_run_dirs();
    return 0;
  }
  if (command === "fold") {
    const [commit, ...report_paths] = rest;
    const line = fold_batch(report_paths.map(read_report), { commit, at: new Date().toISOString() });
    const path = history_path();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(line)}\n`);
    console.log(JSON.stringify(line));
    for (const text of summary_lines(line)) console.log(text);
    const reasons = alert_reasons(line);
    if (reasons.length === 0) return 0;
    for (const reason of reasons) console.log(`ALERT ${reason}`);
    notify(reasons.join("\n"));
    return 1;
  }
  console.error("usage: flakes.mjs sweep | fold <commit> <report>...");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(await main(process.argv.slice(2)));

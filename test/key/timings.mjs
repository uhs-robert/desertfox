// Wall-time accounting for one key-test run. Each moment of the run is charged to exactly one category
// of the case that is running (or to OUTSIDE_CASES), so the categories of a case add up to its wall time.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const OUTSIDE_CASES = "(outside cases)";
const UNTRACKED = "other";
// A page open charges everything inside it (keys, sleeps, waits, retries) to itself, so it reads as one cost.
const ABSORBING_CATEGORY = "page_opens";
const SLOWEST_SHOWN = 20;

export function create_timings() {
  const started_at = Date.now();
  const cases = new Map();
  const tab_samples = [];
  const lost_key_suspects = [];
  const pieces = [];
  const open_categories = [];
  let current_case = OUTSIDE_CASES;
  let current_piece = "run.mjs";
  let last_charge_at = started_at;

  const bucket_of = (name) => {
    if (!cases.has(name)) cases.set(name, { name, wall_ms: 0, categories: {} });
    return cases.get(name);
  };
  const category_of = (name, category) => (bucket_of(name).categories[category] ??= { ms: 0, count: 0 });

  function charge() {
    const now = Date.now();
    category_of(current_case, open_categories.at(-1)?.category ?? UNTRACKED).ms += now - last_charge_at;
    last_charge_at = now;
  }

  // `count: false` charges time without counting a call, for the second half of a call that was already counted.
  async function time(category, action, { count = true } = {}) {
    if (open_categories.at(-1)?.category === ABSORBING_CATEGORY) return action();
    charge();
    if (count) category_of(current_case, category).count++;
    // Two timed calls can overlap (Promise.race), so each call removes its own entry, not the top one.
    const entry = { category };
    open_categories.push(entry);
    try {
      return await action();
    } finally {
      charge();
      const index = open_categories.indexOf(entry);
      if (index >= 0) open_categories.splice(index, 1);
    }
  }

  let active_case;

  // Safe to call twice and from a signal handler. It also drops the entries the case left open (the losing sleep of a Promise.race), so they are not charged to a later case.
  function finish_active_case() {
    if (!active_case) return;
    charge();
    const { name, meta, started_at } = active_case;
    // A name that repeats, such as "(setup)", adds up instead of keeping the last run.
    const bucket = bucket_of(name);
    Object.assign(bucket, meta, { piece: current_piece, wall_ms: bucket.wall_ms + Date.now() - started_at });
    open_categories.length = 0;
    current_case = OUTSIDE_CASES;
    active_case = undefined;
  }

  async function time_case(name, meta, action) {
    charge();
    current_case = name;
    const this_case = { name, meta, started_at: Date.now() };
    active_case = this_case;
    try {
      return await action();
    } finally {
      if (active_case === this_case) finish_active_case();
    }
  }

  // The debugger client answers a call with a request and then a wait for the result. Wrapping both times the whole call.
  function wrap_rdp(rdp) {
    const { request, next_from } = rdp;
    rdp.request = (...args) => time("rdp", () => request(...args));
    rdp.next_from = (...args) => time("rdp", () => next_from(...args), { count: false });
    const { pause } = rdp;
    rdp.pause = (...args) => time("rdp", () => pause(...args), { count: false });
    return rdp;
  }

  let active_piece;

  // Safe to call twice and from a signal handler. A killed run has no `finally` to record its piece, so this records it with `in_flight: true`. Call it after finish_active_case, so the piece's case time includes the case that was running.
  function finish_active_piece() {
    if (!active_piece) return;
    charge();
    const { name, started_at: piece_started_at, case_ms_before } = active_piece;
    pieces.push({ name, wall_ms: Date.now() - piece_started_at, case_ms: total_case_ms() - case_ms_before, in_flight: true });
    active_piece = undefined;
  }

  async function time_piece(name, action) {
    charge();
    current_piece = name;
    const this_piece = { name, started_at: Date.now(), case_ms_before: total_case_ms() };
    active_piece = this_piece;
    try {
      await action();
    } finally {
      if (active_piece === this_piece) {
        charge();
        pieces.push({ name, wall_ms: Date.now() - this_piece.started_at, case_ms: total_case_ms() - this_piece.case_ms_before });
        active_piece = undefined;
      }
      current_piece = "run.mjs";
    }
  }

  const case_entries = () => [...cases.values()].filter((entry) => entry.name !== OUTSIDE_CASES);
  const total_case_ms = () => case_entries().reduce((sum, entry) => sum + entry.wall_ms, 0);

  function record_tab_count(label, tab_count) {
    tab_samples.push({ label, at_ms: Date.now() - started_at, tab_count });
  }

  // A wait that timed out after a key press. Each one is a key that may have been lost, or an effect that never came.
  function record_lost_key_suspect(what) {
    lost_key_suspects.push({ case: current_case, piece: current_piece, what });
  }

  function category_totals() {
    const totals = {};
    for (const entry of cases.values()) {
      for (const [category, { ms, count }] of Object.entries(entry.categories)) {
        totals[category] ??= { ms: 0, count: 0 };
        totals[category].ms += ms;
        totals[category].count += count;
      }
    }
    return totals;
  }

  function report() {
    charge();
    const outside = bucket_of(OUTSIDE_CASES);
    outside.wall_ms = Object.values(outside.categories).reduce((sum, { ms }) => sum + ms, 0);
    return {
      total_ms: Date.now() - started_at,
      cases_ms: total_case_ms(),
      outside_cases_ms: outside.wall_ms,
      categories: category_totals(),
      outside_cases: outside.categories,
      pieces,
      tab_samples,
      lost_key_suspects,
      cases: case_entries(),
    };
  }

  return { time, time_case, finish_active_case, finish_active_piece, time_piece, wrap_rdp, record_tab_count, record_lost_key_suspect, report, summary_text, write_json: write_report };
}

// A worker passes create_dir false: its folder belongs to a run that a sweep may have removed, and recreating it would leave a folder that nothing owns.
export function write_report(path, full_report, { create_dir = true } = {}) {
  if (create_dir) mkdirSync(dirname(path), { recursive: true });
  else if (!existsSync(dirname(path))) {
    console.log(`timings not written: ${dirname(path)} is gone`);
    return;
  }
  writeFileSync(path, `${JSON.stringify(full_report, null, 2)}\n`);
}

const seconds = (ms) => (ms / 1000).toFixed(1).padStart(7);

// Takes a report from create_timings or merge_reports. A merged report also gets one line per shard.
export function summary_text(full_report) {
  const lines = [`key-test timings: ${seconds(full_report.total_ms).trim()} s total, ${seconds(full_report.cases_ms).trim()} s in cases, ${seconds(full_report.outside_cases_ms).trim()} s outside cases`];
  lines.push("time by category (all cases and setup together):");
  for (const [category, { ms, count }] of Object.entries(full_report.categories).sort((left, right) => right[1].ms - left[1].ms)) {
    lines.push(`  ${category.padEnd(11)} ${seconds(ms)} s  ${String(count).padStart(6)} calls`);
  }
  lines.push("outside cases by category:");
  for (const [category, { ms }] of Object.entries(full_report.outside_cases).sort((left, right) => right[1].ms - left[1].ms)) {
    lines.push(`  ${category.padEnd(11)} ${seconds(ms)} s`);
  }
  if (full_report.shards) {
    lines.push(`shards (s${full_report.critical_shard ?? "?"} finished last):`);
    for (const shard of full_report.shards) {
      lines.push(`  s${shard.shard}  ${seconds(shard.busy_ms)} s busy  ${String(shard.pieces.length).padStart(2)} pieces  ${shard.pieces.map((piece) => piece.replace(/\.mjs$/, "")).join(", ")}`);
    }
  }
  lines.push(`slowest ${SLOWEST_SHOWN} cases:`);
  for (const entry of [...full_report.cases].sort((left, right) => right.wall_ms - left.wall_ms).slice(0, SLOWEST_SHOWN)) {
    lines.push(`  ${seconds(entry.wall_ms)} s  ${full_report.shards ? `s${entry.shard}  ` : ""}${entry.name}`);
  }
  const tab_counts = full_report.tab_samples.map((sample) => sample.tab_count);
  const suspects = full_report.lost_key_suspects ?? [];
  lines.push(`lost-key suspects (waits that timed out after a key press): ${suspects.length}`);
  for (const suspect of suspects) lines.push(`  ${full_report.shards ? `s${suspect.shard}  ` : ""}${suspect.case}: ${suspect.what}`);
  lines.push(`open tabs sampled ${tab_counts.length} times, last ${tab_counts.at(-1) ?? "n/a"}, max ${Math.max(0, ...tab_counts.filter(Number.isFinite))}`);
  return lines.join("\n");
}

// Joins the reports of the shards into one. `shard_reports` is `[{ shard, report }]`, where a shard that wrote nothing has no report.
// `coordinator_info` is `{ total_ms, shards, incomplete, filter }`, where `filter` is the run's KEY_TEST_ONLY: the run lasts the coordinator's wall time, and the case and category figures add up across shards, so they exceed it.
// Each shard entry carries `finished_ms`, the run time at which it exited. The shard that finished last is the critical shard.
export function merge_reports(shard_reports, { total_ms, shards = [], incomplete, filter }) {
  const add_categories = (target, source) => {
    for (const [category, { ms, count }] of Object.entries(source)) {
      target[category] ??= { ms: 0, count: 0 };
      target[category].ms += ms;
      target[category].count += count;
    }
  };
  const merged = { total_ms, cases_ms: 0, outside_cases_ms: 0, categories: {}, outside_cases: {}, pieces: [], tab_samples: [], lost_key_suspects: [], cases: [] };
  for (const { shard, report } of shard_reports) {
    if (!report) continue;
    merged.cases_ms += report.cases_ms;
    merged.outside_cases_ms += report.outside_cases_ms;
    add_categories(merged.categories, report.categories);
    add_categories(merged.outside_cases, report.outside_cases);
    for (const key of ["pieces", "tab_samples", "lost_key_suspects", "cases"]) merged[key].push(...(report[key] ?? []).map((entry) => ({ ...entry, shard })));
  }
  merged.shards = shards;
  merged.critical_shard = shards.filter((entry) => entry.finished_ms !== undefined).sort((left, right) => right.finished_ms - left.finished_ms)[0]?.shard;
  if (incomplete) merged.incomplete = incomplete;
  if (filter) merged.filter = filter;
  return merged;
}

export function default_timings_path(repo_dir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return process.env.KEY_TEST_TIMINGS_FILE || join(repo_dir, ".logs", `key-test-timings-${stamp}.json`);
}

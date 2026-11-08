import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { alert_reasons, fold_batch, summary_lines } = await import(join(import.meta.dirname, "flakes.mjs"));

const meta = { commit: "abc1234", at: "2026-11-15T03:00:00.000Z" };
const clean = () => ({ exit_code: 0, failures: [], failed_cases: [], lost_key_suspects: [] });
const failing = (piece = "p11_find.mjs", name = "Enter then / at once") => ({
  exit_code: 1,
  failures: [],
  failed_cases: [{ piece, name, reason: "no", shard: 1 }],
  lost_key_suspects: [{ case: name, piece, what: "wait", shard: 1 }],
});

test("a batch of clean runs lists no cases and raises no alert", () => {
  const line = fold_batch(Array.from({ length: 10 }, clean), meta);
  assert.deepEqual(line, { ...meta, runs: 10, clean_runs: 10, run_errors: 0, too_thin: false, cases: [] });
  assert.deepEqual(alert_reasons(line), []);
});

test("a case counts its failing runs and its lost-key suspects", () => {
  const reports = [failing(), clean(), failing(), ...Array.from({ length: 7 }, clean)];
  const line = fold_batch(reports, meta);
  assert.equal(line.clean_runs, 8);
  assert.deepEqual(line.cases, [{ piece: "p11_find.mjs", case: "Enter then / at once", fail: 2, suspects: 2 }]);
  assert.equal(summary_lines(line)[1], 'p11_find.mjs  "Enter then / at once"  failed 2/10  lost-key suspects 2');
});

test("one failing run in ten is below the alert threshold, two is at it", () => {
  assert.deepEqual(alert_reasons(fold_batch([failing(), ...Array.from({ length: 9 }, clean)], meta)), []);
  const reasons = alert_reasons(fold_batch([failing(), failing(), ...Array.from({ length: 8 }, clean)], meta));
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /failed in 2 of 10 runs/);
});

test("a shard failure makes the run unclean without naming a case", () => {
  const line = fold_batch([{ ...clean(), exit_code: 1, failures: ["shard s1: lost"] }, clean()], meta);
  assert.equal(line.clean_runs, 1);
  assert.deepEqual(line.cases, []);
});

test("run errors are counted apart from failures and alert at three", () => {
  const two = fold_batch([undefined, undefined, ...Array.from({ length: 8 }, clean)], meta);
  assert.equal(two.run_errors, 2);
  assert.equal(two.clean_runs, 8);
  assert.deepEqual(alert_reasons(two), []);
  const three = fold_batch([undefined, undefined, undefined, ...Array.from({ length: 7 }, clean)], meta);
  assert.match(alert_reasons(three)[0], /3 of 10 runs errored/);
});

test("a batch with fewer than half its runs completed is too thin to read", () => {
  const thin = fold_batch([...Array.from({ length: 4 }, clean), ...Array.from({ length: 6 }, () => undefined)], meta);
  assert.equal(thin.too_thin, true);
  assert.match(summary_lines(thin)[1], /too thin to read/);
  assert.equal(fold_batch([...Array.from({ length: 5 }, clean), ...Array.from({ length: 5 }, () => undefined)], meta).too_thin, false);
});

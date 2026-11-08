import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { broken_message, firefox_label, with_firefox_version } = await import(join(import.meta.dirname, "firefox_internals.mjs"));
const { merge_reports, summary_text, create_timings } = await import(join(import.meta.dirname, "timings.mjs"));

const firefox = { version: "159.0.1", build_id: "20260101000000" };

test("the broken-internal message names the internal, the version and the build", () => {
  const message = broken_message("window.gURLBar.value", "type_in_address_bar reads it", firefox);
  assert.match(message, /^Firefox internal broken: window\.gURLBar\.value \(Firefox 159\.0\.1, build 20260101000000\)\./);
  assert.match(message, /README\.md "Firefox internals"/);
});

test("the label leaves out a missing build id", () => {
  assert.equal(firefox_label({ version: "159.0" }), "Firefox 159.0");
});

test("a late error keeps its text and gains the version, and stays unchanged without one", () => {
  const original = new Error("rdp: reading the cmdline.html frame failed: boom");
  const wrapped = with_firefox_version(original, firefox);
  assert.ok(wrapped.message.startsWith(original.message));
  assert.match(wrapped.message, /Firefox 159\.0\.1/);
  assert.equal(wrapped.cause, original);
  assert.equal(with_firefox_version(original, undefined), original);
});

const empty_report = { cases_ms: 0, outside_cases_ms: 0, categories: {}, outside_cases: {} };
const info = { total_ms: 1 };

test("merge_reports takes the firefox field from the first shard that has one", () => {
  const merged = merge_reports([{ shard: 0, report: empty_report }, { shard: 1, report: { ...empty_report, firefox } }, { shard: 2, report: { ...empty_report, firefox } }], info);
  assert.deepEqual(merged.firefox, firefox);
  assert.equal(merged.other_firefoxes, undefined);
});

test("merge_reports keeps a shard with another Firefox apart", () => {
  const other = { version: "160.0", build_id: "x" };
  const merged = merge_reports([{ shard: 0, report: { ...empty_report, firefox } }, { shard: 1, report: { ...empty_report, firefox: other } }], info);
  assert.deepEqual(merged.other_firefoxes, [other]);
});

test("a report has no firefox field until the session sets it, and the summary prints it", () => {
  const timings = create_timings();
  assert.equal("firefox" in timings.report(), false);
  timings.set_firefox(firefox);
  const report = timings.report();
  assert.deepEqual(report.firefox, firefox);
  assert.match(summary_text(report), /^key-test timings:.*\nFirefox 159\.0\.1 \(build 20260101000000\)\n/);
});

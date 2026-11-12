import assert from "node:assert/strict";
import { test } from "node:test";
import { issue_report, issue_url, MAX_WARNINGS, MAX_WARNINGS_BYTES } from "../../src/background/issue_report.ts";

const FACTS = { version: "1.2.3", channel: "1.2.3", firefox: "130.0", os: "linux x86-64", warnings: [] as string[], config_dir: "/home/me/.config/desertfox" };

test("the body names the versions and the system", () => {
  const { body } = issue_report(FACTS);
  assert.match(body, /DesertFox: 1\.2\.3 \(1\.2\.3\)/);
  assert.match(body, /Firefox: 130\.0/);
  assert.match(body, /OS: linux x86-64/);
  assert.match(body, /Config warnings: none/);
});

test("warnings go in word for word, with the config folder path replaced", () => {
  const { body } = issue_report({ ...FACTS, warnings: ["/home/me/.config/desertfox/keys.toml: unknown key"] });
  assert.match(body, /- <config dir>\/keys\.toml: unknown key/);
  assert.doesNotMatch(body, /\/home\/me/);
});

test("more than the cap of warnings are cut and counted", () => {
  const warnings = Array.from({ length: MAX_WARNINGS + 5 }, (_, index) => `warning ${index}`);
  const { body } = issue_report({ ...FACTS, warnings });
  assert.match(body, /Config warnings \(15\)/);
  assert.match(body, /warning 9\n/);
  assert.doesNotMatch(body, /warning 10/);
  assert.match(body, /\(5 more not shown\)/);
});

test("warnings past the byte cap are cut and counted", () => {
  const warnings = Array.from({ length: 6 }, () => "x".repeat(600));
  const { body } = issue_report({ ...FACTS, warnings });
  assert.equal(body.split("\n").filter((line) => line.startsWith("- x")).length, Math.floor(MAX_WARNINGS_BYTES / 600));
  assert.match(body, /\(3 more not shown\)/);
});

test("the url carries an encoded body that decodes back", () => {
  const report = issue_report({ ...FACTS, warnings: ["a & b #1"] });
  const url = new URL(issue_url(report));
  assert.equal(url.origin + url.pathname, "https://github.com/uhs-robert/desertfox/issues/new");
  assert.equal(url.searchParams.get("body"), report.body);
  assert.ok(issue_url(report).length < 6000);
});

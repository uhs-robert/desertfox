import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { compare_release_versions, parse_release_version } from "../../src/shared/host_version.ts";

// Firefox's version order (toolkit version format) for the all-number versions DesertFox ships: part by part as numbers, and a missing part counts as 0.
function firefox_compare(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let at = 0; at < Math.max(left.length, right.length); at += 1) {
    const difference = (left[at] ?? 0) - (right[at] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

// Oldest to newest. Betas count up from the release before them.
const ascending = ["0.1.21", "0.1.23", "0.1.23.1", "0.1.23.2", "0.1.23.10", "0.1.24", "0.1.24.1", "0.2.0", "1.0.0"];

const host_order = (a: string, b: string): number | undefined => {
  const script = [
    "import sys",
    "sys.path.insert(0, sys.argv[1])",
    "from host_under_test import load_host",
    "host = load_host()",
    "a, b = host.parse_version(sys.argv[2]), host.parse_version(sys.argv[3])",
    "print((a > b) - (a < b))",
  ].join("\n");
  const host_dir = new URL("../../host", import.meta.url).pathname;
  const done = spawnSync("python3", ["-c", script, host_dir, a, b], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
  return Number(done.stdout.trim());
};

test("Firefox orders versions as the extension code does", () => {
  for (const [i, a] of ascending.entries()) {
    for (const [j, b] of ascending.entries()) {
      const expected = Math.sign(i - j);
      assert.equal(firefox_compare(a, b), expected, `Firefox ${a} vs ${b}`);
      assert.equal(Math.sign(compare_release_versions(parse_release_version(a)!, parse_release_version(b)!)), expected, `host_version.ts ${a} vs ${b}`);
    }
  }
});

test("Firefox orders versions as the host does", { skip: spawnSync("python3", ["--version"]).error !== undefined }, () => {
  for (const [i, a] of ascending.entries()) {
    for (const [j, b] of ascending.entries()) assert.equal(host_order(a, b), Math.sign(i - j), `host ${a} vs ${b}`);
  }
});

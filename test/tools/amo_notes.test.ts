import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

const TOOL = join(import.meta.dirname, "..", "..", "tools", "amo_notes.mjs");

function run(input: string) {
  return spawnSync(process.execPath, [TOOL], { input, encoding: "utf8" });
}

test("keeps the intro and the bullets, and drops the title", () => {
  const done = run("# DesertFox 1.0.2\n\nA short intro.\n\n## Features\n\n- One thing\n- Another thing\n\n## Fixes\n\n- A fix\n");
  assert.equal(done.status, 0);
  assert.equal(done.stdout, "A short intro.\n\nFeatures:\n\n- One thing\n- Another thing\n\nFixes:\n\n- A fix\n");
});

test("drops the Install and Links sections up to the next section", () => {
  const done = run("# DesertFox 1.0.2\n\nIntro.\n\n## Install\n\nRun the command.\n\n## Fixes\n\n- A fix\n\n## Links\n\n- [Docs](https://example.com)\n");
  assert.equal(done.stdout, "Intro.\n\nFixes:\n\n- A fix\n");
});

test("turns links into text and url, and strips bold and code ticks", () => {
  const done = run("See [the docs](https://example.com/a) and https://x.example.\n\n- **Bold** and `code` and [https://y.example](https://y.example)\n* star bullet\n");
  assert.equal(done.stdout, "See the docs (https://example.com/a) and https://x.example.\n\n- Bold and code and https://y.example\n- star bullet\n");
});

test("removes fence lines and keeps the code, and a # line in a fence is not a heading", () => {
  const done = run("Intro.\n\n```sh\n# a comment\njust test\n```\n\nAfter.\n");
  assert.equal(done.stdout, "Intro.\n\n# a comment\njust test\n\nAfter.\n");
});

test("fails when nothing is left", () => {
  const done = run("# DesertFox 1.0.2\n\n## Install\n\nRun it.\n");
  assert.equal(done.status, 1);
  assert.match(done.stderr, /empty/);
});

test("fails over the length limit", () => {
  const done = run(`Intro.\n\n${"- a line of notes\n".repeat(600)}`);
  assert.equal(done.status, 1);
  assert.match(done.stderr, /over the limit/);
});

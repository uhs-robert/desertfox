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

test("fails over the 3000 character AMO limit and names the length", () => {
  const done = run("a".repeat(3001));
  assert.equal(done.status, 1);
  assert.match(done.stderr, /3001 characters long, but AMO accepts at most 3000/);
  assert.match(done.stderr, /RELEASE\.md/);
});

test("passes at exactly 3000 characters", () => {
  const done = run("a".repeat(3000));
  assert.equal(done.status, 0);
});

test("drops Install and Links sections whose headings start with an emoji, as the 1.0.1 release did", () => {
  const body = [
    "# DesertFox 1.0.1",
    "",
    "Vim keys for Firefox. See [the guide](https://example.com/guide) for `:help`.",
    "",
    "## \u2728 What changed",
    "",
    "- **Faster** hints",
    "",
    "## \u{1F4E6} Install",
    "",
    "```sh",
    "sh -c 'curl https://example.com/install.sh'",
    "```",
    "",
    "## \u{1F517} Links",
    "",
    "- [Docs](https://example.com/docs)",
    "",
  ].join("\n");
  const done = run(body);
  assert.equal(done.stdout, "Vim keys for Firefox. See the guide (https://example.com/guide) for :help.\n\nWhat changed:\n\n- Faster hints\n");
});

test("drops the subsections of a dropped section and resumes at the next section of the same level", () => {
  const done = run("Intro.\n\n## Install\n\nRun it.\n\n### Linux\n\nLinux steps.\n\n#### Arch\n\nArch steps.\n\n## Fixes\n\n- A fix\n");
  assert.equal(done.stdout, "Intro.\n\nFixes:\n\n- A fix\n");
});

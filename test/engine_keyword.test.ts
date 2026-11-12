// The optional `keyword` field of a search engine: its format, uniqueness and what a child inherits.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { ConfigErrors } from "../src/shared/config_build/errors.ts";
import { build_commands_file } from "../src/shared/registry/index.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { build_config } from "../tools/build-config/build_config.ts";

const commands = build_commands_file(registry).commands;

function build(engines: string) {
  const dir = mkdtempSync(join(tmpdir(), "desertfox-keyword-"));
  writeFileSync(join(dir, "search_engines.toml"), engines);
  return build_config(dir, commands).search_engines;
}

function problems_of(engines: string): string {
  try {
    build(engines);
  } catch (error) {
    if (error instanceof ConfigErrors) return error.problems.join("\n");
    throw error;
  }
  return assert.fail("expected the build to reject the config");
}

const URL = 'url = "https://a.example/?q={query}"';

test("an engine keeps its keyword and an engine without one has none", () => {
  const engines = build(`[a]\n${URL}\nkeyword = "g"\n[b]\n${URL}`);
  assert.equal(engines.a?.keyword, "g");
  assert.equal(engines.b?.keyword, undefined);
  assert.match(engines.a?.origins?.keyword ?? "", /search_engines\.toml \[a\]/);
});

test("a child does not inherit the keyword and may set its own", () => {
  const engines = build(`[a]\n${URL}\nkeyword = "g"\n[a.sub]\nlabel = "sub"\n[a.other]\nkeyword = "go"`);
  assert.equal(engines["a.sub"]?.keyword, undefined);
  assert.equal(engines["a.other"]?.keyword, "go");
});

test("generated children do not inherit the keyword", () => {
  const engines = build(`[a]\n${URL.replace("{query}", "{query}&t={type}")}\nkeyword = "g"\n[a.params.type]\nvalues = { x = "x", y = "y" }\nchildren = true`);
  assert.equal(engines.a?.keyword, "g");
  assert.equal(engines["a.x"]?.keyword, undefined);
});

test("the build refuses a keyword that is empty, long, spaced, upper case or not a string", () => {
  for (const keyword of ['""', '"abcdefghi"', '"a b"', '"G"', '"a.b"', "1"]) {
    assert.match(problems_of(`[a]\n${URL}\nkeyword = ${keyword}`), /keyword must be/, keyword);
  }
});

test("the build refuses two engines with one keyword and names the first", () => {
  assert.match(problems_of(`[a]\n${URL}\nkeyword = "g"\n[b]\n${URL}\nkeyword = "g"`), /engine "a"/);
});

test("a child cannot be named keyword", () => {
  assert.match(problems_of(`[a]\n${URL}\n[a.keyword]\n${URL}`), /reserved/);
});

test("reverse is kept per engine, not inherited, and a bad pattern is refused", () => {
  const engines = build(`[a]\n${URL}\nreverse = "https://a\\\\.example/([^/]+)"\n[a.sub]\nlabel = "sub"`);
  assert.equal(engines.a?.reverse, "https://a\\.example/([^/]+)");
  assert.equal(engines["a.sub"]?.reverse, undefined);
  assert.match(engines.a?.origins?.reverse ?? "", /\[a\]/);
  for (const reverse of ['"(unclosed"', '"no group"', '"(a+)+(b)"']) {
    assert.match(problems_of(`[a]\n${URL}\nreverse = ${reverse}`), /reverse/, reverse);
  }
});

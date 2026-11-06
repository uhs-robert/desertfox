import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fill_template } from "../src/shared/engines/index.ts";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";

const SAMPLE = join(import.meta.dirname, "..", "examples", "engines.toml");
const commands = read_commands_file(join(import.meta.dirname, "fixtures", "build-config", "commands.json"));

function build_sample(warnings: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "desertfox-sample-"));
  copyFileSync(SAMPLE, join(dir, "search_engines.toml"));
  return build_config(dir, commands, warnings).search_engines;
}

const engines = build_sample();

test("copied as search_engines.toml the sample builds with no problems and no warnings", () => {
  const warnings: string[] = [];
  build_sample(warnings);
  assert.deepEqual(warnings, []);
});

test("the sample resolves to 66 engines, with the four left to personal configs absent", () => {
  assert.equal(Object.keys(engines).length, 66);
  for (const name of ["1337", "calendar", "drive", "gmail"]) assert.ok(!(name in engines), name);
});

test("every resolved engine has a label and an https URL with a query slot", () => {
  for (const [name, engine] of Object.entries(engines)) {
    assert.ok(engine.label !== "", `${name} label`);
    assert.ok(engine.url.startsWith("https://") && /\{query[|}]/.test(engine.url), `${name} url`);
  }
});

test("the GitHub tree has the generated and the repo children, and only the repo ones need the page", () => {
  const names = Object.keys(engines).filter((name) => name.startsWith("github")).sort();
  assert.deepEqual(names, [
    "github", "github.code", "github.commits", "github.discussions", "github.issues", "github.prs", "github.repo",
    "github.repo.code", "github.repo.commits", "github.repo.discussions", "github.repo.issues", "github.repo.prs", "github.repos", "github.users",
  ]);
  assert.deepEqual(engines["github.repo.prs"]?.slots, ["repo"]);
  assert.equal(engines["github.users"]?.slots, undefined);
  assert.equal(engines["github.repo.prs"]?.label, "GitHub: this repo: prs");
});

test("the YouTube channel engine needs a channel and has no filter children", () => {
  assert.deepEqual(engines["youtube.channel"]?.slots, ["channel"]);
  assert.ok(!Object.keys(engines).some((name) => name.startsWith("youtube.channel.")));
  assert.equal(engines["youtube"]?.url, "https://www.youtube.com/results?search_query={query}");
  assert.equal(engines["youtube.week"]?.url, "https://www.youtube.com/results?search_query={query}&sp=EgIIAw%3D%3D");
});

test("archive, isdown and translate.page take a typed address and default to the page", () => {
  const page = { url: "https://example.com/a?b=1" };
  const fill = (name: string, query: string) => fill_template(engines[name]!.url, { query, page });
  assert.deepEqual(fill("archive", ""), { ok: true, url: "https://web.archive.org/web/https://example.com/a?b=1" });
  assert.deepEqual(fill("isdown", ""), { ok: true, url: "https://www.isitdownrightnow.com/example.com.html" });
  assert.deepEqual(fill("translate.page", ""), { ok: true, url: "https://translate.google.com/translate?sl=auto&tl=en&u=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1" });
  assert.deepEqual(engines["archive"]?.slots, undefined);
});

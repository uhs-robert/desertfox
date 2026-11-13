import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build_config as build_config_from_dir, read_commands_file } from "../../tools/build-config/build_config.ts";
import { build_config, commands_of_registry } from "../../src/shared/config_build/build_config.ts";
import { ConfigErrors } from "../../src/shared/config_build/errors.ts";
import { create_registry } from "../../src/shared/registry/index.ts";
import { make_tmp_dir } from "../support/tmp_dir.ts";

const FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures", "build-config", "full");
const commands = read_commands_file(join(FIXTURE_DIR, "..", "commands.json"));

function read_tree(dir: string, prefix = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(files, read_tree(path, `${prefix}${name}/`));
    else files[`${prefix}${name}`] = readFileSync(path, "utf8");
  }
  return files;
}

function problems_of(files: Record<string, string>, dir_label?: string): string[] {
  try {
    build_config(files, commands, [], dir_label === undefined ? {} : { dir_label });
  } catch (error) {
    if (error instanceof ConfigErrors) return error.problems;
    throw error;
  }
  assert.fail("expected the build to reject the config");
}

test("raw file text builds the same config as the directory reader, given the same label", () => {
  const from_text = build_config(read_tree(FIXTURE_DIR), commands, [], { dir_label: FIXTURE_DIR });
  assert.equal(JSON.stringify(from_text), JSON.stringify(build_config_from_dir(FIXTURE_DIR, commands)));
});

test("an empty file map is a valid config", () => {
  assert.deepEqual(build_config({}, commands).keymap, {});
});

test("problems name the path relative to the config directory", () => {
  assert.deepEqual(problems_of({ "notes.txt": "", "keymap.d/10-a.toml": "[normal\n" }).map((p) => p.split(":")[0]), ["notes.txt", "keymap.d/10-a.toml"]);
  assert.match(problems_of({ "snippets/a.txt": "" })[0]!, /^snippets\/a\.txt: unknown file, only \.js files belong in snippets$/);
});

test("a dir label prefixes every path in a problem", () => {
  assert.match(problems_of({ "stray/": "" }, "/home/me/cfg/")[0]!, /^\/home\/me\/cfg\/stray: unknown file or directory/);
});

test("a directory entry inside a known folder is unknown", () => {
  assert.match(problems_of({ "snippets/sub/": "" })[0]!, /^snippets\/sub: unknown file, only \.js files belong in snippets$/);
});

test("theme = \"desktop\" is accepted without a theme file", () => {
  assert.equal(build_config({ "settings.toml": 'theme = "desktop"' }, commands, []).settings.theme, "desktop");
});

test("a theme that names no theme is a problem", () => {
  assert.match(problems_of({ "settings.toml": 'theme = "nope"' })[0]!, /^settings\.toml: theme: no theme named "nope"/);
});

test("commands_of_registry lists the registry's commands", () => {
  const registry = create_registry();
  assert.deepEqual(commands_of_registry(registry), []);
});

test("a known name of the wrong type is a problem", () => {
  assert.deepEqual(problems_of({ "settings.toml/": "" }), ["settings.toml: expected a file, found a directory"]);
  assert.deepEqual(problems_of({ "style.css/": "" }), ["style.css: expected a file, found a directory"]);
  assert.deepEqual(problems_of({ snippets: "" }), ["snippets: expected a directory, found a file"]);
});

test("the directory reader reports a known name of the wrong type", (t) => {
  const dir = make_tmp_dir("desertfox-types-", t);
  mkdirSync(join(dir, "settings.toml"));
  writeFileSync(join(dir, "snippets"), "");
  assert.throws(
    () => build_config_from_dir(dir, commands),
    (error) => error instanceof ConfigErrors && error.problems.length === 2,
  );
});

test("the shared build code imports no Node API", () => {
  const dir = join(import.meta.dirname, "..", "..", "src", "shared", "config_build");
  const node_use = /(from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["'`](node:|fs|path|process|os|child_process)\b|\bprocess\./;
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".ts"))) {
    assert.doesNotMatch(readFileSync(join(dir, name), "utf8"), node_use, name);
  }
});

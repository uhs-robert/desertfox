import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build_config as build_config_from_dir, read_commands_file } from "../../tools/build-config/build_config.ts";
import { build_config, commands_of_registry } from "../../src/shared/config_build/build_config.ts";
import { ConfigErrors } from "../../src/shared/config_build/errors.ts";
import { create_registry } from "../../src/shared/registry/index.ts";

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

test("the old JSONC name gets a pointer to the TOML name", () => {
  assert.deepEqual(problems_of({ "keymap.jsonc": "" }), ["keymap.jsonc: JSONC is no longer read, use keymap.toml"]);
});

test("a palette that names no theme is a problem", () => {
  assert.match(problems_of({ "settings.toml": 'palette = "nope"' })[0]!, /^settings\.toml: palette: no theme named "nope"/);
});

test("commands_of_registry lists the registry's commands", () => {
  const registry = create_registry();
  assert.deepEqual(commands_of_registry(registry), []);
});

test("the shared build code imports no Node API", () => {
  const dir = join(import.meta.dirname, "..", "..", "src", "shared", "config_build");
  for (const name of readdirSync(dir)) {
    assert.doesNotMatch(readFileSync(join(dir, name), "utf8"), /from "node:/, name);
  }
});

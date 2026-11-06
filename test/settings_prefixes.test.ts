import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import { DEFAULT_SETTINGS } from "../src/shared/config.ts";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";
import { ConfigErrors } from "../src/shared/config_build/errors.ts";
import { build_schemas } from "../src/shared/config_build/schemas.ts";
import { make_fake } from "./background/fakes.ts";

const commands = read_commands_file(join(import.meta.dirname, "fixtures", "build-config", "commands.json"));

function settings_problems(text: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "desertfox-settings-"));
  writeFileSync(join(dir, "settings.toml"), text);
  try {
    build_config(dir, commands);
  } catch (error) {
    if (error instanceof ConfigErrors) return error.problems;
    throw error;
  }
  return [];
}

test("the default prefixes name their second key tab", () => {
  assert.deepEqual(DEFAULT_SETTINGS.search_prefixes, { here: "s", tab: "S" });
  assert.deepEqual(DEFAULT_SETTINGS.container_prefixes, { reopen: "c", tab: "C" });
});

test("the build accepts the tab prefix and rejects the old new_tab one", () => {
  assert.deepEqual(settings_problems('search_prefixes = { here = "s", tab = "T" }'), []);
  const old_style = settings_problems('search_prefixes = { here = "s", new_tab = "T" }').join("\n");
  assert.match(old_style, /search_prefixes: expected .*"tab"/);
  assert.match(settings_problems('container_prefixes = { reopen = "c", new_tab = "T" }').join("\n"), /container_prefixes: expected .*"tab"/);
});

test("the settings schema requires tab in both prefix pairs", () => {
  const properties = (build_schemas(commands).settings as { properties: Record<string, { required: string[] }> }).properties;
  assert.deepEqual(properties.search_prefixes!.required, ["here", "tab"]);
  assert.deepEqual(properties.container_prefixes!.required, ["reopen", "tab"]);
});

test("a custom tab prefix binds the generated search key", () => {
  const { registry } = make_fake({
    "open.search": {
      label: "Search",
      intent: "Search the web.",
      params: [
        { name: "engine", type: "enum", values: { from: "search_engines" } },
        { name: "where", type: "enum", values: ["here", "tab"], default: "here" },
      ],
      runs_in: "background",
      run: () => {},
    },
  });
  const { compiled } = compile_config({
    config: { ...empty_config(), keymap: { search_keys: { a: "arch" } }, settings: { search_prefixes: { here: "s", tab: "T" } } },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: ["arch"], containers: [] },
  });
  assert.deepEqual(Object.keys(compiled.modes.normal!.children).sort(), ["T", "s"]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_KEYMAP } from "../src/shared/keys/default_keymap.ts";
import "../src/background/command_modules.ts";
import { BINDINGS, bound_key } from "../src/shared/bound_keys.ts";
import { build_schemas } from "../src/shared/config_build/schemas.ts";
import { has_key_mark, resolve_key_docs } from "../src/shared/key_docs.ts";
import { compile_keymap } from "../src/shared/keys/compiler.ts";
import { build_commands_file } from "../src/shared/registry/index.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { build_help_model } from "../src/help/model.ts";
import { SETTING_DOCS, SETTING_HELP } from "../src/shared/settings_docs.ts";

const all_commands = build_commands_file(registry).commands;
const any_command = { runs_in: "content" as const, label: "x", count: "ignore" as const };
const compile = (keymap: unknown) => compile_keymap(keymap as typeof DEFAULT_KEYMAP, {}, (id) => ({ ...any_command, params: all_commands.find((command) => command.id === id)?.params ?? [] })).compiled;

const default_compiled = compile(DEFAULT_KEYMAP);
const without = (bindings: object, ...keys: string[]) => Object.fromEntries(Object.entries(bindings).filter(([key]) => !keys.includes(key)));
const rebound_compiled = compile({ ...DEFAULT_KEYMAP, normal: { ...without(DEFAULT_KEYMAP.normal!, ":", "."), "<A-x>": { id: "cmdline.open" }, "<A-.>": { id: "command.repeat" } } });
const unbound_compiled = compile({ ...DEFAULT_KEYMAP, normal: {}, hint: {}, grab: {}, insert: {} });

const all_prose = [...Object.values(SETTING_DOCS), ...Object.values(SETTING_HELP).flatMap((help) => [help.label, help.summary])];

test("bound_key names the command line key for the new tab hint under a default, rebound and unbound keymap", () => {
  assert.equal(bound_key(default_compiled, all_commands, "cmdline"), ":");
  assert.equal(bound_key(rebound_compiled, all_commands, "cmdline"), "<A-x>");
  assert.equal(bound_key(unbound_compiled, all_commands, "cmdline"), undefined);
  assert.equal(bound_key(undefined, all_commands, "cmdline"), undefined);
});

test("the settings prose names the keys of the keymap in force", () => {
  const text = "Press {key:repeat} to repeat, or {key:hint} to click.";
  assert.equal(resolve_key_docs(text, default_compiled, all_commands), "Press `.` to repeat, or `f` to click.");
  assert.equal(resolve_key_docs(text, rebound_compiled, all_commands), "Press `<A-.>` to repeat, or `f` to click.");
});

test("an unbound action shows its command line, and one with no command line name shows no key bound", () => {
  assert.equal(resolve_key_docs("{key:repeat}", unbound_compiled, all_commands), "`:repeat`");
  assert.equal(resolve_key_docs("{key:cmdline}", unbound_compiled, all_commands), "(no key bound)");
});

test("the default key docs end with one note that the named keys are the defaults", () => {
  assert.equal(resolve_key_docs("{key:down} and {key:up}", default_compiled, all_commands, true), "`j` and `k` The keys named here are the default keys.");
  assert.equal(resolve_key_docs("no marks", default_compiled, all_commands, true), "no marks");
});

test("an unbound action with no command line reads as its phrase", () => {
  assert.equal(resolve_key_docs("The words that {key:next_page|the next page key} looks for", unbound_compiled, all_commands), "The words that the next page key looks for");
  assert.equal(resolve_key_docs("The words that {key:next_page|the next page key} looks for", default_compiled, all_commands), "The words that `]]` looks for");
});

test("no settings sentence reads (no key bound) when every key is unbound", () => {
  for (const text of all_prose) assert.ok(!resolve_key_docs(text, unbound_compiled, all_commands).includes("(no key bound)"), text);
  for (const text of all_prose) assert.ok(!resolve_key_docs(text, undefined, all_commands).includes("(no key bound)"), text);
});

test("a mark that names no known action fails loudly", () => {
  assert.throws(() => resolve_key_docs("{key:nothing}", default_compiled, all_commands), /unknown key action/);
});

test("every settings doc names only known actions, and none keeps a mark under any keymap", () => {
  for (const compiled of [default_compiled, rebound_compiled, unbound_compiled, undefined]) {
    for (const text of all_prose) assert.ok(!has_key_mark(resolve_key_docs(text, compiled, all_commands)), text);
  }
  assert.ok(all_prose.some(has_key_mark), "the scan would pass with no marks to resolve");
});

test("the settings schema names the default keys and keeps no mark", () => {
  const properties = (build_schemas(all_commands).settings as { properties: Record<string, { description: string }> }).properties;
  for (const [name, property] of Object.entries(properties)) assert.ok(!has_key_mark(property.description), name);
  assert.match(properties.which_key_repeat!.description, /names the action that `\.` runs again.* The keys named here are the default keys\.$/);
  assert.match(properties.next_patterns!.description, /The words that `\]\]` looks for/);
  assert.ok(!properties.which_key_delay_ms!.description.includes("default keys"));
  assert.ok(!properties.newtab_command_hint!.description.includes("press :"));
});

test("the help model resolves the prose against its own keymap", () => {
  const model = build_help_model(all_commands, compile({ normal: { "<A-.>": { id: "command.repeat" } } }), []);
  assert.equal(model.resolve_keys("{key:repeat}"), "`<A-.>`");
});

test("every action the prose names is in the binding table", () => {
  for (const text of all_prose) for (const [, name] of text.matchAll(/\{key:([a-z_]+)\}/g)) assert.ok(name! in BINDINGS, name ?? "");
});

test("browser_cmdline_key reads the stored keymap and commands.json", async () => {
  const globals = globalThis as unknown as { browser?: unknown; fetch?: unknown };
  const saved = { browser: globals.browser, fetch: globals.fetch };
  const { browser_cmdline_key } = await import("../src/newtab/cmdline_key.ts");
  try {
    for (const [compiled, expected] of [[default_compiled, ":"], [rebound_compiled, "<A-x>"], [unbound_compiled, undefined], [undefined, undefined]] as const) {
      globals.browser = { storage: { local: { get: async (key: string) => (compiled ? { [key]: compiled } : {}) } }, runtime: { getURL: (path: string) => `moz-extension://x/${path}` } };
      let fetched = "";
      globals.fetch = async (url: string) => ((fetched = url), { json: async () => ({ commands: all_commands }) });
      assert.equal(await browser_cmdline_key(), expected);
      assert.equal(fetched, "moz-extension://x/commands.json");
    }
    globals.fetch = async () => Promise.reject(new Error("offline"));
    await assert.rejects(browser_cmdline_key(), /offline/);
  } finally {
    globals.browser = saved.browser;
    globals.fetch = saved.fetch;
  }
});

import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { open_quick_start_on_install } from "../src/background/first_install.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import type { Block } from "../src/help/blocks.ts";
import "../src/background/command_modules.ts";
import { quick_start_blocks, quick_start_fallbacks } from "../src/help/quick_start.ts";
import { parse_route } from "../src/help/route.ts";
import { compile_keymap } from "../src/shared/keys/compiler.ts";
import { command_meta, registry } from "../src/shared/registry/index.ts";
import { parse_command_line } from "../src/shared/registry/command_line.ts";
import { build_config, read_commands_file } from "../tools/build-config/build_config.ts";
import { ConfigErrors } from "../tools/build-config/errors.ts";
import { build_schemas } from "../tools/build-config/schemas.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "build-config");
const commands = read_commands_file(join(FIXTURES, "commands.json"));

const all_commands = registry.list().map(command_meta);
const any_command = { runs_in: "content" as const, label: "x", count: "ignore" as const };
const compile = (keymap: typeof DEFAULT_KEYMAP) => compile_keymap(keymap, {}, () => any_command).compiled;

function codes_of(blocks: Block[]): string[] {
  return blocks.flatMap((block) => (block.kind === "paragraph" ? block.inlines.filter((inline) => inline.kind === "code").map((inline) => inline.text) : []));
}

test("quick start: the keys come from the keymap", () => {
  const codes = codes_of(quick_start_blocks(compile(DEFAULT_KEYMAP), all_commands));
  for (const key of ["j", "k", "gg", "G", "f", ":", "/", "?", "n", "N", "v", ";v", ";V", "g?", "y", "o", "<Escape>"]) assert.ok(codes.includes(key), key);
});

test("quick start: the copy example names a key that copies a link address", () => {
  assert.ok(codes_of(quick_start_blocks(compile(DEFAULT_KEYMAP), all_commands)).includes(";yl"));
});

test("quick start: a rebind changes the page and an unbound key falls back to the command line", () => {
  const { f: _hint, v: _caret, gV: _caret_too, ...rest } = DEFAULT_KEYMAP.normal!;
  const rebound = { ...DEFAULT_KEYMAP, normal: { ...rest, "<A-f>": { id: "hint.run", args: { action: "here" } } } };
  const codes = codes_of(quick_start_blocks(compile(rebound), all_commands));
  // `;B` runs the same hint action as `f`, so it is the shortest key left.
  assert.ok(codes.includes(";B"));
  assert.ok(!codes.includes("f"));
  assert.ok(codes.includes(":mode caret"));
  assert.ok(codes_of(quick_start_blocks(undefined, all_commands)).includes(":hint"));
});

test("quick start: a binding that spells out a default still matches", () => {
  const { "/": _find, ...rest } = DEFAULT_KEYMAP.normal!;
  const spelled = { ...DEFAULT_KEYMAP, normal: { ...rest, "<A-/>": { id: "find.open", args: { direction: "forward" } } } };
  assert.ok(codes_of(quick_start_blocks(compile(spelled), all_commands)).includes("<A-/>"));
});

test("quick start: a command with no command line form says it has no key, and a keymap with no group names none", () => {
  const texts = (blocks: Block[]) => blocks.flatMap((block) => (block.kind === "paragraph" ? block.inlines.map((inline) => inline.text) : []));
  const bare = compile({ ...DEFAULT_KEYMAP, site_keys: {}, normal: { j: { id: "scroll.lines", args: { count: 10 } } } });
  const shown = texts(quick_start_blocks(bare, all_commands));
  assert.ok(shown.includes("(no key bound)"));
  assert.ok(shown.some((text) => text.includes("no such key")));
});

test("quick start: every command line it can show resolves in the registry", () => {
  const lookup = { find: (word: string) => registry.list().find((command) => (command.name ?? command.id) === word) };
  const fallbacks = quick_start_fallbacks(all_commands);
  assert.ok(fallbacks.length > 0);
  for (const { id, text } of fallbacks) {
    const parsed = parse_command_line(lookup, text.slice(1));
    assert.equal(parsed.kind, "invocation", text);
    if (parsed.kind === "invocation") assert.equal(parsed.invocation.id, id, text);
  }
});

test("the Quick Start route and the install URL agree", async () => {
  assert.equal(parse_route("#/quick-start").page, "quick-start");
  const opened: string[] = [];
  const deps = (reason: string, on: boolean) => ({ reason, open_on_install: async () => on, open_tab: async (url: string) => void opened.push(url) });
  const url_of = (file: string) => `moz-extension://x/${file}`;
  assert.equal(await open_quick_start_on_install(deps("install", true), url_of), true);
  assert.deepEqual(opened, ["moz-extension://x/help.html#/quick-start"]);
});

test("the Quick Start page opens on a first install only, and the setting turns it off", async () => {
  const opened: string[] = [];
  const url_of = (file: string) => file;
  for (const [reason, on] of [["update", true], ["browser_update", true], ["install", false]] as const) {
    assert.equal(await open_quick_start_on_install({ reason, open_on_install: async () => on, open_tab: async (url) => void opened.push(url) }, url_of), false, `${reason} ${on}`);
  }
  assert.deepEqual(opened, []);
});

function problems_with_settings(settings_toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "desertfox-config-"));
  cpSync(join(FIXTURES, "full"), dir, { recursive: true });
  mkdirSync(dirname(join(dir, "settings.toml")), { recursive: true });
  writeFileSync(join(dir, "settings.toml"), settings_toml);
  try {
    build_config(dir, commands);
  } catch (error) {
    if (error instanceof ConfigErrors) return error.problems.join("\n");
    throw error;
  }
  return "";
}

test("open_quick_start_on_install takes a boolean and the schema lists it", () => {
  assert.equal(problems_with_settings("open_quick_start_on_install = false"), "");
  assert.match(problems_with_settings('open_quick_start_on_install = "no"'), /expected/);
  assert.ok("open_quick_start_on_install" in (build_schemas(commands).settings as { properties: Record<string, unknown> }).properties);
});

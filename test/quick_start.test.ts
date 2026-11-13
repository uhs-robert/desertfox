import assert from "node:assert/strict";
import { test } from "node:test";
import { open_quick_start_on_install } from "../src/background/first_install.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import type { Block, Inline } from "../src/help/blocks.ts";
import "../src/background/command_modules.ts";
import { quick_start_blocks, quick_start_fallbacks } from "../src/help/quick_start.ts";
import { parse_route } from "../src/help/route.ts";
import { compile_keymap } from "../src/shared/keys/compiler.ts";
import { command_meta } from "../src/shared/registry/index.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { parse_command_line } from "../src/shared/registry/command_line.ts";

const all_commands = registry.list().map(command_meta);
const any_command = { runs_in: "content" as const, label: "x", count: "ignore" as const };
const compile = (keymap: typeof DEFAULT_KEYMAP) => compile_keymap(keymap, {}, () => any_command).compiled;

function codes_of(blocks: Block[]): string[] {
  const code_of = (inlines: Inline[]) => inlines.filter((inline) => inline.kind === "code").map((inline) => inline.text);
  return blocks.flatMap((block) => (block.kind === "paragraph" ? code_of(block.inlines) : block.kind === "list" ? block.items.flatMap(code_of) : []));
}

test("quick start: the keys come from the keymap", () => {
  const codes = codes_of(quick_start_blocks(compile(DEFAULT_KEYMAP), all_commands));
  for (const key of ["j", "k", "gg", "G", "f", ":", "/", "?", "n", "N", "v", ";v", ";V", "g?", "y", "o", "<Escape>"]) assert.ok(codes.includes(key), key);
});

test("quick start: the host keys follow a rebind and fall back to the command line", () => {
  const rebound = codes_of(quick_start_blocks(compile({ ...DEFAULT_KEYMAP, insert: { "<A-e>": { id: "text.edit_external" } } } as never), all_commands));
  assert.ok(rebound.includes("<A-e>"));
  assert.ok(!rebound.includes("<C-o>"));
  const unbound = codes_of(quick_start_blocks(compile({ ...DEFAULT_KEYMAP, insert: {} } as never), all_commands));
  assert.ok(!unbound.includes("<C-o>"));
});

test("quick start: the copy example names a key that copies a link address", () => {
  assert.ok(codes_of(quick_start_blocks(compile(DEFAULT_KEYMAP), all_commands)).includes(";yl"));
});

test("quick start: a rebind changes the page and an unbound key falls back to the command line", () => {
  const { f: _hint, v: _caret, gV: _caret_too, ...rest } = DEFAULT_KEYMAP.normal!;
  const rebound = { ...DEFAULT_KEYMAP, normal: { ...rest, "<A-f>": { id: "hint.run", args: { action: "here" } } } };
  const codes = codes_of(quick_start_blocks(compile(rebound), all_commands));
  // `;b` clicks buttons only, so it does not stand in for `f`.
  assert.ok(codes.includes("<A-f>"));
  assert.ok(!codes.includes(";b"));
  assert.ok(!codes.includes("f"));
  assert.ok(codes.includes(":mode caret"));
  assert.ok(codes_of(quick_start_blocks(undefined, all_commands)).includes(":hint"));
});

function codes_with_normal(extra: Record<string, unknown>, drop: string[] = [], keymap = DEFAULT_KEYMAP): string[] {
  const normal = Object.fromEntries(Object.entries(keymap.normal!).filter(([key]) => !drop.includes(key)));
  return codes_of(quick_start_blocks(compile({ ...keymap, normal: { ...normal, ...extra } } as typeof DEFAULT_KEYMAP), all_commands));
}

test("quick start: a key that runs several steps is not picked", () => {
  const codes = codes_with_normal({ "<A-j>": [{ id: "scroll.lines", args: { count: -10 } }, { id: "scroll.lines", args: { count: 10 } }] }, ["j"]);
  assert.ok(!codes.includes("<A-j>"));
  assert.ok(codes.includes(":scroll 10"));
});

test("quick start: a copy hint bound to inputs only is not picked", () => {
  const { ";yl": _link, ...normal } = DEFAULT_KEYMAP.normal as Record<string, unknown>;
  const codes = codes_with_normal({ "<A-y>": { id: "hint.run", args: { action: "copy", filter: "inputs" } } }, [], { ...DEFAULT_KEYMAP, normal: normal as never });
  assert.ok(!codes.includes("<A-y>"));
  assert.ok(codes.includes(":hint --copy --links"));
});

test("quick start: a hint on inputs only is not picked for clicking", () => {
  const codes = codes_with_normal({ "<A-i>": { id: "hint.run", args: { action: "here", filter: "inputs" } } }, ["f"]);
  assert.ok(!codes.includes("<A-i>"));
  assert.ok(codes.includes(":hint"));
});

test("quick start: the default keymap gives the keys it always gave", () => {
  const codes = codes_of(quick_start_blocks(compile(DEFAULT_KEYMAP), all_commands));
  assert.deepEqual(codes, ["j", "k", "gg", "G", "<C-d>", "f", "<Escape>", ";yl", ":", "open", "<Escape>", ",,", "g", "<Escape>", "/", "?", "n", "N", "v", "h", "j", "k", "l", "w", "v", "V", "y", "o", "<Escape>", ";v", ";V", "g?", ",s", "<C-o>", ",fs", "~/.config/desertfox/", "config.reload", ":native.install"]);
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
  assert.ok(shown.some((text) => text.includes("No key starts a longer sequence")));
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
  const deps = (reason: string) => ({ reason, open_tab: async (url: string) => void opened.push(url) });
  const url_of = (file: string) => `moz-extension://x/${file}`;
  assert.equal(await open_quick_start_on_install(deps("install"), url_of), true);
  assert.deepEqual(opened, ["moz-extension://x/home.html#/quick-start"]);
});

test("the Quick Start page opens on a first install only", async () => {
  const opened: string[] = [];
  const url_of = (file: string) => file;
  for (const reason of ["update", "browser_update"]) {
    assert.equal(await open_quick_start_on_install({ reason, open_tab: async (url) => void opened.push(url) }, url_of), false, reason);
  }
  assert.deepEqual(opened, []);
});

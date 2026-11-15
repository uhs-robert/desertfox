import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { parse_binding } from "../../src/shared/registry/parse_binding.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { captured_key_param } from "../../src/shared/registry/params.ts";

const args_of = (text: string) => {
  const result = parse_binding(registry, text);
  assert.equal(result.kind, "binding", JSON.stringify(result));
  return result.kind === "binding" ? { id: result.binding.id, args: result.binding.args } : undefined;
};

test("caret and visual commands read as one-line command strings", () => {
  assert.deepEqual(args_of("caret.move --word"), { id: "caret.move", args: { unit: "word" } });
  assert.deepEqual(args_of("caret.move --word --back"), { id: "caret.move", args: { unit: "word", direction: "back" } });
  assert.deepEqual(args_of("caret.move --word-end --big"), { id: "caret.move", args: { unit: "word_end", big: true } });
  assert.deepEqual(args_of("caret.move --line-start"), { id: "caret.move", args: { unit: "line_start" } });
  assert.deepEqual(args_of("visual.act yank"), { id: "visual.act", args: { action: "yank" } });
  assert.deepEqual(args_of("visual.act yank --register=a"), { id: "visual.act", args: { action: "yank", register: "a" } });
  assert.deepEqual(args_of("cmdline.history prev"), { id: "cmdline.history", args: { direction: "prev" } });
});

test("every default caret, visual and cmdline binding is the same command as its command string", () => {
  const strings: Record<string, string> = { h: "caret.move --char --back", l: "caret.move --char", j: "caret.move --line", k: "caret.move --line --back", w: "caret.move --word", b: "caret.move --word --back", e: "caret.move --word-end", W: "caret.move --word --big", B: "caret.move --word --back --big", E: "caret.move --word-end --big", "0": "caret.move --line-start", "^": "caret.move --line-first", $: "caret.move --line-end", gg: "caret.move --start", G: "caret.move --end", f: "caret.find", t: "caret.find --till", F: "caret.find --back", T: "caret.find --back --till", ";": "caret.move --find-repeat", ",": "caret.move --find-repeat --back" };
  for (const mode of ["caret", "visual"] as const) {
    for (const [key, text] of Object.entries(strings)) {
      const bound = DEFAULT_KEYMAP[mode]?.[key] as { id: string; args?: Record<string, unknown> };
      const parsed = args_of(text)!;
      assert.equal(bound.id, parsed.id, `${mode} ${key}`);
      assert.deepEqual(parsed.args ?? {}, bound.args ?? {}, `${mode} ${key}`);
    }
  }
  assert.equal((DEFAULT_KEYMAP.visual?.y as { id: string }).id, "visual.act");
  for (const key of ["<Enter>", "<ArrowUp>", "<ArrowDown>", "<C-u>"]) assert.ok(DEFAULT_KEYMAP.cmdline?.[key], key);
});

test("the arrow keys move like h, j, k and l in caret and both visual modes", () => {
  const arrows = { "<ArrowLeft>": "h", "<ArrowDown>": "j", "<ArrowUp>": "k", "<ArrowRight>": "l" };
  for (const mode of ["caret", "visual", "visual_line"] as const) {
    for (const [arrow, letter] of Object.entries(arrows)) assert.deepEqual(DEFAULT_KEYMAP[mode]?.[arrow], DEFAULT_KEYMAP[mode]?.[letter], `${mode} ${arrow}`);
  }
});

test("mode.set names line visual mode in words", () => {
  const labels = registry.get("mode.set")?.params?.[0]?.value_labels;
  assert.equal(labels?.visual_line, "to line visual");
  assert.equal(labels?.caret, "to caret");
});

test("the placeholder commands are defined", () => {
  for (const id of ["caret.move", "visual.act", "cmdline.submit", "cmdline.history", "cmdline.clear"]) assert.ok(registry.get(id), id);
});

test("caret.find captures its key and takes the count as a param, so one run reaches the count-th match", () => {
  const find = registry.get("caret.find")!;
  assert.equal(captured_key_param(find, { direction: "forward" })?.name, "char");
  assert.deepEqual(find.count, { param: "count" });
  assert.equal(find.repeatable, false);
  assert.deepEqual(check_args(find, { char: "x", count: 3 }), { ok: true, args: { char: "x", direction: "forward", till: false, count: 3 } });
  assert.deepEqual(check_args(find, { char: " " }), { ok: true, args: { char: " ", direction: "forward", till: false, count: 1 } });
  assert.equal(check_args(find, { char: "xy" }).ok, false);
  assert.equal(check_args(find, {}).ok, false);
});

test("caret.move no longer has a char find unit, so an old binding warns", () => {
  const unit = registry.get("caret.move")!.params!.find((param) => param.name === "unit")!;
  assert.equal((unit.values as readonly string[]).includes("char_find"), false);
  assert.equal(registry.get("caret.move")!.params!.some((param) => param.name === "till"), false);
});

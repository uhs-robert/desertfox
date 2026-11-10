import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { parse_binding } from "../../src/shared/registry/parse_binding.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

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
  assert.deepEqual(args_of("visual.act --yank"), { id: "visual.act", args: { action: "yank" } });
  assert.deepEqual(args_of("cmdline.history prev"), { id: "cmdline.history", args: { direction: "prev" } });
});

test("every default caret, visual and cmdline binding is the same command as its command string", () => {
  const strings: Record<string, string> = { h: "caret.move --char --back", l: "caret.move --char", j: "caret.move --line", k: "caret.move --line --back", w: "caret.move --word", b: "caret.move --word --back", e: "caret.move --word-end", W: "caret.move --word --big", B: "caret.move --word --back --big", E: "caret.move --word-end --big", "0": "caret.move --line-start", "^": "caret.move --line-first", $: "caret.move --line-end", gg: "caret.move --start", G: "caret.move --end", f: "caret.move --char-find", t: "caret.move --char-find --till", F: "caret.move --char-find --back", T: "caret.move --char-find --back --till", ";": "caret.move --find-repeat", ",": "caret.move --find-repeat --back" };
  for (const mode of ["caret", "visual"] as const) {
    for (const [key, text] of Object.entries(strings)) {
      const bound = DEFAULT_KEYMAP[mode]?.[key] as { id: string; args: Record<string, unknown> };
      const parsed = args_of(text)!;
      assert.equal(bound.id, parsed.id, `${mode} ${key}`);
      assert.deepEqual(parsed.args, bound.args, `${mode} ${key}`);
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

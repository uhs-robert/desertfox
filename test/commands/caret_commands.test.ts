import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { parse_binding } from "../../src/shared/registry/parse_binding.ts";
import { registry } from "../../src/shared/registry/index.ts";

const args_of = (text: string) => {
  const result = parse_binding(registry, text);
  assert.equal(result.kind, "binding", JSON.stringify(result));
  return result.kind === "binding" ? { id: result.binding.id, args: result.binding.args } : undefined;
};

test("caret and visual commands read as one-line command strings", () => {
  assert.deepEqual(args_of("caret.move word"), { id: "caret.move", args: { unit: "word" } });
  assert.deepEqual(args_of("move word back"), { id: "caret.move", args: { unit: "word", direction: "back" } });
  assert.deepEqual(args_of("move word_end big"), { id: "caret.move", args: { unit: "word_end", big: true } });
  assert.deepEqual(args_of("move line_start"), { id: "caret.move", args: { unit: "line_start" } });
  assert.deepEqual(args_of("visual.act yank"), { id: "visual.act", args: { action: "yank" } });
  assert.deepEqual(args_of("history prev"), { id: "cmdline.history", args: { direction: "prev" } });
});

test("every default caret, visual and cmdline binding is the same command as its command string", () => {
  const strings: Record<string, string> = { h: "move char back", l: "move char", j: "move line", k: "move line back", w: "move word", b: "move word back", e: "move word_end", W: "move word big", B: "move word back big", E: "move word_end big", "0": "move line_start", "^": "move line_first", $: "move line_end", gg: "move start", G: "move end" };
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

test("the placeholder commands are defined", () => {
  for (const id of ["caret.move", "visual.act", "cmdline.submit", "cmdline.history", "cmdline.clear"]) assert.ok(registry.get(id), id);
});

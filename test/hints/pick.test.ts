import assert from "node:assert/strict";
import { test } from "node:test";
import { create_picker } from "../../src/content/hints/pick.ts";

const labels = ["a", "sa", "ss", "sd"];

test("a complete label is picked at once", () => {
  const picker = create_picker(labels);
  assert.deepEqual(picker.on_token_("a"), { kind: "handled", typed: "a", still_possible_: [0], picked: 0 });
});

test("a two-letter label narrows first, then picks", () => {
  const picker = create_picker(labels);
  assert.deepEqual(picker.on_token_("s"), { kind: "handled", typed: "s", still_possible_: [1, 2, 3] });
  assert.deepEqual(picker.on_token_("d"), { kind: "handled", typed: "sd", still_possible_: [3], picked: 3 });
});

test("capital letters count as the label letter", () => {
  assert.equal(create_picker(labels).on_token_("A").kind, "handled");
});

test("a letter that fits no label is taken and changes nothing", () => {
  const picker = create_picker(labels);
  picker.on_token_("s");
  assert.deepEqual(picker.on_token_("x"), { kind: "handled", typed: "s", still_possible_: [1, 2, 3] });
  assert.equal(picker.typed(), "s");
});

test("Backspace removes the last typed letter", () => {
  const picker = create_picker(labels);
  picker.on_token_("s");
  assert.deepEqual(picker.on_token_("<Backspace>"), { kind: "handled", typed: "", still_possible_: [0, 1, 2, 3] });
});

test("chords and named keys pass through, so Ctrl+C and Escape still work", () => {
  const picker = create_picker(labels);
  for (const token of ["<C-c>", "<A-j>", "<M-a>", "<CS-c>", "<Escape>", "<Enter>"]) assert.deepEqual(picker.on_token_(token), { kind: "pass" }, token);
});

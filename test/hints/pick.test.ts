import assert from "node:assert/strict";
import { test } from "node:test";
import { create_picker, is_text_key } from "../../src/content/hints/pick.ts";

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
  for (const token of ["<C-c>", "<A-j>", "<M-a>", "<CS-c>", "<Escape>", "<ArrowDown>"]) assert.deepEqual(picker.on_token_(token), { kind: "pass" }, token);
});

// Four hints with labels a, sa, ss, sd. Their texts rank "news" first for the query "new".
const texts = ["today news", "news", "weather", "newsletter"];
const text_picker = () => create_picker(labels, () => texts);
const tokens = (picker: ReturnType<typeof create_picker>, keys: string[]) => keys.map((key) => picker.on_token_(key));
const last = <T>(items: T[]): T => items.at(-1)!;

test("/ enters text mode with every hint matching and the first one active", () => {
  const picker = text_picker();
  assert.deepEqual(picker.on_token_("/"), { kind: "handled", typed: "", still_possible_: [0, 1, 2, 3], text: "", active: 0 });
});

test("a label prefix typed before / is dropped on entering text mode", () => {
  const picker = text_picker();
  picker.on_token_("s");
  picker.on_token_("/");
  const back = tokens(picker, ["<Backspace>"]);
  assert.deepEqual(back[0], { kind: "handled", typed: "", still_possible_: [0, 1, 2, 3] });
});

test("in text mode a one-character token is text, so a label letter does not pick", () => {
  const picker = text_picker();
  picker.on_token_("/");
  assert.deepEqual(picker.on_token_("a"), { kind: "handled", typed: "", still_possible_: [2, 0], text: "a", active: 2 });
});

test("matches rank best first and Tab and Shift-Tab cycle through them, wrapping", () => {
  const picker = text_picker();
  picker.on_token_("/");
  const typed = tokens(picker, ["n", "e", "w"]);
  assert.deepEqual(last(typed), { kind: "handled", typed: "", still_possible_: [1, 3, 0], text: "new", active: 1 });
  assert.equal((picker.on_token_("<Tab>") as { active: number }).active, 3);
  assert.equal((picker.on_token_("<Tab>") as { active: number }).active, 0);
  assert.equal((picker.on_token_("<Tab>") as { active: number }).active, 1);
  assert.equal((picker.on_token_("<S-Tab>") as { active: number }).active, 0);
  assert.equal((picker.on_token_("<S-Tab>") as { active: number }).active, 3);
});

test("Enter picks the active hint, and picks nothing when no hint is left", () => {
  const picker = text_picker();
  picker.on_token_("/");
  tokens(picker, ["n", "e", "w", "<Tab>"]);
  assert.equal((picker.on_token_("<Enter>") as { picked: number }).picked, 3);
  const empty = create_picker(labels, () => []);
  empty.on_token_("/");
  assert.equal((empty.on_token_("<Enter>") as { picked?: number }).picked, undefined);
});

test("a key that matches nothing is taken and changes nothing", () => {
  const picker = text_picker();
  picker.on_token_("/");
  picker.on_token_("n");
  assert.deepEqual(picker.on_token_("q"), { kind: "handled", typed: "", still_possible_: [1, 3, 0], text: "n", active: 1 });
});

test("one remaining match picks at once, in the key that typed it", () => {
  const picker = text_picker();
  picker.on_token_("/");
  const typed = tokens(picker, ["w", "e", "a"]);
  assert.equal(last(typed).kind === "handled" && (last(typed) as { picked?: number }).picked, 2);
});

test("Space is part of the text in text mode, and matches every word", () => {
  const picker = text_picker();
  picker.on_token_("/");
  const typed = tokens(picker, ["t", "o", "d", "a", "y", "<Space>", "n"]);
  assert.equal((last(typed) as { text: string }).text, "today n");
});

test("a space alone never picks, even with one hint", () => {
  const picker = create_picker(["a"], () => ["only"]);
  picker.on_token_("/");
  assert.equal((picker.on_token_("<Space>") as { picked?: number }).picked, undefined);
});

test("Backspace trims the text, and on empty text returns to label mode with the labels intact", () => {
  const picker = text_picker();
  picker.on_token_("/");
  tokens(picker, ["n", "e"]);
  assert.equal((picker.on_token_("<Backspace>") as { text: string }).text, "n");
  assert.equal((picker.on_token_("<Backspace>") as { text: string }).text, "");
  assert.deepEqual(picker.on_token_("<Backspace>"), { kind: "handled", typed: "", still_possible_: [0, 1, 2, 3] });
  assert.deepEqual(picker.on_token_("s"), { kind: "handled", typed: "s", still_possible_: [1, 2, 3] });
});

test("the key that leaves text mode never picks, even with one hint", () => {
  const picker = create_picker(["a"], () => ["only"]);
  picker.on_token_("/");
  const outcome = picker.on_token_("<Backspace>");
  assert.equal(outcome.kind, "handled");
  assert.equal("picked" in outcome, false);
});

test("entering text mode never picks, even with one hint", () => {
  const outcome = create_picker(["a"], () => ["only"]).on_token_("/");
  assert.equal("picked" in outcome, false);
});

test("in text mode / is text, and in label mode Tab does not enter text mode", () => {
  const picker = text_picker();
  assert.deepEqual(picker.on_token_("<Tab>"), { kind: "handled", typed: "", still_possible_: [0, 1, 2, 3] });
  picker.on_token_("/");
  assert.deepEqual(picker.on_token_("/"), { kind: "handled", typed: "", still_possible_: [0, 1, 2, 3], text: "/", active: 0 });
});

test("Space in label mode asks for a rotation, and Enter, Tab and Shift-Tab are taken and do nothing", () => {
  const picker = text_picker();
  assert.deepEqual(picker.on_token_("<Space>"), { kind: "rotate" });
  assert.deepEqual(picker.on_token_("<Enter>"), { kind: "handled", typed: "", still_possible_: [0, 1, 2, 3] });
  assert.deepEqual(picker.on_token_("<S-Tab>"), { kind: "handled", typed: "", still_possible_: [0, 1, 2, 3] });
});

test("the texts are read when text mode first needs them, not before", () => {
  let reads = 0;
  const picker = create_picker(labels, () => (reads++, texts));
  picker.on_token_("s");
  picker.on_token_("<Space>");
  assert.equal(reads, 0);
  picker.on_token_("/");
  assert.equal(reads, 1);
});

test("the keys hint mode takes besides label letters", () => {
  assert.deepEqual(["<Tab>", "<S-Tab>", "<Enter>", "<Space>", "<Escape>", "a"].map(is_text_key), [true, true, true, true, false, false]);
});

test("a new picker is in label mode, as a rapid rebuild needs", () => {
  text_picker().on_token_("/");
  const second = text_picker();
  assert.deepEqual(second.on_token_("a"), { kind: "handled", typed: "a", still_possible_: [0], picked: 0 });
});

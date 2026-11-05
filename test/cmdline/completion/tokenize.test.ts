import assert from "node:assert/strict";
import { test } from "node:test";
import { cursor_context } from "../../../src/cmdline/completion/tokenize.ts";
import { create_word_lookup } from "../../../src/cmdline/word_lookup.ts";
import type { CommandMeta } from "../../../src/shared/command.ts";
import { lookup } from "./fixtures.ts";

const at_end = (text: string) => cursor_context(text, text.length, lookup.find);
const shape = (text: string) => {
  const context = at_end(text);
  return context.kind === "none" ? "none" : `${context.kind}:${context.word}:${context.start}-${context.end}`;
};

test("an empty line and a partial first word are command names", () => {
  assert.equal(shape(""), "command::0-0");
  assert.equal(shape(":tab."), "command:tab.:1-5");
  assert.equal(shape("  tc"), "command:tc:2-4");
});

test("a dash word after a command is a flag, even the bare dash", () => {
  assert.equal(shape("tab.close -"), "flag:-:10-11");
  assert.equal(shape("tab.close --ri"), "flag:--ri:10-14");
  assert.equal(shape("tab.close -l -"), "flag:-:13-14");
});

test("a number is not a flag", () => {
  assert.equal(shape("tab.close -5").split(":")[0], "subject");
});

test("after -- the words are subject, even a dash word", () => {
  assert.equal(shape("search --"), "flag:--:7-9");
  assert.equal(shape("search -- -x"), "subject:-x:10-12");
});

test("a prefilled command with a trailing space starts the subject", () => {
  const context = at_end("tab ");
  assert.equal(context.kind, "subject");
  assert.equal(context.kind === "subject" && context.position, 0);
});

test("the subject runs to the end of the line, so later words are further positions", () => {
  const context = at_end("tab one tw");
  assert.equal(context.kind === "subject" && context.position, 1);
});

test("an engine name keeps its dots", () => {
  const context = at_end("search github.repo.");
  assert.equal(context.kind === "subject" && context.word, "github.repo.");
});

test("a quoted word never completes, and neither does an open quote", () => {
  assert.equal(shape('tab.close "-l'), "none");
  assert.equal(shape('tab.close "-l"'), "none");
  assert.equal(shape('"tab.cl'), "none");
  assert.equal(shape("tab.close \\-l"), "none");
});

test("an unknown command gives nothing after it", () => {
  assert.equal(shape("nope -"), "none");
});

test("a value after = is a flag value and the span is the value", () => {
  const context = at_end("search -c=Wo");
  assert.equal(context.kind, "flag_value");
  assert.equal(context.kind === "flag_value" && context.param.name, "container");
  assert.equal(shape("search --container=Wo"), "flag_value:Wo:19-21");
  assert.equal(shape("search --nope=Wo"), "none");
});

test("the caret in the middle of a word replaces the whole word", () => {
  const context = cursor_context("tab.close --rig now", 14, lookup.find);
  assert.equal(context.kind === "flag" && `${context.word}:${context.start}-${context.end}`, "--ri:10-15");
});

test("a flag whose value is quoted keeps the flags open", () => {
  assert.equal(shape('search --container="Work X" -'), "flag:-:28-29");
  assert.equal(shape('search -c="Work X" -t'), "flag:-t:19-21");
  // A quote before the equals sign makes the word text, as in the grammar.
  assert.equal(shape('search "--container=Work" -').split(":")[0], "subject");
});

const HELP: CommandMeta = { id: "help.open", name: "help", label: "Help", intent: "Help.", params: [{ name: "name", type: "string", rest: true, main: true, default: "", values: ["Quick Start", "Commands"] }] };
const whole_text = create_word_lookup([HELP], {}).find;

test("a subject that picks by whole text spans from its first word to the end of the line", () => {
  const text = "help Quick S";
  const context = cursor_context(text, text.length, whole_text);
  assert.deepEqual(context.kind === "subject" && [context.position, context.word, context.start, context.end], [0, "Quick S", 5, 12]);
  const middle = cursor_context("help Quick S more", 12, whole_text);
  assert.deepEqual(middle.kind === "subject" && [middle.position, middle.word, middle.start, middle.end], [0, "Quick S", 5, 17]);
  const flagged = cursor_context("help -- Quick S", 15, whole_text);
  assert.deepEqual(flagged.kind === "subject" && [flagged.word, flagged.start], ["Quick S", 8]);
});

test("search keeps one word per position, with the engine first", () => {
  const context = at_end("search duck two");
  assert.deepEqual(context.kind === "subject" && [context.position, context.word, context.start, context.end], [1, "two", 12, 15]);
});

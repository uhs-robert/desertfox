// Finds the word under the caret and what kind of thing it should be: a command name, a flag, the value of a flag
// or the subject. Pure: it reads the text and a lookup, never the DOM.

import type { ParamDef } from "../../shared/command.ts";
import { parse_line, read_flag, tokenize } from "../../shared/registry/command_line.ts";
import type { CommandLookup } from "../../shared/registry/command_line.ts";
import { bare_word_param, find_param, is_dynamic_values, subject_param } from "../../shared/registry/params.ts";

type Command = NonNullable<ReturnType<CommandLookup["find"]>>;

// `start` and `end` bound the text a pick replaces. `word` is the part of it before the caret.
type Span = { word: string; start: number; end: number };

export type CursorContext =
  | ({ kind: "command" } & Span)
  // `typed` holds the flags already on the line, so a default that depends on them resolves.
  | ({ kind: "flag"; command: Command; typed: Record<string, unknown> } & Span)
  // The cursor is after the `=` of `--param=` or `-c=`, so the span is the value only.
  | ({ kind: "flag_value"; command: Command; param: ParamDef } & Span)
  // `position` counts the unmarked words before this one, so 0 is the first. A subject that picks by whole text is always 0, and its span runs from its first word to the end of the line.
  // `engine_settled`: a `--` or an `--engine=` flag came first, so the first word is the query and no engine.
  // `typed` holds the flags already on the line, so a list can narrow by them (`bookmark --folder=Work`).
  | ({ kind: "subject"; command: Command; position: number; engine_settled: boolean; typed: Record<string, unknown> } & Span)
  | { kind: "none" };

const NUMBER_WORD = /^-?\d+(\.\d+)?$/;

// A word the grammar reads as a flag attempt: a dash, one more character, and not a number.
const is_flag_word = (text: string) => text.length >= 2 && text.startsWith("-") && !NUMBER_WORD.test(text);

// A quoted value after the `=` of a flag still makes the word a flag: `--container="Work X"`.
function is_flag_token(token: { text: string; quoted_from: number | null }): boolean {
  if (token.quoted_from === null) return is_flag_word(token.text);
  const equals = token.text.indexOf("=");
  return equals > 0 && token.quoted_from > equals && is_flag_word(token.text.slice(0, equals));
}

// Where each word of `head` begins, and whether the text ends inside a word or inside an open quote.
function word_starts(head: string): { starts: number[]; in_word: boolean; quote_open: boolean } {
  const starts: number[] = [];
  let in_word = false;
  let quote = "";
  for (let index = 0; index < head.length; index++) {
    const char = head[index] as string;
    if (!quote && /\s/.test(char)) {
      in_word = false;
      continue;
    }
    if (!in_word) starts.push(index);
    in_word = true;
    if (char === "\\" && quote !== "'") index += 1;
    else if (quote) quote = char === quote ? "" : quote;
    else if (char === '"' || char === "'") quote = char;
  }
  return { starts, in_word, quote_open: quote !== "" };
}

// A subject that picks one of a list by its whole text, as a help name or a tab title does, so its words never split
// across positions. `set` has no list and `search` gives its first word to the engine, so both keep one word per position.
function picks_by_whole_text(command: Command): boolean {
  const subject = subject_param(command);
  const engine = bare_word_param(command);
  return subject?.main === true && subject.rest === true && subject.values !== undefined && !(engine && is_dynamic_values(engine.values));
}

function flag_value_context(command: Command, word: string, start: number, end: number): CursorContext {
  const equals = word.indexOf("=");
  const flag = word.slice(0, equals);
  const params = command.params ?? [];
  const param = flag.startsWith("--") ? find_param(command, flag.slice(2).replaceAll("-", "_")) : params.find((candidate) => typeof candidate.short === "string" && `-${candidate.short}` === flag);
  return param ? { kind: "flag_value", command, param, word: word.slice(equals + 1), start: start + equals + 1, end } : { kind: "none" };
}

export function cursor_context(text: string, caret: number, find: CommandLookup["find"]): CursorContext {
  // The prompt colon and leading space are not part of the line.
  const lead = text.match(/^[\s:]*/)?.[0].length ?? 0;
  if (caret < lead) return { kind: "none" };
  const head = text.slice(lead, caret);
  const { starts, in_word, quote_open } = word_starts(head);
  // A verbatim subject is raw text to the end of the line, so a quote inside it never groups. The parser says where it starts. A lone dash is still a flag being typed.
  const { command: verbatim, subject_start: verbatim_start } = parse_line({ find }, head);
  if (verbatim && verbatim_start !== undefined && head.slice(verbatim_start) !== "-") return { kind: "subject", command: verbatim, position: 0, engine_settled: false, typed: {}, word: head.slice(verbatim_start), start: lead + verbatim_start, end: text.length };
  const word_start = quote_open ? null : in_word ? (starts.at(-1) as number) : head.length;
  const tokens = word_start === null ? undefined : tokenize(head);
  if (word_start === null || !tokens || "error" in tokens) return { kind: "none" };
  const cursor = word_start === head.length ? undefined : tokens.at(-1);
  if (cursor && cursor.quoted_from !== null) return { kind: "none" };
  const before = cursor ? tokens.slice(0, -1) : tokens;
  const start = lead + word_start;
  const tail = text.slice(caret).search(/\s/);
  const end = tail < 0 ? text.length : caret + tail;
  const word = cursor?.text ?? "";
  if (before.length === 0) return { kind: "command", word, start, end };
  const [name, ...rest] = before;
  const command = name && name.quoted_from === null ? find(name.text) : undefined;
  if (!command) return { kind: "none" };
  // Flags come first and `--` ends them. The first unmarked word starts the subject, which runs to the end of the line.
  let flags_open = true;
  let position = 0;
  let engine_settled = false;
  const typed: Record<string, unknown> = {};
  let subject_start: number | undefined;
  let subject_first: number | undefined;
  for (const [index, earlier] of rest.entries()) {
    if (flags_open && earlier.quoted_from === null && earlier.text === "--") {
      flags_open = false;
      engine_settled = true;
    } else if (flags_open && is_flag_token(earlier)) {
      if (earlier.text.startsWith("--engine=")) engine_settled = true;
      const read = read_flag(command.name ?? command.id, command.params ?? [], earlier);
      if (!("error" in read)) {
        // An arm names a number as a number, and the flag arrives as text.
        const is_number = (read.param.type === "int" || read.param.type === "float") && typeof read.value === "string" && read.value.trim() !== "" && Number.isFinite(Number(read.value));
        typed[read.param.name] = is_number ? Number(read.value) : read.value;
      }
    } else {
      flags_open = false;
      position += 1;
      subject_start ??= starts[index + 1];
      subject_first ??= index;
    }
  }
  if (flags_open && word.startsWith("-") && !NUMBER_WORD.test(word)) {
    return word.includes("=") ? flag_value_context(command, word, start, end) : { kind: "flag", command, typed, word, start, end };
  }
  if (picks_by_whole_text(command)) {
    const from = subject_start === undefined ? start : lead + subject_start;
    // The span replaces the raw text, but ranking reads the subject as the parser does: quotes removed, one space between words.
    const subject_words = [...rest.slice(subject_first ?? rest.length), ...(cursor ? [cursor] : [])].map((token) => token.text);
    return { kind: "subject", command, position: 0, engine_settled, typed, word: subject_words.join(" "), start: from, end: text.length };
  }
  return { kind: "subject", command, position, engine_settled, typed, word, start, end };
}

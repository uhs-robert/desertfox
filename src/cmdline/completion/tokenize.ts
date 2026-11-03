// Finds the word under the caret and what kind of thing it should be: a command name, a flag, the value of a flag
// or the subject. Pure: it reads the text and a lookup, never the DOM.

import type { ParamDef } from "../../shared/command.ts";
import { tokenize } from "../../shared/registry/index.ts";
import type { CommandLookup } from "../../shared/registry/index.ts";
import { find_param } from "../../shared/registry/params.ts";

type Command = NonNullable<ReturnType<CommandLookup["find"]>>;

// `start` and `end` bound the text a pick replaces. `word` is the part of it before the caret.
type Span = { word: string; start: number; end: number };

export type CursorContext =
  | ({ kind: "command" } & Span)
  | ({ kind: "flag"; command: Command } & Span)
  // The cursor is after the `=` of `--param=` or `-c=`, so the span is the value only.
  | ({ kind: "flag_value"; command: Command; param: ParamDef } & Span)
  // `position` counts the unmarked words before this one, so 0 is the first.
  | ({ kind: "subject"; command: Command; position: number } & Span)
  | { kind: "none" };

const NUMBER_WORD = /^-?\d+(\.\d+)?$/;

// A word the grammar reads as a flag attempt: a dash, one more character, and not a number.
const is_flag_word = (text: string) => text.length >= 2 && text.startsWith("-") && !NUMBER_WORD.test(text);

// Where the word that ends at the end of `head` begins, or null while a quote is still open.
function last_word_start(head: string): number | null {
  let start = 0;
  let quote = "";
  for (let index = 0; index < head.length; index++) {
    const char = head[index] as string;
    if (char === "\\" && quote !== "'") index += 1;
    else if (quote) quote = char === quote ? "" : quote;
    else if (char === '"' || char === "'") quote = char;
    else if (/\s/.test(char)) start = index + 1;
  }
  return quote ? null : start;
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
  const word_start = last_word_start(head);
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
  for (const earlier of rest) {
    const unquoted = earlier.quoted_from === null;
    if (flags_open && unquoted && earlier.text === "--") flags_open = false;
    else if (flags_open && unquoted && is_flag_word(earlier.text)) continue;
    else {
      flags_open = false;
      position += 1;
    }
  }
  if (flags_open && word.startsWith("-") && !NUMBER_WORD.test(word)) {
    return word.includes("=") ? flag_value_context(command, word, start, end) : { kind: "flag", command, word, start, end };
  }
  return { kind: "subject", command, position, word, start, end };
}

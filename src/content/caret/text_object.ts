// Vim text objects `aw`, `iw`, `as` and `is` over plain text, as a cursor. Pure.
// A line is cut into units that alternate between text and blanks. `inner` is one unit, `around` adds the blank unit beside a text unit, or the text unit after a blank one.
// Objects stay on the caret's line: a block edge is where a sentence on a page ends.

import type { Cursor } from "./selection_state.ts";
import { char_class } from "./motion.ts";

export type TextObject = { object: "word" | "sentence"; scope: "around" | "inner" };

type Unit = { from: number; to: number; blank: boolean };

// Runs of one character class, as `w` sees them.
function word_units(line: string, offset: number): Unit[] {
  const units: Unit[] = [];
  for (let at = 0; at < line.length; ) {
    const kind = char_class(line, at, false);
    let end = at + 1;
    while (end < line.length && char_class(line, end, false) === kind) end++;
    units.push({ from: offset + at, to: offset + end, blank: kind === 0 });
    at = end;
  }
  return units;
}

// Each sentence the platform finds, split from the blanks around it.
function sentence_units(line: string, offset: number): Unit[] {
  const units: Unit[] = [];
  for (const { index, segment } of new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(line)) {
    const lead = segment.length - segment.trimStart().length;
    const body_end = segment.trimEnd().length;
    const parts = [
      { from: 0, to: lead, blank: true },
      { from: lead, to: body_end, blank: false },
      { from: Math.max(body_end, lead), to: segment.length, blank: true },
    ];
    for (const part of parts) if (part.to > part.from) units.push({ from: offset + index + part.from, to: offset + index + part.to, blank: part.blank });
  }
  return units;
}

// The last index an `around` object reaches when it starts in `units[at]`.
function around_end(units: Unit[], at: number): number {
  const next = units[at + 1];
  return (next && (units[at]!.blank || next.blank) ? next : units[at]!).to - 1;
}

function pick(units: Unit[], index: number, scope: TextObject["scope"]): Cursor {
  const at = units.findIndex((unit) => index >= unit.from && index < unit.to);
  const unit = units[at]!;
  if (scope === "inner") return { anchor: unit.from, caret: unit.to - 1 };
  const next = units[at + 1];
  const before = units[at - 1];
  // A text unit with no blank after it takes the blank before it, as vim does at the end of a line.
  if (!unit.blank && !next?.blank && before?.blank) return { anchor: before.from, caret: unit.to - 1 };
  return { anchor: unit.from, caret: around_end(units, at) };
}

// A selection of more than one character grows forward by one more object, from the character after its later end.
function grow(units: Unit[], cursor: Cursor, scope: TextObject["scope"]): Cursor | undefined {
  const first = Math.min(cursor.anchor, cursor.caret);
  const next = Math.max(cursor.anchor, cursor.caret) + 1;
  const at = units.findIndex((unit) => next >= unit.from && next < unit.to);
  if (at < 0) return undefined;
  return { anchor: first, caret: scope === "inner" ? units[at]!.to - 1 : around_end(units, at) };
}

// Undefined when the caret has no text object to take: an empty line, or a selection that already reaches the line's end.
export function select_object(text: string, cursor: Cursor, { object, scope }: TextObject): Cursor | undefined {
  const reach = Math.max(cursor.anchor, cursor.caret);
  if (text[cursor.caret] === "\n" || (cursor.anchor !== cursor.caret && text[reach + 1] === "\n")) return undefined;
  const start = text.lastIndexOf("\n", cursor.caret - 1) + 1;
  const newline = text.indexOf("\n", cursor.caret);
  const line = text.slice(start, newline < 0 ? text.length : newline);
  const units = (object === "word" ? word_units : sentence_units)(line, start);
  return cursor.anchor === cursor.caret ? pick(units, cursor.caret, scope) : grow(units, cursor, scope);
}

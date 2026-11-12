// Vim motions over plain text. A position is the index of the character under the caret. Lines end at "\n".
// The caret never rests on a "\n" except on an empty line, where that "\n" is the line itself.
// Motions along the screen line (j k 0 ^ $) are not here: where text wraps is the browser's to say.

type TextUnit = "char" | "word" | "word_end" | "start" | "end";
type ScreenUnit = "line" | "line_start" | "line_first" | "line_end";
export type MotionUnit = TextUnit | ScreenUnit;
export type Direction = "forward" | "back";
// Two engines: the text motions here, and the screen line motions of screen_line.ts, which only layout can answer. `big` means nothing to the screen line ones.
export type TextMotion = { unit: TextUnit; direction: Direction; big: boolean };
export type ScreenMotion = { unit: ScreenUnit; direction: Direction };

// Letters and digits of any script, and the underscore.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

// Class of a character: -1 newline, 0 blank, 1 word, 2 punctuation. A big word has only classes -1, 0 and 1.
export const char_class = (text: string, index: number, big: boolean): number => {
  const char = text[index]!;
  if (char === "\n") return -1;
  if (/\s/.test(char)) return 0;
  if (big || WORD_CHAR.test(char)) return 1;
  return 2;
};

const line_start_of = (text: string, index: number) => text.lastIndexOf("\n", index - 1) + 1;

// Last character of the line, or the empty line's "\n".
const line_end_of = (text: string, index: number) => {
  const newline = text.indexOf("\n", index);
  const end = newline < 0 ? text.length : newline;
  return Math.max(end - 1, line_start_of(text, index));
};

const first_non_blank_of = (text: string, index: number) => {
  const end = line_end_of(text, index);
  let at = line_start_of(text, index);
  while (at < end && char_class(text, at, false) === 0) at++;
  return at;
};

const is_empty_line = (text: string, index: number) => text[index] === "\n" && (index === 0 || text[index - 1] === "\n");

// Blanks, and newlines that end a non-empty line, lie between words.
const is_gap = (text: string, index: number, big: boolean) => char_class(text, index, big) === 0 || (text[index] === "\n" && !is_empty_line(text, index));

function word_forward(text: string, from: number, big: boolean): number {
  let index = from;
  const own = char_class(text, index, big);
  if (own > 0) while (index < text.length && char_class(text, index, big) === own) index++;
  else if (own < 0) index++;
  while (index < text.length && is_gap(text, index, big)) index++;
  return Math.min(index, text.length - 1);
}

function word_back(text: string, from: number, big: boolean): number {
  let index = Math.max(from - 1, 0);
  while (index > 0 && is_gap(text, index, big)) index--;
  if (is_empty_line(text, index)) return index;
  const own = char_class(text, index, big);
  while (index > 0 && char_class(text, index - 1, big) === own) index--;
  return index;
}

function word_end_forward(text: string, from: number, big: boolean): number {
  let index = from + 1;
  while (index < text.length && (char_class(text, index, big) <= 0)) index++;
  if (index >= text.length) return text.length - 1;
  const own = char_class(text, index, big);
  while (index + 1 < text.length && char_class(text, index + 1, big) === own) index++;
  return index;
}

function word_end_back(text: string, from: number, big: boolean): number {
  let index = from;
  const own = char_class(text, index, big);
  while (index > 0 && own > 0 && char_class(text, index, big) === own) index--;
  while (index > 0 && char_class(text, index, big) <= 0 && !is_empty_line(text, index)) index--;
  return index;
}

const SCREEN_UNITS: readonly MotionUnit[] = ["line", "line_start", "line_first", "line_end"];
export const is_screen_unit = (unit: MotionUnit): unit is ScreenUnit => SCREEN_UNITS.includes(unit);

// One step of a motion over the text.
export function move_once(text: string, from: number, motion: TextMotion): number {
  if (text.length === 0) return 0;
  const forward = motion.direction === "forward";
  switch (motion.unit) {
    case "char": {
      const next = from + (forward ? 1 : -1);
      return next >= 0 && next < text.length && text[next] !== "\n" && text[from] !== "\n" ? next : from;
    }
    case "word":
      return forward ? word_forward(text, from, motion.big) : word_back(text, from, motion.big);
    case "word_end":
      return forward ? word_end_forward(text, from, motion.big) : word_end_back(text, from, motion.big);
    case "start":
      return first_non_blank_of(text, 0);
    case "end":
      return first_non_blank_of(text, text.length - 1);
  }
}

export type CharFind = { char: string; direction: "forward" | "back"; till: boolean };

// Every start of `char` in the text, ascending and exact case. A find reaches the whole page, and these are what it highlights.
export function find_char_matches(text: string, char: string): number[] {
  const matches: number[] = [];
  for (let at = text.indexOf(char); at >= 0; at = text.indexOf(char, at + 1)) matches.push(at);
  return matches;
}

// Where `t` leaves the caret for a match at `match`: next to it. A match that opens or closes a line would leave the caret on the line break, where no motion can move, so the caret takes the last character of the line instead.
function till_stop(text: string, match: number, step: number): number {
  const stop = match - step;
  if (text[stop] !== "\n") return stop;
  return step > 0 ? Math.max(stop - 1, 0) : match;
}

// `f`, `t`, `F` and `T`: the caret and the match of the count-th match anywhere in the text, or undefined when fewer remain.
// `again` is `;` and `,`: a till find then skips a match that would leave the caret where it is, as vim does, so repeating it advances.
export function find_char_hit(text: string, from: number, find: CharFind, count: number, again = false): { caret: number; match: number } | undefined {
  const step = find.direction === "forward" ? 1 : -1;
  let remaining = count;
  for (let at = from + step; at >= 0 && at < text.length; at += step) {
    if (!text.startsWith(find.char, at)) continue;
    const caret = find.till ? till_stop(text, at, step) : at;
    if (again && caret === from) continue;
    if (--remaining === 0) return { caret, match: at };
  }
  return undefined;
}

export const find_char = (text: string, from: number, find: CharFind, count: number, again = false): number => find_char_hit(text, from, find, count, again)?.caret ?? from;

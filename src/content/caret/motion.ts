// Vim motions over plain text. A position is the index of the character under the caret. Lines end at "\n".
// The caret never rests on a "\n" except on an empty line, where that "\n" is the line itself.

export type MotionUnit = "char" | "word" | "word_end" | "line" | "line_start" | "line_first" | "line_end" | "start" | "end";
export type Motion = { unit: MotionUnit; direction: "forward" | "back"; big: boolean };

// Class of a character: -1 newline, 0 blank, 1 word, 2 punctuation. A big word has only classes -1, 0 and 1.
const char_class = (text: string, index: number, big: boolean): number => {
  const char = text[index]!;
  if (char === "\n") return -1;
  if (/\s/.test(char)) return 0;
  if (big || /\w/.test(char)) return 1;
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

// Line moves keep a wanted column, so a short line in between does not lose it.
function line_move(text: string, from: number, forward: boolean, wanted_column: number): number {
  const start = line_start_of(text, from);
  let target_start: number;
  if (forward) {
    const next = text.indexOf("\n", from);
    if (next < 0 || next === text.length - 1) return from;
    target_start = next + 1;
  } else {
    if (start === 0) return from;
    target_start = line_start_of(text, start - 1);
  }
  return Math.min(target_start + wanted_column, line_end_of(text, target_start));
}

export function column_of(text: string, index: number): number {
  return index - line_start_of(text, index);
}

// One step of a motion. `wanted_column` only matters for "line".
export function move_once(text: string, from: number, motion: Motion, wanted_column = column_of(text, from)): number {
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
    case "line":
      return line_move(text, from, forward, wanted_column);
    case "line_start":
      return line_start_of(text, from);
    case "line_first":
      return first_non_blank_of(text, from);
    case "line_end":
      return line_end_of(text, from);
    case "start":
      return first_non_blank_of(text, 0);
    case "end":
      return first_non_blank_of(text, text.length - 1);
  }
}

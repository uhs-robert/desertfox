// Labels for hints. No label is the start of another, so a complete label can run at once.

export const DEFAULT_HINT_LETTERS = "asdfghjkl";

// Lowercase, no repeats, no blanks. Fewer than two usable letters fall back to the default, because one letter cannot split.
export function clean_letters(letters: unknown): string[] {
  const unique = typeof letters === "string" ? [...new Set(letters.toLowerCase().replace(/\s/g, ""))] : [];
  return unique.length >= 2 ? unique : [...DEFAULT_HINT_LETTERS];
}

// Splitting the shortest label into one per letter keeps the set prefix-free and the labels short.
// With few targets every label is one letter, in the order of the alphabet.
export function make_labels(count: number, letters: readonly string[]): string[] {
  const labels = [...letters];
  while (labels.length < count) {
    const split = labels.shift()!;
    for (const letter of letters) labels.push(split + letter);
  }
  return labels.slice(0, count);
}

export type Narrowed = { still_possible_: number[]; complete: number | undefined };

// Which labels still start with what was typed, by index. `complete` is set once exactly one label equals the typed text.
export function narrow(labels: readonly string[], typed: string): Narrowed {
  const still_possible_: number[] = [];
  let complete: number | undefined;
  labels.forEach((label, index) => {
    if (!label.startsWith(typed)) return;
    still_possible_.push(index);
    if (label === typed) complete = index;
  });
  return { still_possible_, complete };
}

export type Box = { left: number; top: number; right: number; bottom: number };

const overlaps = (a: Box, b: Box): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Sets of boxes that cover each other, directly or through a chain, as indexes in the order given. A box that covers nothing is in no set.
export function overlap_groups(boxes: readonly Box[]): number[][] {
  const seen = new Set<number>();
  const groups: number[][] = [];
  boxes.forEach((_, start) => {
    if (seen.has(start)) return;
    seen.add(start);
    const group = [start];
    for (let next = 0; next < group.length; next++) {
      boxes.forEach((box, other) => {
        if (seen.has(other) || !overlaps(boxes[group[next]!]!, box)) return;
        seen.add(other);
        group.push(other);
      });
    }
    if (group.length > 1) groups.push(group.sort((a, b) => a - b));
  });
  return groups;
}

// Bottom to top in, bottom to top out: the label on top goes to the bottom, so the next one shows.
export const rotate = <T>(stack: readonly T[]): T[] => (stack.length < 2 ? [...stack] : [stack[stack.length - 1]!, ...stack.slice(0, -1)]);

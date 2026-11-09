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

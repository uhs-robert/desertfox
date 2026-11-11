// Rapid copy: the picks of one hint session collect into one list, one entry per line.

// The first pick of a text wins and a repeat changes nothing, as in the link list of `copy.links`. Returns the text for the clipboard and the toast words.
export function collect_pick(collected: string[], text: string, nouns: readonly [one: string, many: string]): { text: string; what: string } {
  if (!collected.includes(text)) collected.push(text);
  return { text: collected.join("\n"), what: `${collected.length} ${nouns[collected.length === 1 ? 0 : 1]}` };
}

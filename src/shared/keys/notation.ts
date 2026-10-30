// Parses vim-style key sequences such as `gx$`, `<A-j>` or `<AC-Escape>` into
// normalized tokens, see token.ts.

import { format_token } from "./token.ts";

export type ParseResult = { tokens: string[]; error?: undefined } | { tokens?: undefined; error: string };

const CHORD = /^<((?:[ACMS]+-)*)([^\s>]|[A-Za-z][A-Za-z0-9]+)>/;

function normalize_chord(mod_groups: string, name: string): string | { error: string } {
  const mod_letters = new Set(mod_groups.replace(/-/g, ""));
  const is_single_char = name.length === 1;
  if (is_single_char && name.toLowerCase() !== name.toUpperCase()) {
    name = name.toLowerCase();
    if (mod_letters.has("S") && mod_letters.size === 1) return name.toUpperCase();
  } else if (is_single_char && mod_letters.has("S")) {
    return { error: `Shift on "${name}" depends on the layout, write the character itself` };
  }
  if (is_single_char && mod_letters.size === 0) return { error: `"<${name}>" has no modifier` };
  const mods = ["A", "C", "M", "S"].filter((letter) => mod_letters.has(letter)).join("");
  return format_token(mods, name === " " ? "Space" : name);
}

export function parse_sequence(sequence: string): ParseResult {
  const tokens: string[] = [];
  let rest = sequence;
  while (rest !== "") {
    const chord = rest[0] === "<" ? CHORD.exec(rest) : null;
    if (chord) {
      const token = normalize_chord(chord[1]!, chord[2]!);
      if (typeof token !== "string") return token;
      tokens.push(token);
      rest = rest.slice(chord[0].length);
      continue;
    }
    const char = String.fromCodePoint(rest.codePointAt(0)!);
    if (/\s/.test(char)) return { error: `Whitespace in "${sequence}", write <Space>` };
    tokens.push(char);
    rest = rest.slice(char.length);
  }
  return tokens.length === 0 ? { error: "Empty key sequence" } : { tokens };
}

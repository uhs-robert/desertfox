// Checks a font family list typed into a setting and returns it as canonical CSS text, like `parse_color` for colors. The setting value goes into a style
// sheet without any other check, so this parser is the only guard: it accepts names and nothing that could leave the declaration.

export const MAX_FONT_ITEMS = 8;
export const MAX_FONT_LENGTH = 200;

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-monospace", "cursive", "fantasy", "ui-serif", "ui-sans-serif", "ui-rounded"]);
// A name is quoted in the output whatever it looked like, so a bare name needs no identifier shape: the command line strips quotes, and real names start with digits or hold non-ASCII.
const SAFE_NAME = /^[^"'\\<>{};\p{Cc}]+$/u;
const QUOTED_NAME = /^(["'])(.*)\1$/su;
const REFUSED_TEXT = /[\r\n]|\/\*|var\(|url\(|!\s*important/i;

function parse_item(item: string): string | undefined {
  const quoted = QUOTED_NAME.exec(item);
  const name = (quoted ? quoted[2]! : item).trim().replace(/\s+/g, " ");
  if (!SAFE_NAME.test(name)) return undefined;
  return !quoted && GENERIC_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : `"${name}"`;
}

// The canonical text (`"A", "B", monospace`), "" for an empty value (unset), or undefined when the value is refused.
export function parse_font_family(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text === "") return "";
  if (text.length > MAX_FONT_LENGTH || REFUSED_TEXT.test(text)) return undefined;
  const items = text.split(",").map((item) => parse_item(item.trim()));
  if (items.length > MAX_FONT_ITEMS || items.includes(undefined)) return undefined;
  return items.join(", ");
}

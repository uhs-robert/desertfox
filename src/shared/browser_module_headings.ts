// The reply of `page_headings.read`: the headings of a page the module read for the command line list of `sh`, where DesertFox's own page code does not run. The reply is foreign input. It is checked here before the list is shown, and the module keeps the same caps (browser_module/desertfox-page-keys.js).
// The text is only listed and matched against what the user types. Nothing is run or opened by it.

import type { HeadingItem } from "./messages/content.ts";
import { RuntimeRefusal } from "./command.ts";
import { best_match } from "./score.ts";

export const MAX_HEADINGS = 300;
export const MAX_HEADING_CHARS = 120;
// The reply value as JSON text. The kind's own limit is 48 KB for the whole reply, and the value is escaped inside it.
export const MAX_HEADINGS_BYTES = 40_000;

// Control and format characters go, whitespace runs become one space, then the cap.
const cleaned_text = (raw: string): string => [...raw.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim()].slice(0, MAX_HEADING_CHARS).join("");

// The rows of the reply value, or undefined when the whole reply is refused: text over the byte cap, not JSON, or not a list. A bad entry is skipped. Only the first MAX_HEADINGS entries are read.
export function parse_page_headings(value: string | undefined): HeadingItem[] | undefined {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > MAX_HEADINGS_BYTES) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const rows: HeadingItem[] = [];
  for (const entry of parsed.slice(0, MAX_HEADINGS)) {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0]) || entry[0] < 1 || entry[0] > 6 || typeof entry[1] !== "string") continue;
    rows.push({ level: entry[0], text: cleaned_text(entry[1]) });
  }
  return rows;
}

const NUMBER_PICK = /^(\d+)(?:\s+(.*))?$/s;

// `3 Install` is what a completion pick puts in the line: the heading at place 3 of the list, then its text. The number wins over the text,
// because the text may have changed since the pick. A number past the end of the list is part of the text, so "2024" finds a heading titled 2024.
// Other text is the best fuzzy match, the same ranking the list shows. An equal tie takes the one that comes first on the page.
export function pick_heading(rows: readonly HeadingItem[], typed: string): number {
  const text = typed.trim();
  const numbered = NUMBER_PICK.exec(text);
  if (numbered) {
    const place = Number(numbered[1]);
    if (place >= 1 && place <= rows.length) return place - 1;
  }
  const match = best_match(text, rows.map((row, index) => ({ row, index })), ({ row }) => ({ name: row.text, description: `h${row.level}` }));
  if (match.found === "none") throw new RuntimeRefusal(`No heading matches ${text}`);
  return (match.found === "one" ? match.item : match.first).index;
}

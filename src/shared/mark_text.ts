// The text of a mark or quickmark in a list, shared by the which-key rows and the command line list so both read alike.

import { PREVIOUS_MARK } from "./mark_names.ts";
import type { MarkItem } from "./messages.ts";

const ADDRESS_CHARS = 36;

// The scheme is dropped: it is nearly always https.
export function shorten_address(url: string): string {
  const address = url.replace(/^https?:\/\//, "");
  return address.length > ADDRESS_CHARS ? `${address.slice(0, ADDRESS_CHARS - 1)}…` : address;
}

// A global mark leads with its address, which tells two marks apart.
export function mark_text({ x, y, url }: Pick<MarkItem, "x" | "y" | "url">): string {
  const offset = x === 0 ? `y ${y}` : `x ${x} y ${y}`;
  return url === undefined ? offset : `${shorten_address(url)}  ${offset}`;
}

// `'` is the position the last jump left, not a mark the user named, so the list and the delete leave it out.
export const listed_marks = (items: readonly MarkItem[]): MarkItem[] => items.filter((item) => item.key !== PREVIOUS_MARK);

// The rows the command line list shows: the key and its text. The marks keep the order they come in (the page's, then the global ones). The quickmarks sort by key.
export const mark_list_rows = (items: readonly MarkItem[]): { name: string; description: string }[] => listed_marks(items).map((item) => ({ name: item.key, description: mark_text(item) }));

export const quickmark_list_rows = (table: Readonly<Record<string, string>>): { name: string; description: string }[] =>
  Object.entries(table)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, url]) => ({ name: key, description: shorten_address(url) }));

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

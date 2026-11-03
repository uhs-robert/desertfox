// The caret and the visual selection as two character indexes in a text model, drawn as a real Selection.
// Caret mode selects the one character under the caret: Firefox paints no caret on a collapsed selection in page text.
// Visual mode selects from the anchor to the caret, both ends included.

import { column_of, move_once } from "./motion.ts";
import type { Motion } from "./motion.ts";

export type Cursor = { anchor: number; caret: number };

export const selected_span = ({ anchor, caret }: Cursor) => ({ from: Math.min(anchor, caret), to: Math.max(anchor, caret) + 1 });

export const selected_text = (text: string, cursor: Cursor): string => {
  const { from, to } = selected_span(cursor);
  return text.slice(from, to);
};

// Runs one motion. `wanted_column` survives only across line moves, so the caller passes it back in.
export function move_cursor(text: string, cursor: Cursor, motion: Motion, extend: boolean, wanted_column: number | undefined): { cursor: Cursor; wanted_column: number | undefined } {
  const caret = move_once(text, cursor.caret, motion, wanted_column);
  const column = motion.unit === "line" ? (wanted_column ?? column_of(text, cursor.caret)) : undefined;
  return { cursor: { anchor: extend ? cursor.anchor : caret, caret }, wanted_column: column };
}

export function swap_ends({ anchor, caret }: Cursor): Cursor {
  return { anchor: caret, caret: anchor };
}

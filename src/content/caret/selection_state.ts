// The caret and the visual selection as two character indexes in a text model. `selection_mirror.ts` draws them: visual mode as a real Selection, caret mode as a highlight cell on the one character under the caret, because Firefox paints no caret on a collapsed selection in page text.
// Visual mode selects from the anchor to the caret, both ends included. Linewise visual mode widens that to whole screen lines.

export type Cursor = { anchor: number; caret: number };
export type CaretMode = "caret" | "visual" | "visual_line";
export type Span = { from: number; to: number };
// Where the screen line that holds a character starts and ends, both characters included. Only layout knows where a line wraps, so the caller measures it.
export type LineBounds = { start_of_: (index: number) => number; end_of: (index: number) => number };

export const is_visual = (mode: CaretMode): boolean => mode !== "caret";

export const selected_span = ({ anchor, caret }: Cursor): Span => ({ from: Math.min(anchor, caret), to: Math.max(anchor, caret) + 1 });

// From the start of the earlier end's line to the end of the later end's line. A bound on the wrong side of its end, as a failed measure gives, leaves that end as it is.
export function line_span(cursor: Cursor, { start_of_, end_of }: LineBounds): Span {
  const { from, to } = selected_span(cursor);
  return { from: Math.min(from, start_of_(from)), to: Math.max(to, end_of(to - 1) + 1) };
}

export const selected_text = (text: string, { from, to }: Span): string => text.slice(from, to);

// One motion's result as a cursor. Visual mode keeps the anchor.
export const with_caret = (cursor: Cursor, caret: number, extend: boolean): Cursor => ({ anchor: extend ? cursor.anchor : caret, caret });

export function swap_ends({ anchor, caret }: Cursor): Cursor {
  return { anchor: caret, caret: anchor };
}

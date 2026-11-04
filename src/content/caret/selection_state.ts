// The caret and the visual selection as two character indexes in a text model, drawn as a real Selection.
// Caret mode selects the one character under the caret: Firefox paints no caret on a collapsed selection in page text.
// Visual mode selects from the anchor to the caret, both ends included.

export type Cursor = { anchor: number; caret: number };

export const selected_span = ({ anchor, caret }: Cursor) => ({ from: Math.min(anchor, caret), to: Math.max(anchor, caret) + 1 });

export const selected_text = (text: string, cursor: Cursor): string => {
  const { from, to } = selected_span(cursor);
  return text.slice(from, to);
};

// One motion's result as a cursor. Visual mode keeps the anchor.
export const with_caret = (cursor: Cursor, caret: number, extend: boolean): Cursor => ({ anchor: extend ? cursor.anchor : caret, caret });

export function swap_ends({ anchor, caret }: Cursor): Cursor {
  return { anchor: caret, caret: anchor };
}

// Points an open session at a rebuilt model with a new cursor, in place. A copy in flight holds the session object, and only the same object tells it the session is still its own.
export function retarget<Open extends { model: unknown; cursor: Cursor; goal_x: number | undefined; painted: unknown[] }>(open: Open, model: Open["model"], cursor: Cursor): Open {
  return Object.assign(open, { model, cursor, goal_x: undefined, painted: [] });
}

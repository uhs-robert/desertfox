// The page's own selection, read as a span with its direction. A drag leaves one, and so does a find. `selected_span` and a Range have no direction, so it comes from the anchor and focus.

import type { Cursor } from "./selection_state.ts";
import type { TextModel } from "./text_model.ts";

const TEXT_NODE = 3;

// The span of characters a selection covers, when it lies in the model's text.
export function selection_span(model: TextModel, selection: Selection): { first: number; last: number } | undefined {
  if (selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  const first = model.index_of(range.startContainer, range.startOffset);
  const last_range = selection.getRangeAt(selection.rangeCount - 1);
  const end = last_range.endContainer;
  const end_in_text = end.nodeType === TEXT_NODE;
  let last: number | undefined = first;
  if (selection.rangeCount > 1 || !range.collapsed) {
    // An end on an empty line is the <br> itself, painted without the +1 a text end has. A text end at offset 0 excludes its own character, so the span stops one before it.
    const end_index = model.index_of(end, end_in_text ? Math.max(last_range.endOffset - 1, 0) : last_range.endOffset);
    last = end_in_text && last_range.endOffset === 0 && end_index !== undefined ? Math.max(end_index - 1, first ?? 0) : end_index;
  }
  return first === undefined || last === undefined ? undefined : { first, last };
}

// The anchor and caret a drag left: the caret on the end where the mouse was released. Undefined for a click, which has no span to carry, and for a selection outside the model.
export function page_selection_cursor(model: TextModel, selection: Selection): Cursor | undefined {
  if (selection.rangeCount === 0 || selection.isCollapsed) return undefined;
  const found = selection_span(model, selection);
  if (!found) return undefined;
  const start = selection.getRangeAt(0);
  const is_backward = selection.focusNode === start.startContainer && selection.focusOffset === start.startOffset && !(selection.anchorNode === selection.focusNode && selection.anchorOffset === selection.focusOffset);
  return is_backward ? { anchor: found.last, caret: found.first } : { anchor: found.first, caret: found.last };
}

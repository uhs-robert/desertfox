// The one writer of the page selections in caret and visual mode. It paints a span, keeps the ends of each selection as it left them, and tells a later change by someone else (a drag, a click, a find, a page script) from its own paint by comparing those ends.
// It compares at the moment of asking and listens to no `selectionchange`: Firefox fires that event late, for this script's own paints and measures too.

import { deepest_focused_element } from "../editable.ts";
import { page_selection_cursor, selection_span } from "./page_selection.ts";
import { apply_selection_colors, clear_selection_colors, keep_selection_colors } from "./selection_colors.ts";
import { with_caret } from "./selection_state.ts";
import type { CaretMode, Cursor, Span } from "./selection_state.ts";
import { documents_of } from "./text_model.ts";
import type { TextModel } from "./text_model.ts";

// The ends of each selection at one moment, to compare with a later moment.
export type SelectionMark = readonly { selection: Selection; ends: readonly unknown[] }[];

export type SelectionMirror = ReturnType<typeof create_selection_mirror>;

export const selections_of = (model: TextModel): Selection[] => documents_of(model).flatMap((owner) => owner.getSelection() ?? []);

function ends_of(selection: Selection): unknown[] {
  if (selection.rangeCount === 0) return [];
  const first = selection.getRangeAt(0);
  const last = selection.getRangeAt(selection.rangeCount - 1);
  // The anchor and focus are in it because a span drawn again the other way round has the same range ends.
  return [first.startContainer, first.startOffset, last.endContainer, last.endOffset, selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset];
}

const same_ends = (one: readonly unknown[], other: readonly unknown[]) => one.length === other.length && one.every((end, at) => end === other[at]);

const mark_of = (model: TextModel): SelectionMark => selections_of(model).map((selection) => ({ selection, ends: ends_of(selection) }));

function in_focused_editable(selection: Selection, focused: Element | null): boolean {
  return focused instanceof HTMLElement && focused.isContentEditable && focused.contains(selection.anchorNode);
}

export function create_selection_mirror(deps = { focused_element_: deepest_focused_element }) {
  // The selections as the last paint left them. Empty outside a session.
  let painted: SelectionMark = [];

  // A Range stays in one tree, so a span across a shadow root or a frame takes one range per tree. Firefox keeps several ranges in one selection.
  function draw(model: TextModel, { from, to }: Span): void {
    const runs = model.tree_runs_(from, to);
    runs.forEach((run, at) => {
      // The line end before the next tree has no character to select.
      let run_to = run.to;
      while (at < runs.length - 1 && run_to > run.from + 1 && model.text[run_to - 1] === "\n") run_to--;
      const start = model.point_at_(run.from);
      const end = model.point_at_(run_to - 1);
      const owner = start.node.ownerDocument!;
      const range = owner.createRange();
      range.setStart(start.node, start.offset);
      // An empty line has no character to select, so the caret there is not drawn.
      range.setEnd(end.node, model.text[run_to - 1] === "\n" ? end.offset : end.offset + 1);
      owner.getSelection()?.addRange(range);
    });
  }

  return {
    paint(model: TextModel, span: Span): void {
      // The last paint can sit in a document the model no longer reads, such as a frame that lost its text.
      for (const { selection } of painted) {
        try {
          selection.removeAllRanges();
        } catch {}
      }
      for (const selection of selections_of(model)) selection.removeAllRanges();
      draw(model, span);
      painted = mark_of(model);
      keep_selection_colors(model.trees);
    },

    // Runs `measure_layout` (`Selection.modify`, which moves a selection of the model to ask layout where a line goes), then puts the ranges of every selection of the model back, even when it throws. Most often that is the last paint.
    // Firefox takes the anchor and focus from the range added last, and `getRangeAt` answers in document order, so the anchor's range goes back last. A paint's ends then come back the same, and no mark reads the measure as an outside move.
    // Each range comes back forward, so a backward drag loses its direction until the paint that follows each measure draws over it. `setBaseAndExtent` keeps a direction, but the spec has it ignore a node in a shadow root.
    measure<Answer>(model: TextModel, measure_layout: () => Answer): Answer {
      const saved = selections_of(model).map((selection) => {
        const ranges = Array.from({ length: selection.rangeCount }, (_, at) => selection.getRangeAt(at).cloneRange());
        const { anchorNode: node, anchorOffset: offset } = selection;
        const holds_anchor = (range: Range) => (range.startContainer === node && range.startOffset === offset) || (range.endContainer === node && range.endOffset === offset);
        return { selection, ranges: [...ranges.filter((range) => !holds_anchor(range)), ...ranges.filter(holds_anchor)] };
      });
      try {
        return measure_layout();
      } finally {
        for (const { selection, ranges } of saved) {
          selection.removeAllRanges();
          for (const range of ranges) selection.addRange(range);
        }
      }
    },

    mark: mark_of,

    // True when a selection of `mark` changed since, or its frame left the page.
    moved_since_: (mark: SelectionMark): boolean =>
      mark.some(({ selection, ends }) => {
        try {
          return !same_ends(ends_of(selection), ends);
        } catch {
          return true;
        }
      }),

    // Where something else put a selection of the model since the last paint, as a cursor: a drag whole, in either mode, because the next key may switch the mode. A click keeps the anchor when `extend` is set and takes the click. Undefined when no selection moved into the model's text.
    foreign_cursor_(model: TextModel, cursor: Cursor, extend: boolean): Cursor | undefined {
      for (const selection of selections_of(model)) {
        if (same_ends(ends_of(selection), painted.find((record) => record.selection === selection)?.ends ?? [])) continue;
        const found = selection_span(model, selection);
        if (found) return page_selection_cursor(model, selection) ?? with_caret(cursor, found.first, extend);
      }
    },

    set_mode_colors_: (mode: CaretMode): Promise<void> => apply_selection_colors(mode),

    // Ends the session's selection in `model`, in this document and wherever the last paint left it, such as a frame that lost its text. A focused contenteditable field keeps its own caret in the document selection.
    clear(model: TextModel | undefined): void {
      const focused = deps.focused_element_();
      for (const selection of [...painted.map((record) => record.selection), ...(model ? selections_of(model) : []), getSelection()]) {
        // A frame that left the page throws on any read of its selection.
        try {
          if (selection && !in_focused_editable(selection, focused)) selection.removeAllRanges();
        } catch {}
      }
      painted = [];
      clear_selection_colors();
    },
  };
}

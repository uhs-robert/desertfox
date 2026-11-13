// The one writer of the page selections in caret and visual mode. It paints a span, keeps the ends of each selection as it left them, and tells a later change by someone else (a drag, a click, a find, a page script) from its own paint by comparing those ends.
// Caret mode writes no selection: its cell is a highlight, so any selection there is outside input.
// It compares at the moment of asking and listens to no `selectionchange`: Firefox fires that event late, for this script's own paints and measures too.

import { page_selection_cursor, selection_span } from "./page_selection.ts";
import { CARET_NAMES, create_painter } from "./find_paint.ts";
import { apply_selection_colors, clear_selection_colors, keep_selection_colors } from "./selection_colors.ts";
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

export function create_selection_mirror() {
  // The selections as the last paint left them. Empty outside a session.
  let painted: SelectionMark = [];
  const cell = create_painter(CARET_NAMES);

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
    // Caret mode draws `span`, one character, as the cell. A line break has no character to cover, so the caret there is not drawn.
    paint(model: TextModel, span: Span, mode: CaretMode): void {
      // The last paint can sit in a document the model no longer reads, such as a frame that lost its text.
      for (const { selection } of painted) {
        try {
          selection.removeAllRanges();
        } catch {}
      }
      for (const selection of selections_of(model)) selection.removeAllRanges();
      if (mode !== "caret") {
        cell.clear();
        draw(model, span);
      } else cell.paint(model, { from: [span.from], width: 1 }, 0, undefined, model.text[span.from] === "\n" ? [] : [0]);
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

    // Where something else put a selection of the model since the last paint: a drag whole as a cursor, in either mode, because the next key may switch the mode, and a click as the index it landed on. Undefined when no selection moved into the model's text.
    foreign_move_(model: TextModel): Cursor | number | undefined {
      for (const selection of selections_of(model)) {
        if (same_ends(ends_of(selection), painted.find((record) => record.selection === selection)?.ends ?? [])) continue;
        const found = selection_span(model, selection);
        if (found) return page_selection_cursor(model, selection) ?? found.first;
      }
    },

    set_mode_colors_: (mode: CaretMode): Promise<void> => apply_selection_colors(mode),

    // Ends the session's cell and selection, wherever the last paint left them, such as a frame that lost its text. A selection that moved since is someone else's, such as a focused contenteditable field's caret, and stays.
    clear(): void {
      for (const { selection, ends } of painted) {
        // A frame that left the page throws on any read of its selection.
        try {
          if (same_ends(ends_of(selection), ends)) selection.removeAllRanges();
        } catch {}
      }
      painted = [];
      cell.clear();
      clear_selection_colors();
    },
  };
}

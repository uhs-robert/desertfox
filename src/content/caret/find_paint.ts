// Paints the matches with the CSS Custom Highlight API, which draws a Range without touching the page's DOM.
// A highlight registry belongs to one document, but a `::highlight()` rule only reaches the tree whose stylesheet holds it.
// So each tree with text, each shadow root and each frame document, adopts a sheet of its own.

import { create_sheet_set, owner_of } from "./adopted_sheets.ts";
import type { TextModel } from "./text_model.ts";

// Painting a hundred thousand ranges would stall the page, so only a window of matches around the current one is painted.
export const PAINT_CAP = 2000;

// The indexes to paint: the current match with about half the cap on each side, wrapping at the ends of the page.
export function paint_indexes(current: number, count: number, cap = PAINT_CAP): number[] {
  const shown = Math.min(count, cap);
  const before = Math.floor(shown / 2);
  return Array.from({ length: shown }, (_, at) => (((current - before + at) % count) + count) % count);
}

// `priority` lifts the current highlight above the others, which otherwise stack in the order they were registered.
export type HighlightNames = { all: string; current: string; priority?: number };
// One painter owns one pair of names, so a find by character never clears the matches a kept `/` search stands on.
export const SEARCH_NAMES: HighlightNames = { all: "oasis-find", current: "oasis-find-current" };
export const CHAR_FIND_NAMES: HighlightNames = { all: "oasis-ft", current: "oasis-ft-current" };
// The caret mode cell is the one current match, so its `all` name stays empty. Its colors come from `selection_colors.ts`, which follows the mode.
// A find paints its current match after the cell, often on the caret's own character, so the cell takes the higher priority.
export const CARET_NAMES: HighlightNames = { all: "oasis-caret-none", current: "oasis-caret", priority: 1 };

// Where matches start, and where each ends: one end per match, or one width for all.
export type Spans = { from: number[] } & ({ to: number[] } | { width: number });
const end_of = (spans: Spans, index: number): number => ("to" in spans ? spans.to[index]! : spans.from[index]! + spans.width);

// Background first, then text.
export type ColorPair = [bg: string, fg: string];
export type FindColors = { all: { dark: ColorPair; light: ColorPair }; current: { dark: ColorPair; light: ColorPair } };

// The lib's type for the registry lacks the map methods.
type Registry = { set: (name: string, highlight: Highlight) => void; delete: (name: string) => void };

// A frame's window seen from this script answers `CSS` with this script's own, so its highlights would land in the wrong registry. The page's own view of the window gives the frame's.
// This script's own document keeps its own globals, so page code cannot patch them and read each query.
const page_view = (owner: Document): { Highlight: typeof Highlight; CSS: typeof CSS } => {
  if (owner === document) return window;
  const window_of = owner.defaultView as unknown as { wrappedJSObject?: unknown };
  return (window_of.wrappedJSObject ?? window_of) as { Highlight: typeof Highlight; CSS: typeof CSS };
};

const rule = (name: string, [background, text]: ColorPair) => `::highlight(${name}){background-color:${background};color:${text}}`;

const sheet_text = (names: HighlightNames, { all, current }: FindColors) =>
  `${rule(names.all, all.dark)}${rule(names.current, current.dark)}@media(prefers-color-scheme:light){${rule(names.all, all.light)}${rule(names.current, current.light)}}`;

// One Range per tree the match passes through. A line break at the end of a run has no character to cover.
function ranges_of(model: TextModel, from: number, to: number): Range[] {
  const runs = model.tree_runs_(from, to);
  const ranges: Range[] = [];
  runs.forEach((run, at) => {
    let run_to = run.to;
    while (at < runs.length - 1 && run_to > run.from + 1 && model.text[run_to - 1] === "\n") run_to--;
    const start = model.point_at_(run.from);
    const end = model.point_at_(run_to - 1);
    // An empty line has no text node to cover.
    if (start.node.nodeType !== Node.TEXT_NODE || end.node.nodeType !== Node.TEXT_NODE) return;
    const range = owner_of(run.tree).createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    ranges.push(range);
  });
  return ranges;
}

export function create_painter(names: HighlightNames = SEARCH_NAMES) {
  const sheets = create_sheet_set();
  const painted_documents = new Set<Document>();

  // A removed frame or shadow host is a dead object, and any use of it throws. The rest still has to be cleared.
  const clear_highlights = () => {
    for (const owner of painted_documents) {
      try {
        const registry = page_view(owner).CSS.highlights as unknown as Registry;
        registry.delete(names.all);
        registry.delete(names.current);
      } catch {}
    }
    painted_documents.clear();
  };

  // The sheets stay for the whole search, so a keystroke does not rebuild one in every tree. Only the end of the search drops them.
  const clear = () => {
    clear_highlights();
    sheets.clear();
  };

  // The match at `current` takes the strong color. `indexes` are the matches to draw, by default a window around the current one. Returns how many matches were drawn.
  // With no `colors` the painter adopts no sheet, and the caller styles the names itself.
  const paint = (model: TextModel, matches: Spans, current: number, colors: FindColors | undefined, indexes = paint_indexes(current, matches.from.length)): number => {
    clear_highlights();
    const by_document = new Map<Document, { all: Range[]; current: Range[] }>();
    for (const index of indexes) {
      try {
        for (const range of ranges_of(model, matches.from[index]!, end_of(matches, index))) {
          const group = by_document.get(range.startContainer.ownerDocument!) ?? { all: [], current: [] };
          group[index === current ? "current" : "all"].push(range);
          by_document.set(range.startContainer.ownerDocument!, group);
        }
      } catch {}
    }
    if (colors) {
      for (const tree of model.trees) {
        try {
          sheets.set(tree, sheet_text(names, colors));
        } catch {}
      }
    }
    for (const [owner, group] of by_document) {
      try {
        const view = page_view(owner);
        const registry = view.CSS.highlights as unknown as Registry;
        registry.set(names.all, new view.Highlight(...group.all));
        const current = new view.Highlight(...group.current);
        current.priority = names.priority ?? 0;
        registry.set(names.current, current);
        painted_documents.add(owner);
      } catch {}
    }
    return indexes.length;
  };

  return { paint, clear };
}

export type Painter = ReturnType<typeof create_painter>;

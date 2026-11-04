// Paints the matches with the CSS Custom Highlight API, which draws a Range without touching the page's DOM.
// A highlight registry belongs to one document, but a `::highlight()` rule only reaches the tree whose stylesheet holds it.
// So each tree with text, each shadow root and each frame document, adopts a sheet of its own.

import type { ColorPair } from "../../shared/mode_colors.ts";
import type { Matches } from "./find_match.ts";
import type { TextModel, TextTree } from "./text_model.ts";

// Painting a hundred thousand ranges would stall the page, so the matches nearest the current one in text order are painted.
export const PAINT_CAP = 2000;

const ALL_NAME = "oasis-find";
const CURRENT_NAME = "oasis-find-current";
const DOCUMENT_NODE = 9;

export type FindColors = { all: { dark: ColorPair; light: ColorPair }; current: { dark: ColorPair; light: ColorPair } };

// The lib's type for the registry lacks the map methods.
type Registry = { set: (name: string, highlight: Highlight) => void; delete: (name: string) => void };
type Adopting = TextTree & { adoptedStyleSheets: CSSStyleSheet[] };

const owner_of = (tree: TextTree): Document => (tree.nodeType === DOCUMENT_NODE ? (tree as Document) : (tree as ShadowRoot).ownerDocument);

const rule = (name: string, [background, text]: ColorPair) => `::highlight(${name}){background-color:${background};color:${text}}`;

const sheet_text = ({ all, current }: FindColors) =>
  `${rule(ALL_NAME, all.dark)}${rule(CURRENT_NAME, current.dark)}@media(prefers-color-scheme:light){${rule(ALL_NAME, all.light)}${rule(CURRENT_NAME, current.light)}}`;

// One Range per tree the match passes through. A line break at the end of a run has no character to cover.
function ranges_of(model: TextModel, from: number, to: number): Range[] {
  const runs = model.tree_runs(from, to);
  const ranges: Range[] = [];
  runs.forEach((run, at) => {
    let run_to = run.to;
    while (at < runs.length - 1 && run_to > run.from + 1 && model.text[run_to - 1] === "\n") run_to--;
    const start = model.point_at(run.from);
    const end = model.point_at(run_to - 1);
    // An empty line has no text node to cover.
    if (start.node.nodeType !== Node.TEXT_NODE || end.node.nodeType !== Node.TEXT_NODE) return;
    const range = owner_of(run.tree).createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    ranges.push(range);
  });
  return ranges;
}

export function create_painter() {
  const sheets = new Map<TextTree, CSSStyleSheet>();
  const painted_documents = new Set<Document>();

  const adopt_sheet = (tree: TextTree, colors: FindColors) => {
    if (sheets.has(tree)) return;
    const owner = owner_of(tree);
    // A sheet works only in the document that made it, so a frame's tree takes the frame's own constructor.
    const sheet = new (owner.defaultView as unknown as { CSSStyleSheet: typeof CSSStyleSheet }).CSSStyleSheet();
    sheet.replaceSync(sheet_text(colors));
    (tree as Adopting).adoptedStyleSheets.push(sheet);
    sheets.set(tree, sheet);
  };

  const clear = () => {
    // A removed frame or shadow host is a dead object, and any use of it throws. The rest still has to be cleared.
    for (const owner of painted_documents) {
      try {
        const registry = owner.defaultView!.CSS.highlights as unknown as Registry;
        registry.delete(ALL_NAME);
        registry.delete(CURRENT_NAME);
      } catch {}
    }
    painted_documents.clear();
    for (const [tree, sheet] of sheets) {
      try {
        const adopted = (tree as Adopting).adoptedStyleSheets;
        adopted.splice(adopted.indexOf(sheet), 1);
      } catch {}
    }
    sheets.clear();
  };

  // The match at `current` takes the strong color. Returns how many matches were drawn.
  const paint = (model: TextModel, matches: Matches, current: number, colors: FindColors): number => {
    clear();
    const count = matches.from.length;
    const shown = Math.min(count, PAINT_CAP);
    const by_document = new Map<Document, { all: Range[]; current: Range[] }>();
    for (let step = 0; step < shown; step++) {
      const index = (current + step) % count;
      try {
        for (const range of ranges_of(model, matches.from[index]!, matches.to[index]!)) {
          const group = by_document.get(range.startContainer.ownerDocument!) ?? { all: [], current: [] };
          group[index === current ? "current" : "all"].push(range);
          by_document.set(range.startContainer.ownerDocument!, group);
        }
      } catch {}
    }
    for (const tree of model.trees) {
      try {
        adopt_sheet(tree, colors);
      } catch {}
    }
    for (const [owner, group] of by_document) {
      try {
        const view = owner.defaultView as unknown as { Highlight: typeof Highlight; CSS: typeof CSS };
        const registry = view.CSS.highlights as unknown as Registry;
        registry.set(ALL_NAME, new view.Highlight(...group.all));
        registry.set(CURRENT_NAME, new view.Highlight(...group.current));
        painted_documents.add(owner);
      } catch {}
    }
    return shown;
  };

  return { paint, clear };
}

export type Painter = ReturnType<typeof create_painter>;

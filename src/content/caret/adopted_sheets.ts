// One adopted style sheet per tree. A rule in the page's document does not reach a shadow root or a frame, and adopting a sheet leaves the page's DOM alone.

import type { TextTree } from "./text_model.ts";

type Adopting = TextTree & { adoptedStyleSheets: CSSStyleSheet[] };

export const owner_of = (tree: TextTree): Document => (tree.nodeType === 9 ? (tree as Document) : (tree as ShadowRoot).ownerDocument);

export function create_sheet_set() {
  const kept = new Map<TextTree, { sheet: CSSStyleSheet; css: string }>();

  // Throws on a tree that died (a removed frame or shadow host), so a caller with many trees guards each call.
  const set = (tree: TextTree, css: string) => {
    const held = kept.get(tree);
    // The page may have replaced its sheets and dropped ours.
    if (held && (tree as Adopting).adoptedStyleSheets.includes(held.sheet)) {
      if (held.css !== css) {
        held.sheet.replaceSync(css);
        held.css = css;
      }
      return;
    }
    // A sheet works only in the document that made it, so a frame's tree takes the frame's own constructor.
    const sheet = new (owner_of(tree).defaultView as unknown as { CSSStyleSheet: typeof CSSStyleSheet }).CSSStyleSheet();
    sheet.replaceSync(css);
    (tree as Adopting).adoptedStyleSheets.push(sheet);
    kept.set(tree, { sheet, css });
  };

  // A dead tree throws, and the rest still has to be cleared.
  const clear = () => {
    for (const [tree, { sheet }] of kept) {
      try {
        const adopted = (tree as Adopting).adoptedStyleSheets;
        const at = adopted.indexOf(sheet);
        if (at >= 0) adopted.splice(at, 1);
      } catch {}
    }
    kept.clear();
  };

  return { set, clear };
}

export type SheetSet = ReturnType<typeof create_sheet_set>;

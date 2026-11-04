// Where caret mode starts: at a hint's element, else where the page already is.

import { character_box } from "./screen_line.ts";
import type { TextModel } from "./text_model.ts";

const DISCONNECTED = 1;
const FOLLOWING = 4;
const CONTAINED_BY = 16;

type Positioned = { compareDocumentPosition: (other: Node) => number };

// The text model reads the top document only. An element in a frame or a shadow root has no place in it.
export function in_other_tree(node: { ownerDocument: unknown; getRootNode: () => unknown }, top_document: unknown): boolean {
  return node.ownerDocument !== top_document || node.getRootNode() !== top_document;
}

// The first character from the start of the node on: its own text, or for a node with none, the text after it. A field or an image has no text in the model, so it takes the next text. Undefined when no text is left.
export function first_index_from(model: TextModel, node: Positioned): number | undefined {
  const not_before = (index: number): boolean => {
    const { node: at, offset } = model.point_at(index);
    // An empty line is the <br> inside its parent, so the parent alone would sort before the node.
    const here = at.nodeType === 1 ? (at.childNodes[offset] ?? at) : at;
    const relation = node.compareDocumentPosition(here);
    return (relation & DISCONNECTED) === 0 && (relation === 0 || (relation & (FOLLOWING | CONTAINED_BY)) !== 0);
  };
  if (model.text === "" || !not_before(model.text.length - 1)) return undefined;
  let low = 0;
  let high = model.text.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (not_before(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

const on_screen = (node: Node): boolean => {
  const range = document.createRange();
  range.selectNodeContents(node);
  const box = range.getBoundingClientRect();
  return box.height > 0 && box.bottom > 0 && box.top < innerHeight;
};

// A character with no box of its own, such as a collapsed space, takes the next one that has a box.
function box_from(model: TextModel, index: number): DOMRect | undefined {
  for (let at = index; at < model.text.length; at++) {
    const box = character_box(model, at);
    if (box) return box;
  }
  return undefined;
}

// The page's own selection or the last click, when it is in the text and on screen. Otherwise the first text on screen.
export function first_visible_index(model: TextModel, selection: Selection): number {
  if (selection.anchorNode?.nodeType === Node.TEXT_NODE && on_screen(selection.anchorNode)) {
    const index = model.index_of(selection.anchorNode, selection.anchorOffset);
    if (index !== undefined) return index;
  }
  let low = 0;
  let high = model.text.length - 1;
  // Text runs down the page, so the first character below the top edge is found by halving. The box is the character's own, because a paragraph's box starts above the screen.
  while (low < high) {
    const middle = (low + high) >> 1;
    const box = box_from(model, middle);
    if (box && box.bottom < 0) low = middle + 1;
    else high = middle;
  }
  return Math.max(low, 0);
}

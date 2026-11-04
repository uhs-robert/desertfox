// Where caret mode starts when no hint picked an element: where the page already is.

import { character_box } from "./screen_line.ts";
import { documents_of } from "./text_model.ts";
import type { TextModel } from "./text_model.ts";

// The box must show in its own window and in the viewport of every frame around it.
const on_screen = (node: Node): boolean => {
  let owner = node.ownerDocument!;
  const range = owner.createRange();
  range.selectNodeContents(node);
  const box = range.getBoundingClientRect();
  if (box.height <= 0) return false;
  let top = box.top;
  for (;;) {
    if (top + box.height <= 0 || top >= owner.defaultView!.innerHeight) return false;
    const frame = owner.defaultView!.frameElement;
    if (owner === document || !frame) return true;
    top += frame.getBoundingClientRect().top + frame.clientTop;
    owner = frame.ownerDocument;
  }
};

// A character with no box of its own, such as a collapsed space, takes the next one that has a box.
function box_from(model: TextModel, index: number): DOMRect | undefined {
  for (let at = index; at < model.text.length; at++) {
    const box = character_box(model, at);
    if (box) return box;
  }
  return undefined;
}

// The page's own selection or the last click, in any document of the model, when it is in the text and on screen. Otherwise the first text on screen.
export function first_visible_index(model: TextModel): number {
  for (const selection of documents_of(model).map((owner) => owner.getSelection())) {
    const anchor = selection?.anchorNode;
    if (anchor?.nodeType !== Node.TEXT_NODE || !on_screen(anchor)) continue;
    const index = model.index_of(anchor, selection!.anchorOffset);
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

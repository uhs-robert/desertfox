// Where caret mode starts when no hint chose a place.

import { character_box } from "./screen_line.ts";
import type { TextModel } from "./text_model.ts";

const on_screen = (node: Node): boolean => {
  const range = document.createRange();
  range.selectNodeContents(node);
  const box = range.getBoundingClientRect();
  return box.height > 0 && box.bottom > 0 && box.top < innerHeight;
};

// The page's own selection or the last click, when it is in the text and on screen. Otherwise the first text on screen.
export function first_visible_index(model: TextModel, selection: Selection, follow_selection: boolean): number {
  if (follow_selection && selection.anchorNode?.nodeType === Node.TEXT_NODE && on_screen(selection.anchorNode)) {
    const index = model.index_of(selection.anchorNode, selection.anchorOffset);
    if (index !== undefined) return index;
  }
  let low = 0;
  let high = model.text.length - 1;
  // Text runs down the page, so the first character below the top edge is found by halving. The box is the character's own, because a paragraph's box starts above the screen.
  while (low < high) {
    const middle = (low + high) >> 1;
    const box = character_box(model, middle);
    if (box && box.bottom < 0) low = middle + 1;
    else high = middle;
  }
  return Math.max(low, 0);
}

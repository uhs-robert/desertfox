// Motions along the screen line, answered by Firefox's Selection.modify because only layout knows where text wraps.
// The text model lets us ask from any character and read the answer back as a character.

import type { Motion } from "./motion.ts";
import type { TextModel } from "./text_model.ts";

export function screen_line_target(model: TextModel, selection: Selection, from: number, motion: Motion): number {
  const start = model.point_at(from);
  selection.collapse(start.node, start.offset);
  const by_line = motion.unit === "line";
  selection.modify("move", motion.unit === "line_end" || (by_line && motion.direction === "forward") ? "forward" : "backward", by_line ? "line" : "lineboundary");
  const { focusNode: node, focusOffset: offset } = selection;
  const found = node && model.index_of(node, offset);
  if (found === undefined || found === null) return from;
  let index = found;
  if (motion.unit === "line_first") while (model.text[index] === " ") index++;
  if (motion.unit === "line_end") {
    // The boundary sits after the last character, but the model clamps a position past the end of its node onto that character.
    if (model.point_at(index).offset >= offset && model.text[index - 1] !== "\n" && index > 0) index--;
    if (model.text[index] === " " && model.text[index - 1] !== "\n" && index > 0) index--;
  }
  return index;
}

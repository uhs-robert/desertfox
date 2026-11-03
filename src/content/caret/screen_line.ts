// Motions along the screen line, answered by Firefox's Selection.modify because only layout knows where text wraps.
// The text model lets us ask from any character and read the answer back as a character.

import type { Motion } from "./motion.ts";
import type { TextModel } from "./text_model.ts";

// The box of one character, or undefined when it has none to measure, as on an empty line.
export function character_box(model: TextModel, index: number): DOMRect | undefined {
  const { node, offset } = model.point_at(index);
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, Math.min(offset + 1, node.nodeType === Node.TEXT_NODE ? (node as Text).length : node.childNodes.length));
  const box = range.getBoundingClientRect();
  return box.height > 0 ? box : undefined;
}

// `goal_x` is where j and k aim on each new line, so a short line in between does not move the column. A caller keeps what comes back for the next j or k and drops it after any other motion.
export function screen_line_target(model: TextModel, selection: Selection, from: number, motion: Motion, goal_x?: number): { index: number; goal_x: number | undefined } {
  const target = modify_target(model, selection, from, motion);
  if (motion.unit !== "line" || target === from) return { index: target, goal_x: undefined };
  const wanted_x = goal_x ?? character_box(model, from)?.left ?? 0;
  return { index: nearest_on_line(model, target, wanted_x), goal_x: wanted_x };
}

// The character on the target's screen line whose left edge is nearest to x. It measures boxes, because caretPositionFromPoint answers null for a line below the screen.
function nearest_on_line(model: TextModel, target: number, x: number): number {
  const row = character_box(model, target);
  if (!row) return target;
  let best = target;
  let best_gap = Infinity;
  for (const step of [-1, 1]) {
    for (let at = target; at >= 0 && at < model.text.length && model.text[at] !== "\n"; at += step) {
      const box = character_box(model, at);
      if (!box || Math.abs(box.top - row.top) >= row.height / 2) break;
      const gap = Math.abs(box.left - x);
      if (gap < best_gap) [best, best_gap] = [at, gap];
    }
  }
  return best;
}

function modify_target(model: TextModel, selection: Selection, from: number, motion: Motion): number {
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

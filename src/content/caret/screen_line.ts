// Motions along the screen line, answered by Firefox's Selection.modify because only layout knows where text wraps.
// The text model lets us ask from any character and read the answer back as a character.

import type { Motion } from "./motion.ts";
import { scroll_delta } from "./scroll_delta.ts";
import type { TextModel, TreeRun } from "./text_model.ts";

const DOCUMENT_NODE = 9;

// Where a frame's document sits in this script's window: the content box of each frame element around it, added up.
export function frame_offset(of_document: Document): { x: number; y: number } {
  const offset = { x: 0, y: 0 };
  for (let at = of_document; at !== document; ) {
    const frame = at.defaultView?.frameElement;
    if (!frame) break;
    const box = frame.getBoundingClientRect();
    offset.x += box.left + frame.clientLeft;
    offset.y += box.top + frame.clientTop;
    at = frame.ownerDocument;
  }
  return offset;
}

// The box of one character in this script's window, so boxes in a frame compare with boxes outside it. Undefined when it has none to measure, as on an empty line.
export function character_box(model: TextModel, index: number): DOMRect | undefined {
  const { node, offset } = model.point_at_(index);
  const range = node.ownerDocument!.createRange();
  range.setStart(node, offset);
  range.setEnd(node, Math.min(offset + 1, node.nodeType === Node.TEXT_NODE ? (node as Text).length : node.childNodes.length));
  const box = range.getBoundingClientRect();
  if (box.height === 0) return undefined;
  const shift = frame_offset(node.ownerDocument!);
  return new DOMRect(box.x + shift.x, box.y + shift.y, box.width, box.height);
}

// The box around the characters from `from` to `to`, so a match is brought in whole and not by its first letter.
function span_box(model: TextModel, from: number, to = from): DOMRect | undefined {
  const first = character_box(model, from);
  const last = to === from ? first : character_box(model, to);
  if (!first || !last) return first;
  const left = Math.min(first.left, last.left);
  const top = Math.min(first.top, last.top);
  return new DOMRect(left, top, Math.max(first.right, last.right) - left, Math.max(first.bottom, last.bottom) - top);
}

// The next box out that can scroll: the parent, the host of a shadow root, or the frame around a document.
const outer_view = (node: Node): Element | null =>
  node.parentElement ?? (node.parentNode as ShadowRoot | null)?.host ?? (node.nodeType === Node.DOCUMENT_NODE ? ((node as Document).defaultView?.frameElement ?? null) : null);

// Only the character, or the span up to `last_index_`, counts: its paragraph can be taller than the screen. Each scrollable ancestor scrolls first, then the window, then the same again out through each frame.
// The boxes are all in this script's window, so a view's edges shift by the frames around it.
// `bottom_inset_` keeps the match above something drawn over the bottom of this script's window, such as the command line. A frame's own viewport is not covered by it. 
export function scroll_to_index(model: TextModel, index: number, options: { bottom_inset_?: number; last_index_?: number } = {}): void {
  const caret_node = model.point_at_(index).node;
  for (let view = caret_node.nodeType === Node.ELEMENT_NODE ? (caret_node as Element) : outer_view(caret_node); view; ) {
    const owner = view.ownerDocument;
    const nested = view !== owner.documentElement && view !== owner.body;
    if (nested && view.scrollHeight <= view.clientHeight && view.scrollWidth <= view.clientWidth) {
      view = outer_view(view);
      continue;
    }
    const box = span_box(model, index, options.last_index_);
    const window_of_view = owner.defaultView;
    if (!box || !window_of_view) return;
    const shift = frame_offset(owner);
    const edges = nested ? view.getBoundingClientRect() : { left: 0, right: window_of_view.innerWidth, top: 0, bottom: window_of_view.innerHeight - (owner === document ? (options.bottom_inset_ ?? 0) : 0) };
    const by_x = scroll_delta({ low: box.left, high: box.right }, { low: edges.left + shift.x, high: edges.right + shift.x }, box.height);
    const by_y = scroll_delta({ low: box.top, high: box.bottom }, { low: edges.top + shift.y, high: edges.bottom + shift.y }, box.height);
    if (by_x || by_y) (nested ? view : window_of_view).scrollBy(by_x, by_y);
    // The walk stops at this script's own document: past it, the box is in a different space than the outer views.
    view = nested ? outer_view(view) : owner === document ? null : outer_view(owner);
  }
}

// `goal_x_` is where j and k aim on each new line, so a short line in between does not move the column. A caller keeps what comes back for the next j or k and drops it after any other motion.
export function screen_line_target(model: TextModel, from: number, motion: Motion, goal_x_?: number): { index: number; goal_x_: number | undefined } {
  const modified = modify_target(model, from, motion);
  const target = motion.unit === "line" ? line_target(model, from, modified, motion.direction) : modified;
  if (motion.unit !== "line" || target === from) return { index: target, goal_x_: undefined };
  const wanted_x = goal_x_ ?? character_box(model, from)?.left ?? 0;
  return { index: nearest_on_line(model, target, wanted_x), goal_x_: wanted_x };
}

const same_row = (model: TextModel, one: number, other: number): boolean => {
  const [one_box, other_box] = [character_box(model, one), character_box(model, other)];
  return one_box !== undefined && other_box !== undefined && Math.abs(one_box.top - other_box.top) < one_box.height / 2;
};

// The start of the model's line after or before the one holding `from`, or `from` itself at the end of the text.
function adjacent_line_start(text: string, from: number, direction: Motion["direction"]): number {
  if (direction === "forward") {
    const line_end = text.indexOf("\n", from);
    return line_end >= 0 && line_end + 1 < text.length ? line_end + 1 : from;
  }
  const line_start = text.lastIndexOf("\n", from - 1) + 1;
  return line_start > 0 ? text.lastIndexOf("\n", line_start - 2) + 1 : from;
}

// Selection.modify walks into a shadow root of its own document, so an inline host in a wrapped paragraph is on the screen line it shows. It stalls on a block host and stays inside one frame, so those two need the model's line.
export function crosses_frame_or_block_host(runs: TreeRun[]): boolean {
  const owner_of = (tree: TreeRun["tree"]) => (tree.nodeType === DOCUMENT_NODE ? (tree as Document) : (tree as ShadowRoot).ownerDocument);
  const is_block_host = ({ tree }: TreeRun) => {
    if (tree.nodeType === DOCUMENT_NODE) return false;
    const host = (tree as ShadowRoot).host;
    return !host.ownerDocument.defaultView!.getComputedStyle(host).display.startsWith("inline");
  };
  return runs.length > 1 && runs.some((run) => owner_of(run.tree) !== owner_of(runs[0]!.tree) || is_block_host(run));
}

// Where Selection.modify stalls or leaves its document, the next or previous line of the model stands in.
export function line_target(model: TextModel, from: number, modified: number, direction: Motion["direction"]): number {
  const crossed = crosses_frame_or_block_host(model.tree_runs_(Math.min(from, modified), Math.max(from, modified) + 1));
  const stalled = modified === from || same_row(model, from, modified);
  return crossed || stalled ? adjacent_line_start(model.text, from, direction) : modified;
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

function modify_target(model: TextModel, from: number, motion: Motion): number {
  const start = model.point_at_(from);
  const selection = start.node.ownerDocument!.getSelection()!;
  selection.collapse(start.node, start.offset);
  const by_line = motion.unit === "line";
  selection.modify("move", motion.unit === "line_end" || (by_line && motion.direction === "forward") ? "forward" : "backward", by_line ? "line" : "lineboundary");
  const { focusNode: node, focusOffset: offset } = selection;
  const found = node && model.index_of_(node, offset);
  if (found === undefined || found === null) return from;
  let index = found;
  if (motion.unit === "line_first") while (model.text[index] === " ") index++;
  if (motion.unit === "line_end") {
    // The boundary sits after the last character, but the model clamps a position past the end of its node onto that character.
    if (model.point_at_(index).offset >= offset && model.text[index - 1] !== "\n" && index > 0) index--;
    if (model.text[index] === " " && model.text[index - 1] !== "\n" && index > 0) index--;
  }
  return index;
}

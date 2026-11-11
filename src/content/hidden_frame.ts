// A hidden input frame is a child frame the user cannot see, which a page keeps only to take typed text (Google Docs types into one).
// The test is the frame's box alone, with no rule per site: the frame is too small to show anything, or it lies outside the viewport of the document that holds it.

type Box = Pick<DOMRect, "width" | "height" | "top" | "bottom" | "left" | "right">;

// Below this many CSS pixels on one side, a frame shows no usable content.
const SMALLEST_SHOWN_SIDE = 4;

export const is_out_of_sight = (box: Box, view_width: number, view_height: number): boolean =>
  box.width < SMALLEST_SHOWN_SIDE || box.height < SMALLEST_SHOWN_SIDE || box.bottom < 0 || box.right < 0 || box.top > view_height || box.left > view_width;

export function is_hidden_frame(frame: Element): boolean {
  const view = frame.ownerDocument.documentElement;
  return is_out_of_sight(frame.getBoundingClientRect(), view.clientWidth, view.clientHeight);
}

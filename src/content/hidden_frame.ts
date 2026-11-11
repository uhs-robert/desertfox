// A hidden input frame is a child frame the user cannot see, which a page keeps only to take typed text (Google Docs types into one, 625 by 1 px).
// The test is the frame's size alone, with no rule per site. Where the frame sits does not count: an editor in a full-size frame (TinyMCE, CKEditor 4) that the user scrolled out of view is not hidden.

// Below this many CSS pixels on one side, a frame shows no usable content.
const SMALLEST_SHOWN_SIDE = 4;

export const is_too_small_to_show = (box: Pick<DOMRect, "width" | "height">): boolean => box.width < SMALLEST_SHOWN_SIDE || box.height < SMALLEST_SHOWN_SIDE;

export const is_hidden_frame = (frame: Element): boolean => is_too_small_to_show(frame.getBoundingClientRect());

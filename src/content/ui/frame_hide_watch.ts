// The top frame watches the child frame that holds the keys, and takes the focus back when that frame hides.
// Firefox itself moves the focus out of a frame that gets `display: none` or `visibility: hidden` (measured in p6_frames). It keeps the focus in a frame that turns transparent or shrinks below a usable size, which this watch catches.
// The top frame watches and not the child, because a frame of another site cannot see its own frame element, and no event fires for a style change.
// A frame that starts hidden and then shows (a panel that animates open) is not hidden: only a frame that was shown can hide. Where it sits does not count, as in hidden_frame.ts.
// A frame nested in the focused one is out of reach: the top frame sees only its own child.

import { is_hidden_frame } from "../hidden_frame.ts";
import { shadow_root_of } from "../shadow.ts";

const CHECK_MS = 300;

type FrameElement = Element & { contentWindow?: unknown };

const is_shown = (frame: Element): boolean => frame.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && !is_hidden_frame(frame);

// The top frame's command line holds the focus in a frame of its own, in a closed shadow root.
const focus_sits_in_a_frame = (focused: Element | null): boolean => {
  const inner = (focused && shadow_root_of(focused)?.activeElement) ?? focused;
  return !!(inner as FrameElement | null)?.contentWindow;
};

// The answer turns the watch on while a child frame holds the focus, and off when the top frame has it back.
export function create_frame_hide_watch(take_focus_back: () => void, doc?: Pick<Document, "activeElement">): (child_focused: boolean) => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let watched: Element | undefined;
  let shown = false;
  // Read at use, not when the bundle loads.
  const focused_element = () => (doc ?? document).activeElement;
  const check = () => {
    const frame = focused_element() as FrameElement | null;
    // The command line or a field of the top frame holds the focus for now.
    if (!frame?.contentWindow) return;
    if (frame !== watched) {
      watched = frame;
      shown = false;
    }
    const now = is_shown(frame);
    if (shown && !now) take_focus_back();
    shown = now;
  };
  // A mode change in the child arms it again, which must not forget that the frame was shown. The first check runs at once, so a frame that hides within the first period still counts as shown.
  return (child_focused) => {
    if (child_focused && !timer) {
      timer = setInterval(check, CHECK_MS);
      check();
    } else if (!child_focused) {
      clearInterval(timer);
      timer = undefined;
      // The command line took the focus, and gives it back to the child frame when it closes. The frame stays watched, so one that hid behind the line still counts as shown and its keys come back to the top frame.
      if (!focus_sits_in_a_frame(focused_element())) watched = undefined;
    }
  };
}

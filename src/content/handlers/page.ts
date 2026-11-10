import { deepest_focused_element } from "../editable.ts";
import type { ContentHandler } from "./types.ts";

let last_blurred: HTMLElement | undefined;

// The element the last blur took focus from, kept so scroll.align can still find the field the user left.
export const last_blurred_element = () => last_blurred;

export function blur_focused_element(): void {
  const focused = deepest_focused_element();
  if (focused instanceof HTMLElement && focused !== document.body) {
    last_blurred = focused;
    focused.blur();
  }
}

export const page_blur: ContentHandler = {
  run: blur_focused_element,
};

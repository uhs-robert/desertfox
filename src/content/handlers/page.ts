import { is_editable_element } from "../editable.ts";
import type { ContentHandler } from "./types.ts";

export function blur_focused_element(): void {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  if (focused instanceof HTMLElement) focused.blur();
}

const is_visible = (element: Element) => {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
};

const is_in_viewport = (element: Element) => {
  const box = element.getBoundingClientRect();
  return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
};

export const page_focus_input: ContentHandler = {
  run: () => {
    const inputs = Array.from(document.querySelectorAll<HTMLElement>("input, textarea, [contenteditable]")).filter(
      (element) => is_editable_element(element) && !(element as HTMLInputElement).disabled && is_visible(element),
    );
    const target = inputs.find(is_in_viewport) ?? inputs[0];
    if (!target) throw new Error("No text field on this page");
    target.focus();
  },
  count: "ignore",
};

export const page_blur: ContentHandler = {
  run: blur_focused_element,
  count: "ignore",
};

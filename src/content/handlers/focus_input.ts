import { takes_typing } from "../editable.ts";
import { is_hidden_frame } from "../hidden_frame.ts";

const is_visible = (element: Element) => {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
};

const is_in_viewport = (element: Element) => {
  const box = element.getBoundingClientRect();
  return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
};

// Not `is_editable_element`: its `instanceof` is false for an element of another frame's document.
const visible_fields_in = (doc: Document) =>
  Array.from(doc.querySelectorAll<HTMLInputElement>("input, textarea, [contenteditable]")).filter((element) => takes_typing(element.tagName, element.type, element.isContentEditable) && !element.disabled && is_visible(element));

// The field of a hidden input frame, which the frame left when it handed the focus to this document. Focusing the frame element is no use: the frame has no focused element any more, so it hands the focus straight back.
// `contentDocument` is null for a frame of another site.
const hidden_frame_field = (): HTMLElement | undefined =>
  Array.from(document.querySelectorAll("iframe")).flatMap((frame) => (frame.contentDocument && is_hidden_frame(frame) ? visible_fields_in(frame.contentDocument) : []))[0];

// A field of this document comes first, so a page with a visible field keeps its target whatever hidden frames it holds.
export function focus_first_input(): void {
  const inputs = visible_fields_in(document);
  const target = inputs.find(is_in_viewport) ?? inputs[0] ?? hidden_frame_field();
  if (!target) throw new Error("No text field on this page");
  target.focus();
}

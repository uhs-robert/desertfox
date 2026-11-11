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

// A hidden input frame's field comes first: a page that types into one is an editor, and its visible fields are side fields (Google Docs shows a title input above the document).
export function focus_first_input(): void {
  const inputs = visible_fields_in(document);
  const target = hidden_frame_field() ?? inputs.find(is_in_viewport) ?? inputs[0];
  if (!target) throw new Error("No text field on this page");
  target.focus();
}

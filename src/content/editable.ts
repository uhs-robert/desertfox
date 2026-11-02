// Which focused elements take typed text, so insert mode can follow focus.

const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "radio", "submit", "reset", "image", "file", "color", "range", "hidden",
]);

export function takes_typing(tag_name: string, input_type: string, is_content_editable: boolean): boolean {
  if (is_content_editable) return true;
  const tag = tag_name.toUpperCase();
  if (tag === "TEXTAREA") return true;
  return tag === "INPUT" && !NON_TEXT_INPUT_TYPES.has(input_type.toLowerCase());
}

export function is_editable_element(target: EventTarget | Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return takes_typing(target.tagName, target instanceof HTMLInputElement ? target.type : "", target.isContentEditable);
}

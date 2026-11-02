// Context sources the content script can fill: the page's own selection and URL.

import type { ContextSourceName } from "../shared/index.ts";

export type ContentContextSource = Extract<ContextSourceName, "selection" | "current_url">;

function selected_text(): string {
  const focused = document.activeElement;
  if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd } = focused;
    if (selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart) {
      return focused.value.slice(selectionStart, selectionEnd);
    }
  }
  return String(getSelection() ?? "");
}

export function read_context_source(source: ContentContextSource): string {
  return source === "selection" ? selected_text() : location.href;
}

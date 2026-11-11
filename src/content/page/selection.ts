// The text selected in this frame, which the background asks for to fill a `selection` context source.

export function selected_text(): string {
  const focused = document.activeElement;
  if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd } = focused;
    if (selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart) {
      return focused.value.slice(selectionStart, selectionEnd);
    }
  }
  return String(getSelection() ?? "");
}

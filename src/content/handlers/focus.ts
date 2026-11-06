import { blur_focused_element } from "./page.ts";

// A frame from another site starts its content script on its first focus, so the many ad and tracking frames the user never enters stay inert. A frame that is already focused when its script loads (it navigated while focused) starts at once, because no focus event follows.
export function start_on_first_focus(start: () => void, win: Pick<Window, "addEventListener">, already_focused: boolean): void {
  if (already_focused) start();
  else win.addEventListener("focus", start, { once: true });
}

// Window focus pulls keyboard focus out of the address bar. The blur keeps the next key from typing into a field.
export function focus_page_content(focus_window: () => void = () => window.focus(), blur_active: () => void = blur_focused_element): void {
  focus_window();
  blur_active();
}

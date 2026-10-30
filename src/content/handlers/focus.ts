import { blur_focused_element } from "./page.ts";

// Window focus pulls keyboard focus out of the address bar. The blur keeps the next key from typing into a field.
export function focus_page_content(focus_window: () => void = () => window.focus(), blur_active: () => void = blur_focused_element): void {
  focus_window();
  blur_active();
}

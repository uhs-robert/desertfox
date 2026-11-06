import { blur_focused_element } from "./page.ts";

// A second injection into the same page must not add a second set of listeners. The flag lives on the window, which both injections share.
const LOADED_FLAG = "desertfox_content_loaded";

export function start_content_once(start: () => void, win: Pick<Window, "addEventListener">, already_focused: boolean): void {
  const loaded_flags = win as unknown as Record<string, boolean>;
  if (loaded_flags[LOADED_FLAG]) return;
  start_on_first_focus(
    () => {
      // Two injections that both wait for the focus each hold a listener, so the check runs again at the start.
      if (loaded_flags[LOADED_FLAG]) return;
      loaded_flags[LOADED_FLAG] = true;
      start();
    },
    win,
    already_focused,
  );
}

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

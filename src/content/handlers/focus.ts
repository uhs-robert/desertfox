import { blur_focused_element } from "./page.ts";

// A second injection into the same page must not add a second set of listeners. The flag lives on the window, which both injections share.
const LOADED_FLAG = "desertfox_content_loaded";

// While a frame waits for its first focus, the flag holds the start, so hints across frames can start a frame the user never entered. Once started, it holds true.
export function start_content_once(start: () => void, win: Pick<Window, "addEventListener">, already_focused: boolean): void {
  const loaded_flags = win as unknown as Record<string, unknown>;
  if (loaded_flags[LOADED_FLAG]) return;
  const start_once = () => {
    if (loaded_flags[LOADED_FLAG] === true) return;
    loaded_flags[LOADED_FLAG] = true;
    start();
  };
  loaded_flags[LOADED_FLAG] = start_once;
  if (already_focused) start_once();
  else win.addEventListener("focus", start_once, { once: true });
}

// Window focus pulls keyboard focus out of the address bar. The blur keeps the next key from typing into a field.
export function focus_page_content(focus_window: () => void = () => window.focus(), blur_active: () => void = blur_focused_element): void {
  focus_window();
  blur_active();
}

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

// The answer to a park message (see `hand_back_parked_frame`). A frame answers whether no click or key reached it. The top frame blurs its iframe element only, so a field the page or the user focused in the meantime is not undone.
export const answer_park = (is_top: boolean, active: Pick<Element, "localName"> | null, activated: boolean, hand_back: () => void = focus_page_content): boolean => (is_top ? (/frame$/.test(active?.localName ?? "") && hand_back(), true) : !activated);

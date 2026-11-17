// Whether the user did something else since a load started, so the item box does not jump to the new results after they left.

export type UserLeft = { left_: () => boolean; stop_: () => void };

type Listening = Pick<Window, "addEventListener" | "removeEventListener">;

// A hidden tab, a trusted wheel or a pointer press counts, and so does a key press: `pressed_keys_` counts them in the content script, which takes a bound key before any listener here runs. Scroll does not count: our own scroll past the list and the scroll anchoring of new content fire it. A window blur alone does not either: Ctrl+L and the page's own focus moves blur it, and a key press from there still counts.
export function watch_user_left(doc: Listening & { hidden: boolean }, win: Listening, pressed_keys: () => number): UserLeft {
  const keys_at_start = pressed_keys();
  let left = false;
  const on_input = (event: Event) => void (left ||= event.isTrusted);
  const on_hidden = () => (left ||= doc.hidden);
  const listen = (method: "addEventListener" | "removeEventListener") => {
    doc[method]("visibilitychange", on_hidden);
    for (const name of ["wheel", "pointerdown"]) win[method](name, on_input, true);
  };
  listen("addEventListener");
  return { left_: () => left || pressed_keys() !== keys_at_start, stop_: () => listen("removeEventListener") };
}

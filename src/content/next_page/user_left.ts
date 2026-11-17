// Whether the user did something else since a load started, so the item box does not jump to the new results after they left.

export type UserLeft = { left_: () => boolean; stop_: () => void };

type Listening = Pick<Window, "addEventListener" | "removeEventListener">;

// A trusted key (not a held repeat or a bare modifier), wheel or pointer press counts. Scroll does not: our own scroll past the list and the scroll anchoring of new content fire it. A window blur alone does not either: Ctrl+L and the page's own focus moves blur it, and a key press from there still counts.
export function watch_user_left(doc: Listening & { hidden: boolean }, win: Listening): UserLeft {
  let left = false;
  const on_input = (event: Event) => {
    // A wheel or pointer event has no key, and the prefix test reads "undefined" as no modifier.
    const { key, repeat } = event as KeyboardEvent;
    left ||= event.isTrusted && !repeat && !/^(?:Shift|Control|Alt|Meta)/.test(key!);
  };
  const on_hidden = () => (left ||= doc.hidden);
  const listen = (method: "addEventListener" | "removeEventListener") => {
    doc[method]("visibilitychange", on_hidden);
    for (const name of ["keydown", "wheel", "pointerdown"]) win[method](name, on_input, true);
  };
  listen("addEventListener");
  return { left_: () => left, stop_: () => listen("removeEventListener") };
}

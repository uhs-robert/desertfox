// Whether an insert session may be open, as the content script sees it. The first edit of a session opens it, and a flush or a focusout closes it.
// The recorder's answer to an edit comes after the bundle loads. It carries the generation of the edit it answers, so an answer from an older session cannot close a newer one.
export function create_session_flag() {
  let open = false;
  let generation = 0;
  return {
    is_open_: () => open,
    open_: (): number => {
      open = true;
      return ++generation;
    },
    close_: () => void (open = false),
    close_if_current_: (answered: number) => void (open = open && answered !== generation),
  };
}

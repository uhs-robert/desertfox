// Which element `scroll.align` moves into place. Pure: the DOM side builds the candidates.

export type AlignPosition = "top" | "center" | "bottom";

export type AlignFocus<Ref> = { ref: Ref; is_page_root: boolean };

export type AlignSelection<Ref> = {
  // The editing host or field that holds the selection focus, when it has one.
  editable: Ref | undefined;
  // The element around the selection focus.
  parent: Ref;
};

// Order: the focused element unless it is the page itself, then the selection's field, then the
// element around the selection.
export function choose_align_target<Ref>(
  focused: AlignFocus<Ref> | undefined,
  selection: AlignSelection<Ref> | undefined,
): Ref | undefined {
  if (focused && !focused.is_page_root) return focused.ref;
  return selection?.editable ?? selection?.parent;
}

export const SCROLL_BLOCK: Record<AlignPosition, ScrollLogicalPosition> = {
  top: "start",
  center: "center",
  bottom: "end",
};

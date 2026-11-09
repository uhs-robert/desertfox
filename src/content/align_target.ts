// Which element `scroll.align` moves into place. Pure: the DOM side builds the candidates.

export type AlignPosition = "top" | "center" | "bottom";

export type AlignFocus<Ref> = { ref: Ref; is_page_root_: boolean };

export type AlignSelection<Ref> = {
  // The editing host or field that holds the selection focus, when it has one.
  editable: Ref | undefined;
  // The element around the selection focus.
  parent: Ref;
  // The element around the selection contains the element just blurred. Escape from a field leaves the
  // selection on the field's wrapper, so the blurred field is the better target.
  holds_remembered_: boolean;
};

// Order: the focused element unless it is the page itself, then the selection's field, then the blurred
// element when the selection sits around it, then the element around the selection, then the blurred element.
export function choose_align_target<Ref>(
  focused: AlignFocus<Ref> | undefined,
  selection: AlignSelection<Ref> | undefined,
  remembered: Ref | undefined,
): Ref | undefined {
  if (focused && !focused.is_page_root_) return focused.ref;
  if (selection?.editable) return selection.editable;
  if (selection?.holds_remembered_) return remembered;
  return selection?.parent ?? remembered;
}

export const SCROLL_BLOCK: Record<AlignPosition, ScrollLogicalPosition> = {
  top: "start",
  center: "center",
  bottom: "end",
};

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

// The heading the last `]h`, `[h` or `sh` reached, written by the hints bundle and read by the page bundle. It cannot live in
// either bundle's module state, because bundles share no modules. Weak, so a page can still drop the heading.
export type HeadingJump = { element: WeakRef<Element>; frames: readonly WeakRef<Element>[] };

// A node in a document that a frame navigation discarded stays connected to it but has no window.
type Placed = { isConnected: boolean; ownerDocument: { defaultView: unknown } };

const is_alive = (node: Placed): boolean => node.isConnected && node.ownerDocument.defaultView !== null;

// The jump counts only while the heading and every frame that holds it are still in a live page, else the next candidate is used.
export function live_heading_jump<Node extends Placed>(
  jump: { element: WeakRef<Node>; frames: readonly WeakRef<Node>[] } | undefined,
): { element: Node; frames: Node[] } | undefined {
  const element = jump?.element.deref();
  const frames = jump?.frames.map((frame) => frame.deref());
  if (!element || !frames || !is_alive(element) || !frames.every((frame) => frame && is_alive(frame))) return undefined;
  return { element, frames: frames as Node[] };
}

// Order: the heading jump, which the hints bundle clears when a focus or selection change comes after it, so it is the newest
// when it is here. Then the focused element unless it is the page itself, then the selection's field, then the blurred
// element when the selection sits around it, then the element around the selection, then the blurred element.
export function choose_align_target<Ref>(
  focused: AlignFocus<Ref> | undefined,
  selection: AlignSelection<Ref> | undefined,
  remembered: Ref | undefined,
  heading?: Ref,
): Ref | undefined {
  if (heading) return heading;
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

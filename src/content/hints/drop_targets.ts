// The places a grabbed element can likely be dropped, for the target pass of `hint --grab`. A page does not declare its drop targets, so this guesses from the page's structure. It never proves a place is not a target, which is why the caller falls back to every element when little is found and offers a key that widens to every element.

// What a page marks as a drop place: inline handlers, the old dropzone attributes, and the markers of the drag libraries that put one on a droppable.
export const MARKERS = "[ondrop], [ondragover], [dropzone], [aria-dropeffect]:not([aria-dropeffect=none]), [data-rbd-droppable-id], [data-rfd-droppable-id], .ui-droppable, .ui-sortable";
// A thumb drops anywhere along a track, a canvas or a gap, so a widget like this takes labels on every element.
const POINTER_WIDGETS = "input[type=range], [role=slider], [role=scrollbar], [role=separator]";
const SHARED_ATTRIBUTES = ["data-testid", "role", "aria-roledescription", "draggable"];

// Fewer places than this is no narrowing, and the pass labels every element.
const MIN_DROP_TARGETS = 2;
export const keeps_narrowing = (target_count: number): boolean => target_count >= MIN_DROP_TARGETS;

// Climbs out of a shadow root through its host.
const up_of = (element: Element): Element | null => element.parentElement ?? (element.parentNode as ShadowRoot | null)?.host ?? null;

const has_box = (element: Element): boolean => {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
};

// Same tag, and a class, a test id, a role or the draggable mark in common: the other cards of a board.
function is_kin(source: Element, other: Element): boolean {
  if (other === source || other.localName !== source.localName) return false;
  if (Array.from(source.classList).some((name) => other.classList.contains(name))) return true;
  return SHARED_ATTRIBUTES.some((name) => source.hasAttribute(name) && source.getAttribute(name) === other.getAttribute(name));
}

// The elements the drop can land on, or undefined when the source gives no structure to read (a pointer widget, or an element with no kin), so the caller labels every element.
// - kin and their parents: the cards of a board and its columns, the source's own column too, for a reorder.
// - the siblings of each ancestor of the source: the empty columns and a trash box beside the board. They need no kin, so only a box counts, and a column that holds one wrapper stays.
// - drop markers anywhere in the document.
export function drop_targets_of(source: Element): Set<Element> | undefined {
  if (source.matches(POINTER_WIDGETS)) return undefined;
  const root = source.getRootNode() as ParentNode;
  const kin = Array.from(root.querySelectorAll(source.localName)).filter((other) => is_kin(source, other));
  if (kin.length === 0) return undefined;
  const targets = new Set<Element>(kin);
  for (const card of [source, ...kin]) {
    const parent = up_of(card);
    if (parent) targets.add(parent);
  }
  for (let step: Element | null = source; step; step = up_of(step)) {
    for (const peer of Array.from((step.parentNode as ParentNode | null)?.children ?? [])) if (peer !== step && has_box(peer)) targets.add(peer);
  }
  for (const marked of Array.from(root.querySelectorAll(MARKERS))) targets.add(marked);
  targets.delete(source);
  targets.delete(source.ownerDocument.documentElement);
  targets.delete(source.ownerDocument.body);
  return targets;
}

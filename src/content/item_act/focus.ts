// The focus ring of an item: Tab and Shift-Tab in item mode step through the shown, focusable elements inside the current item.

import { is_shown } from "../shown.ts";

const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[contenteditable]:not([contenteditable="false"]),[tabindex]';

// `tabIndex` is -1 for a disabled control and for a tabindex="-1" element, which the browser's own Tab skips too.
const can_focus = (element: Element): boolean => (element as HTMLElement).tabIndex >= 0 && !element.matches(":disabled") && is_shown(element);

export const focusables_in = (root: ParentNode): Element[] => Array.from(root.querySelectorAll(FOCUSABLE)).filter(can_focus);

// An item whose only focusable element is its main link has no ring to wrap in, so the step goes on through the page's own focusables as the browser's Tab would. `page_focusables` is a function because reading the whole page costs layout.
export const next_focus = (item: Element, active: Element | null, direction: "next" | "prev", page_focusables: () => Element[]): Element | undefined => {
  const inside = focusables_in(item);
  if (!inside.length) return undefined;
  const ring = inside.length > 1 ? inside : page_focusables();
  const at = ring.indexOf(inside.length > 1 ? active! : inside[0]!);
  return ring.at(at < 0 ? (direction === "next" ? 0 : -1) : (at + (direction === "next" ? 1 : -1)) % ring.length);
};

// Enter acts on the element the Tab ring or a click focused inside the item. The item's own link and the item itself take the plain open, and a field keeps its Enter.
export const focused_child = (item: Element, link: Element | undefined, active: Element | null, is_editable: (element: Element | null) => boolean): Element | undefined =>
  active && active !== item && active !== link && item.contains(active) && !is_editable(active) ? active : undefined;

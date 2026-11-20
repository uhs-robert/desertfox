// The focus ring of an item: Tab and Shift-Tab in item mode step through the shown, focusable elements inside the current item.

import { is_shown } from "../shown.ts";

const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[contenteditable]:not([contenteditable="false"]),[tabindex]';

// `tabIndex` is -1 for a disabled control and for a tabindex="-1" element, which the browser's own Tab skips too.
const can_focus = (element: Element): boolean => (element as HTMLElement).tabIndex >= 0 && !element.matches(":disabled") && is_shown(element);

// The root counts too: a row can select the links or focusable rows themselves, and `querySelectorAll` skips the root.
export const focusables_in = (root: Element): Element[] => [root, ...Array.from(root.querySelectorAll(FOCUSABLE))].filter((element) => element.matches(FOCUSABLE) && can_focus(element));

// An item whose only focusable element is its main link has no ring to wrap in, so the step goes on through the page's own focusables as the browser's Tab would, from the focus when it is among them. `page_focusables` is a function because reading the whole page costs layout.
export const next_focus = (item: Element, active: Element | null, direction: "next" | "prev", page_focusables: () => Element[]): Element | undefined => {
  const inside = focusables_in(item);
  if (!inside.length) return undefined;
  const ring = inside.length > 1 ? inside : page_focusables();
  const at = ring.includes(active!) ? ring.indexOf(active!) : inside.length > 1 ? -1 : ring.indexOf(inside[0]!);
  return ring.at(at < 0 ? (direction === "next" ? 0 : -1) : (at + (direction === "next" ? 1 : -1)) % ring.length);
};

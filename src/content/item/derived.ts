// The derived row of the page: what the finder found, kept for the document so a key press does not read the page again.
// It is read again only when no item of the answer shows, the first item has left the DOM, or the address changed. There is no MutationObserver: a page that changes under a still-shown answer keeps the old items until one of those holds.

import { find_items, FINDER_BUDGET_MS } from "./finder.ts";
import type { Found } from "./finder.ts";
import { dom_reader } from "./dom_reader.ts";
import { is_shown } from "../shown.ts";

// A page with no list gives `none`, and every key press would read the page again to see whether one appeared. A none answer stands this long.
export const NONE_RECHECK_MS = 500;

export type DerivedDeps = {
  find_: () => Found<Element>;
  url_: () => string;
  now_: () => number;
  is_shown_: (element: Element) => boolean;
};

export type DerivedRow = { items_: () => Element[]; link_of_: (item: Element) => Element | undefined; selector_: () => string };

// The tag and first class that the finder grouped the items by, as a selector. It only has to find the item a focus sits in (`closest`), so a page that reuses the class elsewhere gets a box on that element when a script moves the focus there.
const item_selector = (item: Element | undefined): string => (item ? item.localName + (item.classList[0] ? `.${CSS.escape(item.classList[0])}` : "") : "");

export function create_derived_row(deps: DerivedDeps): DerivedRow {
  let kept: { found: Found<Element>; url: string; at: number } | undefined;
  const still_good = (): boolean => {
    if (!kept || kept.url !== deps.url_()) return false;
    const { items } = kept.found;
    if (items.length === 0) return deps.now_() - kept.at < NONE_RECHECK_MS;
    return items[0]!.isConnected && items.some(deps.is_shown_);
  };
  const read = (): Found<Element> => {
    if (!still_good()) kept = { found: deps.find_(), url: deps.url_(), at: deps.now_() };
    return kept!.found;
  };
  return {
    items_: () => read().items.filter(deps.is_shown_),
    link_of_: (item) => kept?.found.links.get(item),
    selector_: () => item_selector(kept?.found.items[0]),
  };
}

export const live_derived_row = (): DerivedRow =>
  create_derived_row({
    find_: () => find_items(dom_reader(document), { now_: () => performance.now(), budget_ms_: FINDER_BUDGET_MS }),
    url_: () => location.href,
    now_: () => performance.now(),
    is_shown_: is_shown,
  });

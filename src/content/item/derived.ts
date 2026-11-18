// The derived row of the page: what the finder found, kept for the document so a key press does not read the page again.
// It is read again when no item of the answer shows, the first item has left the DOM, or the address changed, and at the end of the list when something new follows its last item. There is no MutationObserver: a page that changes under a still-shown answer keeps the old items until one of those holds.

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
  // What follows the last item of the list. A feed that loads more, or a `]]` load-more, changes it.
  tail_: (items: Element[]) => unknown[];
};

// `grew_` reads the page again when something new follows the last item, and says whether it did. A move at the end of the list asks it.
export type DerivedRow = { items_: () => Element[]; link_of_: (item: Element) => Element | undefined; selector_: () => string; grew_: () => boolean };

// The tag and first class that the finder grouped the items by, as a selector. It only has to find the item a focus sits in (`closest`), so a page that reuses the class elsewhere gets a box on that element when a script moves the focus there.
const item_selector = (item: Element | undefined): string => (item ? item.localName + (item.classList[0] ? `.${CSS.escape(item.classList[0])}` : "") : "");

export function create_derived_row(deps: DerivedDeps): DerivedRow {
  let kept: { found: Found<Element>; url: string; at: number; tail: unknown[] } | undefined;
  let timeouts_in_a_row = 0;
  const still_good = (): boolean => {
    if (!kept || kept.url !== deps.url_()) return false;
    const { items } = kept.found;
    if (items.length === 0) return deps.now_() - kept.at < NONE_RECHECK_MS;
    return items[0]!.isConnected && items.some(deps.is_shown_);
  };
  // A run that ran out of time, or a finder bug, scrolls this press and keeps nothing, so the next press reads the page again: a cold first run can overrun where a warm one fits. A second timeout in a row stands as a none, so a held j on a page that always overruns does not run the finder on every repeat.
  const read = (): Found<Element> | undefined => {
    if (!still_good()) {
      kept = undefined;
      try {
        const found = deps.find_();
        timeouts_in_a_row = found.timed_out_ ? timeouts_in_a_row + 1 : 0;
        if (timeouts_in_a_row !== 1) kept = { found, url: deps.url_(), at: deps.now_(), tail: deps.tail_(found.items) };
      } catch (error) {
        console.error(error);
      }
    }
    return kept?.found;
  };
  return {
    items_: () => read()?.items.filter(deps.is_shown_) ?? [],
    // A link the page replaced or moved out of its item reads the page again. A link that left the page is in no item.
    link_of_: (item) => {
      const link = kept?.found.links.get(item);
      if (link && !item.contains(link)) kept = undefined;
      return read()?.links.get(item);
    },
    selector_: () => item_selector(kept?.found.items[0]),
    grew_: () => !!kept?.found.items[0] && deps.tail_(kept.found.items).some((next, at) => next !== kept!.tail[at]) && !(kept = undefined),
  };
}

const after = (element: Element | null | undefined) => element?.nextElementSibling;

export const live_derived_row = (): DerivedRow =>
  create_derived_row({
    find_: () => find_items(dom_reader(document), { now_: () => performance.now(), budget_ms_: FINDER_BUDGET_MS }),
    url_: () => location.href,
    now_: () => performance.now(),
    is_shown_: is_shown,
    // New items go after the last one, or into a new batch after its parent.
    tail_: (items) => [after(items.at(-1)), after(items.at(-1)?.parentElement)],
  });

// The derived row of the page: what the finder found, kept for the document so a key press does not read the page again.
// It is read again when no item of the answer shows, the first item has left the DOM, or the address changed, and at the end of the list when something new follows its last item. There is no MutationObserver: a page that changes under a still-shown answer keeps the old items until one of those holds.

import { find_items, FINDER_BUDGET_MS, LONG_BUDGET_MS } from "./finder.ts";
import type { Found } from "./finder.ts";
import { dom_reader } from "./dom_reader.ts";
import { is_shown } from "../shown.ts";

// Read through the `href` attribute, because an `a` in an svg has no string `href` property, and a malformed one is another page.
const same_page_ = (link: Element): boolean => URL.parse(link.getAttribute("href")!, location.href)?.href.split("#")[0] === location.href.split("#")[0];

// A page with no list gives `none`, and every key press would read the page again to see whether one appeared. A none answer stands this long.
export const NONE_RECHECK_MS = 500;
// After two reads in a row overran the long budget at an address, reads there get the short one for this long, then the long one may try again (a page read while the machine was busy).
export const OVERRUN_PAUSE_MS = 10_000;

export type DerivedDeps = {
  // The time budget of the read: `LONG_BUDGET_MS` or `FINDER_BUDGET_MS`.
  find_: (budget_ms: number) => Found<Element>;
  url_: () => string;
  now_: () => number;
  is_shown_: (element: Element) => boolean;
  // What follows the last item of the list. A feed that loads more, or a `]]` load-more, changes it.
  tail_: (items: Element[]) => unknown[];
};

// `grew_` reads the page again when something new follows the last item, and says whether it did. A move at the end of the list asks it. `grid_` says whether the kept answer is a grid.
export type DerivedRow = { items_: () => Element[]; link_of_: (item: Element) => Element | undefined; selector_: () => string; grew_: () => boolean; grid_: () => boolean };

// The tag and first class that the finder grouped the items by, as a selector. It only has to find the item a focus sits in (`closest`), so a page that reuses the class elsewhere gets a box on that element when a script moves the focus there. Items of more than one tag (batches that draw one template in two tags) give the class alone.
const item_selector = (items: readonly Element[] = []): string => {
  const [item] = items;
  return item ? (items.some((other) => other.localName !== item.localName) ? "" : item.localName) + (item.classList[0] ? `.${CSS.escape(item.classList[0])}` : "") : "";
};

export function create_derived_row(deps: DerivedDeps): DerivedRow {
  let kept: { found: Found<Element>; url: string; at: number; tail: unknown[] } | undefined;
  // The count of reads in a row that ran out of time at `read_at`, the address of the last read. It starts again at a new address.
  let timeouts_in_a_row = 0;
  let read_at: string | undefined;
  let overran: { url: string; until: number } | undefined;
  const still_good = (): boolean => {
    if (!kept || kept.url !== deps.url_()) return false;
    const { items } = kept.found;
    if (items.length === 0) return deps.now_() - kept.at < NONE_RECHECK_MS;
    return items[0]!.isConnected && items.some(deps.is_shown_);
  };
  // A run that ran out of time, or a finder bug, scrolls this press and keeps nothing, so the next press reads the page again: a cold first run can overrun where a warm one fits. A second timeout in a row stands as a none, so a held j on a page that always overruns does not run the finder on every repeat.
  // Budgets: a read gets the long one (the first read at an address, or one after the kept list dropped), so a long page answers once. A held j on a page with no list re-reads its expired `none` with the short one, and a timeout there keeps the old `none`: a full read of a long text page every 500 ms would stall the scroll. Two overruns in a row put the address on the short budget for `OVERRUN_PAUSE_MS`.
  const read = (): Found<Element> | undefined => {
    if (!still_good()) {
      const url = deps.url_();
      const expired_none = kept && kept.url === url && kept.found.items.length === 0 ? kept : undefined;
      kept = undefined;
      if (read_at !== url) timeouts_in_a_row = 0;
      read_at = url;
      const short = (expired_none && !expired_none.found.timed_out_) || (overran?.url === url && deps.now_() < overran.until);
      try {
        const found = deps.find_(short ? FINDER_BUDGET_MS : LONG_BUDGET_MS);
        if (found.timed_out_ && short && expired_none) {
          expired_none.at = deps.now_();
          kept = expired_none;
          return kept.found;
        }
        timeouts_in_a_row = found.timed_out_ ? timeouts_in_a_row + 1 : 0;
        if (timeouts_in_a_row >= 2) overran = { url, until: deps.now_() + OVERRUN_PAUSE_MS };
        if (timeouts_in_a_row !== 1) kept = { found, url, at: deps.now_(), tail: deps.tail_(found.items) };
      } catch (error) {
        console.error(error);
      }
    }
    return kept?.found;
  };
  return {
    items_: () => read()?.items.filter(deps.is_shown_) ?? [],
    // A link the page replaced, hid or moved out of its item reads the page again. A link that left the page is in no item.
    link_of_: (item) => {
      const link = kept?.found.links.get(item);
      if (link && !(item.contains(link) && deps.is_shown_(link))) kept = undefined;
      return read()?.links.get(item);
    },
    selector_: () => item_selector(kept?.found.items),
    grid_: () => kept?.found.kind === "grid",
    grew_: () => !!kept?.found.items[0] && deps.tail_(kept.found.items).some((next, at) => next !== kept!.tail[at]) && !(kept = undefined),
  };
}

const after = (element: Element | null | undefined) => element?.nextElementSibling;

const now_ = () => performance.now();

// New items go after the last one, into a new batch after its parent, or into the parent in place of its last child (a load-more form that the load replaces).
export const list_tail = (items: readonly Element[]): unknown[] => {
  const parent = items.at(-1)?.parentElement;
  return [after(items.at(-1)), after(parent), parent?.lastElementChild];
};

export const live_derived_row = (): DerivedRow =>
  create_derived_row({
    find_: (budget_ms_) => find_items({ ...dom_reader(document), same_page_ }, { now_, budget_ms_ }),
    url_: () => location.href,
    now_,
    is_shown_: is_shown,
    tail_: list_tail,
  });

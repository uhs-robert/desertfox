// The derived row of the page: what the finder found, kept for the document so a key press does not read the page again.
// The finder answers every top-level list, and one of them is active. A read first makes active the list that holds the keyboard focus, whether it is long or pick-only. The active list stays while any of its items shows in the view. When none does, the next press makes the list with the most area in view active, and with no list in view it keeps the active one and reads the page again once the answer is old. The page is also read again when the active list's first item has left the DOM or the address changed, and at the end of the list when something new follows its last item. There is no MutationObserver and no scroll listener: a page that changes under a shown list keeps the old answer until one of those holds, and the switch happens on a press.

import { find_items, FINDER_BUDGET_MS, LONG_BUDGET_MS } from "./finder.ts";
import type { Found, Region } from "./finder.ts";
import { dom_reader } from "./dom_reader.ts";
import { is_shown } from "../shown.ts";

// Read through the `href` attribute, because an `a` in an svg has no string `href` property, and a malformed one is another page. The address resolves against the base of the document, and the page is where the browser is.
const same_page_ = (link: Element): boolean => URL.parse(link.getAttribute("href")!, document.baseURI)?.href.split("#")[0] === location.href.split("#")[0];

// A page with no list gives `none`, and every key press would read the page again to see whether one appeared. A none answer stands this long.
// The state of the kept answer (see `state` in the row).
const [GOOD, OLD, GONE] = [0, 1, 2] as const;

export const NONE_RECHECK_MS = 500;
// After two reads in a row overran the long budget at an address, reads there get the short one for this long, then the long one may try again (a page read while the machine was busy).
export const OVERRUN_PAUSE_MS = 10_000;

export type DerivedDeps = {
  // The time budget of the read: `LONG_BUDGET_MS` or `FINDER_BUDGET_MS`.
  find_: (budget_ms: number) => Found<Element>;
  url_: () => string;
  now_: () => number;
  is_shown_: (element: Element) => boolean;
  // The area of the element that the user sees: inside the view and not clipped or covered.
  in_view_: (element: Element) => number;
  // What follows the last item of the list. A feed that loads more, or a `]]` load-more, changes it.
  tail_: (items: Element[]) => unknown[];
  // The element that holds the keyboard focus.
  focus_: () => Element | null;
};

// A pin is a pick of a list that a site row's keys do not walk: `pinned_` says whether one is on, after a read that drops it when its list is gone or the address changed. `grew_` reads the page again when something new follows the last item, and says whether it did. A move at the end of the list asks it. `grid_` says whether the kept answer is a grid.
export type DerivedRow = { items_: (keep?: boolean) => Element[]; sections_: () => Element[]; link_of_: (item: Element) => Element | undefined; selector_: () => string; grew_: () => boolean; grid_: () => boolean; focus_none_: () => boolean; lists_: () => Region<Element>[]; active_: () => Region<Element> | undefined; pick_: (region: Region<Element>) => void; pin_: (region: Region<Element>) => void; unpin_: () => void; pinned_: () => boolean };

// The tag and first class that the finder grouped the items by, as a selector. It only has to find the item a focus sits in (`closest`), so a page that reuses the class elsewhere gets a box on that element when a script moves the focus there. Items of more than one tag (batches that draw one template in two tags) give the class alone.
const item_selector = (items: readonly Element[] = []): string => {
  const [item] = items;
  return item ? (items.some((other) => other.localName !== item.localName) ? "" : item.localName) + (item.classList[0] ? `.${CSS.escape(item.classList[0])}` : "") : "";
};

export function create_derived_row(deps: DerivedDeps): DerivedRow {
  // The items of the list that was active at the last read, so the next read can tell which list it was. A feed that drops or hides its first items still matches through one that stays.
  let active_items: Element[] = [];
  // The widget of the active list when it has one (an ARIA list), for a page that replaces the rows as the list scrolls.
  let active_home: Element | undefined;
  let kept: { found: Found<Element>; active: Region<Element>; url: string; at: number; tail: unknown[] } | undefined;
  // The count of reads in a row that ran out of time at `read_at`, the address of the last read. It starts again at a new address.
  let timeouts_in_a_row = 0;
  let read_at: string | undefined;
  let overran: { url: string; until: number } | undefined;
  // The address a pick pinned the active list at. The pin holds the list against the hand-over to a list in view, and ends with the address, with the list leaving the page, or with `unpin_`.
  let pin: { url: string } | undefined;
  // A pick-only region (a short list) never wins a hand-over or the first choice. Only a pick makes it active, and the `old` lookup then keeps it.
  const long_regions = (regions: Region<Element>[]) => regions.filter((region) => !region.pick_only_);
  // The first of equal areas wins, and the regions run from the largest down. A region out of the view is none.
  const most_in_view = (regions: Region<Element>[]): Region<Element> | undefined => {
    let top: Region<Element> | undefined;
    let most = 0;
    for (const region of regions) {
      const area = region.items.reduce((sum, item) => sum + deps.in_view_(item), 0);
      if (area > most) (top = region), (most = area);
    }
    return top;
  };
  const remember = (region: Region<Element>): void => {
    active_items = region.items;
    active_home = region.home_;
  };
  // `old` keeps the answer for now and asks for a read with the short budget. `gone` needs a read. A list in view that is not the active one also asks for a read, so a hand-over sees lists that loaded since the last read. `keep` is an end command that follows its own list: the active list stays while it is on the page.
  const state = (keep: boolean): typeof GOOD | typeof OLD | typeof GONE => {
    if (!kept || kept.url !== deps.url_() || kept.active.items[0]?.isConnected === false) return GONE;
    if ((keep && kept.active.items[0]) || kept.active.items.some(deps.in_view_)) return GOOD;
    return most_in_view(long_regions(kept.found.regions)) ? GONE : deps.now_() - kept.at < NONE_RECHECK_MS ? GOOD : OLD;
  };
  // A run that ran out of time, or a finder bug, scrolls this press and keeps nothing, so the next press reads the page again: a cold first run can overrun where a warm one fits. A second timeout in a row stands as a none, so a held j on a page that always overruns does not run the finder on every repeat.
  // Budgets: a read gets the long one (the first read at an address, or one after the kept list dropped), so a long page answers once. A held j on a page with no list re-reads its expired `none` with the short one, and a timeout there keeps the old `none`: a full read of a long text page every 500 ms would stall the scroll. Two overruns in a row put the address on the short budget for `OVERRUN_PAUSE_MS`.
  const read = (keep = false): Region<Element> | undefined => {
    const url = deps.url_();
    if (pin && pin.url !== url) pin = undefined;
    const hold = keep || !!pin;
    const status = state(hold);
    if (status !== GOOD) {
      const expired_none = status === OLD ? kept : undefined;
      kept = undefined;
      if (read_at !== url) timeouts_in_a_row = 0;
      read_at = url;
      const short = (expired_none && !expired_none.found.timed_out_) || (overran?.url === url && deps.now_() < overran.until);
      try {
        const found = deps.find_(short ? FINDER_BUDGET_MS : LONG_BUDGET_MS);
        if (found.timed_out_ && short && expired_none) {
          expired_none.at = deps.now_();
          kept = expired_none;
          return kept.active;
        }
        timeouts_in_a_row = found.timed_out_ ? timeouts_in_a_row + 1 : 0;
        if (timeouts_in_a_row >= 2) overran = { url, until: deps.now_() + OVERRUN_PAUSE_MS };
        if (timeouts_in_a_row !== 1) {
          // The list the user was on stays active while it shows (or, for an end command, always), and otherwise the list in view takes over.
          const old = found.regions.find((region) => region.items.some((item) => active_items.includes(item)) || (!!active_home && region.home_ === active_home));
          // A read that ran out of time shows nothing about the list, so only a whole read that lacks it drops the pin.
          if (pin && !old && !found.timed_out_) pin = undefined;
          // A widget list that keeps the focus off its rows (`focus_none_`) keeps its pick against a focus that sits in a link elsewhere. A focus left behind in a list scrolled out of view counts for nothing, as in `place_of`.
          const focus = deps.focus_();
          const focused = hold || old?.focus_none_ ? undefined : most_in_view(found.regions.filter((region) => region.items.some((item) => item.contains(focus))));
          const active = (hold ? old : focused ?? most_in_view(old ? [old] : [])) ?? most_in_view(long_regions(found.regions)) ?? old ?? long_regions(found.regions)[0] ?? found;
          if (!(pin && found.timed_out_)) remember(active);
          kept = { found, active, url, at: deps.now_(), tail: deps.tail_(active.items) };
        }
      } catch (error) {
        console.error(error);
      }
    }
    return kept?.active;
  };
  // The list the user picked, and the next read matches it through its items.
  const pick = (region: Region<Element>): void => {
    remember(region);
    if (!kept) return;
    kept.active = region;
    kept.tail = deps.tail_(region.items);
  };
  return {
    items_: (keep) => read(keep)?.items.filter(deps.is_shown_) ?? [],
    // A peek at the kept list, called after `items_` in the same move: that read has replaced the list when it had to, and a read that timed out kept nothing and must not cost a second one.
    sections_: () => kept?.active.sections ?? [],
    // A link the page replaced, hid or moved out of its item reads the page again. A link that left the page is in no item.
    link_of_: (item) => {
      const link = kept?.active.links.get(item);
      if (link && !(item.contains(link) && deps.is_shown_(link))) kept = undefined;
      return read(true)?.links.get(item);
    },
    selector_: () => kept?.active.box_selector_ ?? item_selector(kept?.active.items),
    grid_: () => kept?.active.kind === "grid",
    focus_none_: () => !!kept?.active.focus_none_,
    lists_: () => (read(), kept?.found.regions ?? []),
    active_: () => kept?.active,
    pick_: pick,
    pin_: (region) => {
      pick(region);
      pin = { url: deps.url_() };
    },
    unpin_: () => void (pin = undefined),
    pinned_: () => (pin ? (read(true), !!pin) : false),
    grew_: () => !!kept?.active.items[0] && deps.tail_(kept.active.items).some((next, at) => next !== kept!.tail[at]) && !(kept = undefined),
  };
}

const after = (element: Element | null | undefined) => element?.nextElementSibling;

const now_ = () => performance.now();

// New items go after the last one, into a new batch after its parent, or into the parent in place of its last child (a load-more form that the load replaces).
export const list_tail = (items: readonly Element[]): unknown[] => {
  const parent = items.at(-1)?.parentElement;
  return [after(items.at(-1)), after(parent), parent?.lastElementChild];
};

// Clipped to the view and probed at the middle of what shows, so an item that a scroll box or a layer hides counts for nothing (the Mix panel's items below its own edge). The probe asks the item's own root, so an item in a shadow root is found, and it misses a layer outside that root.
export const in_view_ = (element: Element): number => {
  const rect = element.getBoundingClientRect();
  const [left, top, right, bottom] = [Math.max(rect.left, 0), Math.max(rect.top, 0), Math.min(rect.right, innerWidth), Math.min(rect.bottom, innerHeight)];
  return right > left && bottom > top && element.contains((element.getRootNode() as Document).elementFromPoint((left + right) / 2, (top + bottom) / 2)) ? (right - left) * (bottom - top) : 0;
};

export const live_derived_row = (): DerivedRow =>
  create_derived_row({
    find_: (budget_ms_) => find_items({ ...dom_reader(document), same_page_ }, { now_, budget_ms_ }),
    url_: () => location.href,
    now_,
    is_shown_: is_shown,
    in_view_,
    tail_: list_tail,
    focus_: () => document.activeElement,
  });

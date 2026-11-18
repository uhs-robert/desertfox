import type { UserLeft } from "../user_left.ts";

// How long the end of the list may stay the same before gg or G stops following it. Long enough for a page that fetches the next part of a list over the network.
export const END_STALL_MS = 1000;
// How often gg and G read the list again while the page draws or fetches rows.
export const END_POLL_MS = 50;
// The longest gg or G follows the end, so a feed that never stops loading does not hold it.
export const END_MAX_MS = 10_000;

export type ScrollBox = Pick<Element, "scrollTop" | "scrollHeight" | "clientHeight" | "parentElement" | "scrollTo">;

// What following an end needs from the page, so a test passes fakes.
export type EndPage = {
  doc: Pick<Document, "scrollingElement">;
  overflow_y_: (element: Element) => string;
  wait_: (ms: number) => Promise<void>;
  now_: () => number;
  watch_user_: () => UserLeft;
};

// The element that scrolls the list: the nearest ancestor that may scroll and holds more than it shows, else the page. Drive keeps an overflow box between its rows and its real panel that holds no more than it shows, so the overflow value alone picks the wrong one.
export function list_scroller(item: Element, page: Pick<EndPage, "doc" | "overflow_y_">): ScrollBox {
  for (let box = item.parentElement; box; box = box.parentElement) {
    if (/auto|scroll/.test(page.overflow_y_(box)) && box.scrollHeight > box.clientHeight) return box;
  }
  return page.doc.scrollingElement!;
}

const row_index = (item: Element): number => Number(item.getAttribute("aria-rowindex")) || 0;

// The drawn item nearest the end: by aria-rowindex where the list numbers its rows, as a list that draws only the rows near the view may keep them out of order, else by document order (the sort is stable). `-to_last` is -1 (the last) or 0 (the first), shorter than a ternary in a bundle at its size guard.
export const end_item = (items: readonly Element[], to_last: boolean): Element | undefined => [...items].sort((a, b) => row_index(a) - row_index(b)).at(-to_last);

// A last drawn row below aria-rowcount: the list has more rows to draw. Drive gives aria-rowcount as the rows it has loaded, not the whole folder, so a match does not mean the end.
const rows_below = (item: Element): boolean => Number(item.closest("[aria-rowcount]")?.getAttribute("aria-rowcount")) > row_index(item) && row_index(item) > 0;

// Scrolls the list to its end and lands on the end item, then follows the end while the page draws or loads more rows: each time the list grows it scrolls to the end again and lands on the new end item. It stops once the end stays the same for END_STALL_MS (past it while rows lie below the last one), after END_MAX_MS, or when the user does something else.
export async function follow_end(page: EndPage, read_items: () => Element[], to_last: boolean, land: (item: Element, on_page_scroller: boolean) => void): Promise<void> {
  let items = read_items();
  if (!items[0]) return;
  const scroller = list_scroller(items[0]!, page);
  const user = page.watch_user_();
  const started = page.now_();
  let changed_at = started;
  let height = -1;
  let landed: Element | undefined;
  try {
    for (;;) {
      const now = page.now_();
      const top = scroller.scrollTop;
      if (scroller.scrollHeight !== height) {
        height = scroller.scrollHeight;
        changed_at = now;
        // The scroll below can take the landed item out of view (a page that grows under its last result), so the same item lands again and comes back into view.
        landed = undefined;
        scroller.scrollTo({ top: to_last ? height : 0, behavior: "instant" });
      }
      // Right after a scroll the items are the ones drawn before it, and landing on one would scroll the list back to it. The page may also have dropped the item while this waited.
      const target = scroller.scrollTop === top ? end_item(items, to_last) : undefined;
      if (target?.isConnected && target !== landed) {
        land(target, scroller === page.doc.scrollingElement);
        landed = target;
        changed_at = now;
      }
      if (now - started >= END_MAX_MS || (now - changed_at >= END_STALL_MS && !(to_last && target && rows_below(target)))) return;
      await page.wait_(END_POLL_MS);
      if (user.left_()) return;
      items = read_items();
    }
  } finally {
    user.stop_();
  }
}

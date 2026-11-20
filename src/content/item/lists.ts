// The lists of the picker (`item.lists`, asked by the hints bundle's `I`) and the pin a pick of another list sets.

import type { DerivedRow } from "./derived.ts";
import type { Region } from "./finder.ts";
import { forget_move } from "./pick.ts";
import { is_shown } from "../shown.ts";

// While a picked side list is pinned, the row's selector and link mean nothing for it, so the move takes the finder path that walks the derived list. The pin is read first, because the read can drop it (its list left the page).
export const args_for_pin = <A extends { selector?: string; link?: string; section?: string }>(derived: DerivedRow, args: A): A => {
  if (!derived.pinned_()) return args;
  const { selector: _selector, link: _link, section: _section, ...unbound } = args;
  return unbound as A;
};

// A site row's items are the first list the picker offers, then the finder's lists that share no item with them (the finder finds the same results again). With `row_only` they are the only list, which keeps a fast `I` at once. The finder finds nothing on some rows (Drive's files hold no title link), and a row that does not show offers the finder's lists.
export function lists_with_row(doc: ParentNode, read_lists: () => Region<Element>[], selector: string | undefined, row_only: boolean): Region<Element>[] {
  const items = selector ? Array.from(doc.querySelectorAll(selector)).filter(is_shown) : [];
  if (!items[0]) return read_lists();
  const row: Region<Element> = { kind: "list", items, links: new Map(), row_: true };
  const overlaps_row = (region: Region<Element>) => region.items.some((item) => items.some((row_item) => row_item.contains(item) || item.contains(row_item)));
  return row_only ? [row] : [row, ...read_lists().filter((region) => !overlaps_row(region))];
}

// Picking the row's list makes its own keys walk it again. Picking another list pins it while a row is named (`row_selector`), so the row's keys walk it too. Making another list active puts the focus on the first item the pick showed, and picking the list that is active already leaves the focus and the last move alone, so the landing goes on from the current item.
export function pick_list(derived: DerivedRow, region: Region<Element>, focus: HTMLElement | undefined, row_selector: boolean): void {
  const was_pinned = derived.pinned_();
  // With a row named, the active list counts as the user's only while it is pinned: a row pick unpins but leaves the side list active.
  const was = region.row_ ? !was_pinned : (was_pinned || !row_selector) && derived.active_()?.items[0] === region.items[0];
  if (region.row_) derived.unpin_();
  else (row_selector ? derived.pin_ : derived.pick_)(region);
  if (!was) (forget_move(), !region.focus_none_ && focus?.focus({ preventScroll: true }));
}

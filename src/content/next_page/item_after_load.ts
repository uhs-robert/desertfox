// After `]]` loads more on a page with a `page.item` row, the box moves to the first item the load added.

import type { ItemCursor } from "../item/pick.ts";
import { wait_for_new_content } from "./load_outcome.ts";
import type { ContentWatch } from "./load_outcome.ts";
import type { UserLeft } from "../user_left.ts";

// Node.DOCUMENT_POSITION_FOLLOWING and _CONTAINED_BY, as numbers so the pure part runs without a DOM.
const FOLLOWING = 4;
const CONTAINED_BY = 16;

// The first item after the last old item still on the page, in document order. Not the old count as an index: a page that drops or virtualizes the items above shifts every index.
export function first_item_after(old_items: readonly Element[], items: readonly Element[]): Element | undefined {
  const anchor = old_items.findLast((item) => item.isConnected);
  return anchor && items.find((item) => (anchor.compareDocumentPosition(item) & (FOLLOWING | CONTAINED_BY)) === FOLLOWING);
}

export type ItemAfterLoadDeps = {
  // The items of a row selector that the box can land on, in document order.
  items_: (selector: string) => Element[];
  // Hands over the elements of each addition to the page. Its height is not read.
  watch_: ContentWatch;
  cursor_: () => Promise<ItemCursor | undefined>;
  in_normal_mode_: () => boolean;
  // Starts the watch for the user leaving. Called once the box is known to move, so a signal before the load starts never counts.
  watch_user_left_: () => UserLeft;
};

const holds_item = (added: Element, selector: string): boolean => added.matches(selector) || added.querySelector(selector) !== null;

// Call it before the click or scroll, with the cursor read then. It waits up to the load wait for an item to follow the old last one, which can come after a spinner or other first additions.
// Only a batch that adds an item reads the whole list, because each read forces a layout and some pages change all the time. An item that fades in after its batch is found by one more look at the end of the wait.
// It leaves the box where it is when the user moved it to another item, left normal mode, left the page (hid the tab, pressed a key, used the wheel or pressed a pointer) or no item came.
export async function move_box_after_load(before: ItemCursor | undefined, deps: ItemAfterLoadDeps): Promise<void> {
  if (!before?.shown_ || !before.item_) return;
  const user = deps.watch_user_left_();
  try {
    const selector = before.selector_;
    const old_items = deps.items_(selector);
    const first_new = () => first_item_after(old_items, deps.items_(selector));
    const until_new_item: ContentWatch = { start_: (on_added) => deps.watch_.start_((added) => added.some((element) => holds_item(element, selector)) && first_new() && on_added(added)), page_height_: () => 0 };
    await wait_for_new_content(until_new_item);
    const target = first_new();
    if (!target) return;
    const now = await deps.cursor_();
    if (now?.item_ === before.item_ && deps.in_normal_mode_() && !user.left_()) now.land_(target);
  } finally {
    user.stop_();
  }
}

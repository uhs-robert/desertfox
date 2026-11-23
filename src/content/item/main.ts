// The `item` bundle: the handler of `page.item`, which item mode and site rows bind to j and k on result pages, and `item.start`, which starts item mode on a list page. Loaded on the first press.

import type { PageHostApi } from "../bundle_host.ts";
import { all_items, carry_row, current_item, follow_item, move_item, read_cursor, watch_lands } from "./pick.ts";
import type { ItemArgs } from "../lib/item_types.ts";
import { create_item_overlay } from "./overlay.ts";
import { in_view_, live_derived_row } from "./derived.ts";
import { args_for_pin, lists_with_row, pick_list } from "./lists.ts";
import { watch_user_left } from "../user_left.ts";
import { create_item_start } from "./start.ts";
import { create_selection } from "./selection.ts";
import { best_effort } from "../../shared/swallow.ts";
import { is_shown } from "../shown.ts";

declare const browser: MessagingBrowser;

type ItemWindow = { desertfox_host?: PageHostApi; desertfox_item_ready?: true };
const item_window = window as unknown as ItemWindow;

// A second run would register the handler again for nothing. With no host, content.js has not started here, and the load it asks for later registers the handler.
const host = item_window.desertfox_host;
if (!item_window.desertfox_item_ready && host) {
  item_window.desertfox_item_ready = true;
  const watch_user_ = () => watch_user_left(document, window, host.pressed_keys_);
  const overlay = create_item_overlay(host.get_mode, watch_user_, follow_item, () => selection.tick_(), (count) => (host.visual_count_(count), window === window.top || void best_effort(browser.runtime.sendMessage({ type: "relay", to: "top", id: "ui.badge_count", args: { count } }))));
  const page = {
    doc: document,
    view: window,
    focused: host.focused_,
    toast: host.show_toast_,
    scroll_by: host.scroll_by_,
    highlight: overlay.show,
    box_shown: overlay.shown_,
    derived: live_derived_row(),
    in_view_,
    overflow_y_: (element: Element) => getComputedStyle(element).overflowY,
    // A timer and not the next frame, because a hidden tab draws no frames.
    wait_: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now_: () => performance.now(),
    watch_user_,
    swap_ends_: () => selection.swap_(),
  };
  const selection = create_selection({
    items_: () => all_items(page),
    in_visual_: () => host.get_mode() === "item_visual",
    follow_: follow_item,
    ended_: () => (host.set_mode_("item"), host.show_toast_("Selection gone")),
  });
  watch_lands(selection.land_);
  host.register_handler_("page.item", (args) => {
    const item_args = carry_row(args as ItemArgs);
    // `current` with extend starts a selection at the item it lands on, which is how `v` begins. Any other extend moves the cursor from where a redraw left it.
    if (item_args.extend) item_args.direction === "current" ? selection.start_next_land_(true) : selection.tick_();
    try {
      return move_item(page, args_for_pin(page.derived, item_args));
    } finally {
      selection.start_next_land_(false);
    }
  });
  // The background asks when a load completes. The handler answers at once, so no key waits for the idle time.
  const start = create_item_start({
    mode_: host.get_mode,
    // User activation misses most keys (Escape, the arrows, the function keys), so the key count of content.js decides for keys and the activation for clicks.
    user_active_: () => host.pressed_keys_() > 0 || navigator.userActivation.hasBeenActive,
    in_field_: () => host.is_editable_(host.focused_()),
    has_list_: (selectors) => (selectors[0] ? selectors.some((selector) => Array.from(document.querySelectorAll(selector)).some(is_shown)) : !!page.derived.items_()[0]),
    enter_: () => (page.derived.unpin_(), host.set_mode_("item")),
    leave_: () => host.set_mode_("normal"),
    when_idle_: (run) => requestIdleCallback(run, { timeout: 1000 }),
    later_: (run, ms) => setTimeout(run, ms),
    now_: () => performance.now(),
    on_unload_: (run, on) => (on ? addEventListener : removeEventListener)("beforeunload", run),
  });
  host.register_handler_("item.start", (args) => start(args.selectors, args.resume));
  // The shared focus mark, asked for by the hints bundle after a focus move. The focus can have left by the time this bundle loads, and then there is nothing to mark.
  host.register_handler_("item.mark", (args) => {
    const element = args.element;
    // With no row selector the box is the focus mark.
    if (element.isConnected && element.matches(":focus")) overlay.show(element);
  });
  host.register_handler_("item.lists", (args) => void (args.region ? pick_list(page.derived, args.region, args.focus, !!args.selector) : args.take(lists_with_row(document, () => page.derived.lists_(), args.selector, !!args.row_only))));
  // The hints bundle (item-first labels) and the item actions call this through `run_command_` and hand a callback that takes the item and its link.
  host.register_handler_("item.current", (args) => {
    const current = current_item(page);
    args.take(current?.item_, current?.link_);
  });
  // The item actions read the range of visual item mode (the items from the anchor to the cursor, and the anchor) through a callback, as for `item.current`.
  host.register_handler_("item.range", (args) => {
    const found = selection.tick_();
    args.take(found?.list_, found?.keys_, found?.from_, found?.to_, found?.anchor_);
  });
  // Only the next_page bundle calls this, through `run_command_`, and hands a callback that takes the cursor.
  host.register_handler_("item.cursor", (args) => args.take(read_cursor(page, overlay.shown_())));
}

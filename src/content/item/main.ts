// The `item` bundle: the handler of `page.item`, which item mode and site rows bind to j and k on result pages, and `item.start`, which starts item mode on a list page. Loaded on the first press.

import type { PageHostApi } from "../bundle_host.ts";
import { follow_item, move_item, read_cursor } from "./pick.ts";
import type { ItemArgs, ItemCursor } from "./pick.ts";
import { create_item_overlay } from "./overlay.ts";
import { live_derived_row } from "./derived.ts";
import { watch_user_left } from "../user_left.ts";
import { create_item_start } from "./start.ts";
import { is_shown } from "../shown.ts";

type ItemWindow = { desertfox_host?: PageHostApi; desertfox_item_ready?: true };
const item_window = window as unknown as ItemWindow;

// A second run would register the handler again for nothing. With no host, content.js has not started here, and the load it asks for later registers the handler.
const host = item_window.desertfox_host;
if (!item_window.desertfox_item_ready && host) {
  item_window.desertfox_item_ready = true;
  const watch_user_ = () => watch_user_left(document, window, host.pressed_keys_);
  const overlay = create_item_overlay(host.get_mode, watch_user_, follow_item);
  const page = {
    doc: document,
    view: window,
    focused: host.focused_,
    toast: host.show_toast_,
    scroll_by: host.scroll_by_,
    highlight: overlay.show,
    box_shown: overlay.shown_,
    derived: live_derived_row(),
    overflow_y_: (element: Element) => getComputedStyle(element).overflowY,
    // A timer and not the next frame, because a hidden tab draws no frames.
    wait_: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now_: Date.now,
    watch_user_,
  };
  host.register_handler_("page.item", (args) => move_item(page, args as unknown as ItemArgs));
  // The background asks when a load completes. The handler answers at once, so no key waits for the idle time.
  const start = create_item_start({
    mode_: host.get_mode,
    // User activation misses most keys (Escape, the arrows, the function keys), so the key count of content.js decides for keys and the activation for clicks.
    user_active_: () => host.pressed_keys_() > 0 || navigator.userActivation.hasBeenActive,
    in_field_: () => host.is_editable_(host.focused_()),
    has_list_: (selectors) => (selectors.length > 0 ? selectors.some((selector) => Array.from(document.querySelectorAll(selector)).some(is_shown)) : !!page.derived.items_()[0]),
    enter_: () => host.set_mode_("item"),
    when_idle_: (run) => requestIdleCallback(run, { timeout: 1000 }),
    later_: (run, ms) => setTimeout(run, ms),
  });
  host.register_handler_("item.start", (args) => start(args.selectors as string[] | undefined));
  // The shared focus mark, asked for by the hints bundle after a focus move. The focus can have left by the time this bundle loads, and then there is nothing to mark.
  host.register_handler_("item.mark", (args) => {
    const element = args.element as Element;
    // With no row selector the box is the focus mark.
    if (element.isConnected && element.matches(":focus")) overlay.show(element);
  });
  host.register_handler_("item.lists", (args) => void (args.region ? page.derived.pick_(args.region as never) : (args.take as (regions: unknown) => void)(page.derived.lists_())));
  // Only the next_page bundle calls this, through `run_command_`, and hands a callback that takes the cursor.
  host.register_handler_("item.cursor", (args) => (args.take as (cursor: ItemCursor | undefined) => void)(read_cursor(page, overlay.shown_())));
}

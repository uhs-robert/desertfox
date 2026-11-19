// The `item` bundle: the handler of `page.item`, which item mode and site rows bind to j and k on result pages, and `item.start`, which starts item mode on a list page. Loaded on the first press.

import type { PageHostApi } from "../bundle_host.ts";
import { follow_item, move_item, read_cursor } from "./pick.ts";
import type { ItemArgs, ItemCursor } from "./pick.ts";
import { create_item_overlay } from "./overlay.ts";
import { live_derived_row } from "./derived.ts";
import type { DerivedRow } from "./derived.ts";
import { watch_user_left } from "../user_left.ts";
import { create_item_start } from "./start.ts";
import type { Region } from "./finder.ts";
import { is_shown } from "../shown.ts";

type ItemWindow = { desertfox_host?: PageHostApi; desertfox_item_ready?: true };
const item_window = window as unknown as ItemWindow;

// A second run would register the handler again for nothing. With no host, content.js has not started here, and the load it asks for later registers the handler.
const host = item_window.desertfox_host;
if (!item_window.desertfox_item_ready && host) {
  item_window.desertfox_item_ready = true;
  const watch_user_ = () => watch_user_left(document, window, host.pressed_keys_);
  // Set by the hints bundle's pick, which holds a typed-ahead key until the next landing.
  let landed: (() => void) | undefined;
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
  host.register_handler_("page.item", (args) => {
    const moved = move_item(page, args as unknown as ItemArgs);
    if (args.direction === "current") (landed?.(), (landed = undefined));
    return moved;
  });
  // The background asks when a load completes. The handler answers at once, so no key waits for the idle time.
  const start = create_item_start({
    mode_: host.get_mode,
    // User activation misses most keys (Escape, the arrows, the function keys), so the key count of content.js decides for keys and the activation for clicks.
    user_active_: () => host.pressed_keys_() > 0 || navigator.userActivation.hasBeenActive,
    in_field_: () => host.is_editable_(host.focused_()),
    has_list_: (selectors) => (selectors[0] ? selectors.some((selector) => Array.from(document.querySelectorAll(selector)).some(is_shown)) : !!page.derived.items_()[0]),
    enter_: () => host.set_mode_("item"),
    when_idle_: (run) => requestIdleCallback(run, { timeout: 1000 }),
    later_: (run, ms) => setTimeout(run, ms),
    now_: Date.now,
    on_unload_: (run, on) => (on ? addEventListener : removeEventListener)("beforeunload", run),
  });
  host.register_handler_("item.start", (args) => start(args.selectors as string[] | undefined));
  // The shared focus mark, asked for by the hints bundle after a focus move. The focus can have left by the time this bundle loads, and then there is nothing to mark.
  host.register_handler_("item.mark", (args) => {
    const element = args.element as Element;
    // With no row selector the box is the focus mark.
    if (element.isConnected && element.matches(":focus")) overlay.show(element);
  });
  host.register_handler_("item.lists", (args) => void (args.region ? ((landed = args.landed as typeof landed), pick_list(page.derived, args.region as Region<Element>, args.focus as HTMLElement | undefined)) : (args.take as (regions: unknown) => void)(lists_with_row(() => page.derived.lists_(), args.selector as string | undefined))));
  // Only the next_page bundle calls this, through `run_command_`, and hands a callback that takes the cursor.
  host.register_handler_("item.cursor", (args) => (args.take as (cursor: ItemCursor | undefined) => void)(read_cursor(page, overlay.shown_())));
}

// While a site row's items show, they are the only list the picker offers: the row's keys walk its own selector, so another list could not be walked. The finder finds nothing on some rows (Drive's files hold no title link).
function lists_with_row(read_lists: () => Region<Element>[], selector: string | undefined): Region<Element>[] {
  const items = selector ? Array.from(document.querySelectorAll(selector)).filter(is_shown) : [];
  return items[0] ? [{ kind: "list", items, links: new Map() }] : read_lists();
}

// Making another list active puts the focus on the first item the pick showed. Picking the list that is active already leaves the focus and the last move alone, so the landing goes on from the current item.
function pick_list(derived: DerivedRow, region: Region<Element>, focus: HTMLElement | undefined): void {
  const was = derived.active_()?.items[0] === region.items[0];
  derived.pick_(region);
  if (!was) focus?.focus({ preventScroll: true });
}

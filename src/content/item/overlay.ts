// The box that `page.item` draws around the item it moved to, in a closed shadow root so the page cannot restyle it. It does not use `create_surface`: that module and the theme code it pulls in would take the bundle from about 3 KB to over 10 KB. So the box has the default colors and takes no user theme, and it sits at the top of the page's stacking order, not in the top layer. It follows scroll and resize with the follower the hint labels use, and clears itself when the user moves the focus off the item or the mode is no longer wanted. When a page script moves the focus, the box follows it to the item that takes it.

import { LAYERS } from "../../shared/layers.ts";
import { follow_windows } from "../hints/follow.ts";
import type { UserLeft } from "../user_left.ts";

// Defaults are var() fallbacks, never declarations, as in the hint labels.
const STYLE = `
.desertfox-item-box {
  position: fixed; box-sizing: border-box; pointer-events: none; border-radius: 3px;
  border: 2px solid var(--desertfox-primary, #7fa3c9); box-shadow: 0 0 0 1px var(--desertfox-bg-core, #0c0e13), 0 0 6px #0008;
}`;

// The mode changes in content.js, which a bundle cannot subscribe to, so a timer reads it while the box shows. The same tick puts the box back on an item that a layout shift moved, and follows a focus that a page script moved.
const WATCH_MS = 100;
// How many ticks (about a second) a page script may hold the focus off every item before the box clears. Google's loader takes the focus for the length of a load, then hands it to a result.
const PAGE_FOCUS_GRACE_TICKS = 10;
// The overflow scan reads at most this many elements per tick, so a huge item stays cheap.
const OVERFLOW_SCAN_LIMIT = 200;

// The item's rectangle grown over the descendants that poke out of it, as a tile whose image zooms on hover. The walk skips what a box inside the item clips (a carousel row), and that box with it.
function covered_rect(item: Element) {
  let { left, top, right, bottom } = item.getBoundingClientRect();
  // The NodeFilter values as numbers, which the bundle's size guard prefers: 1 is SHOW_ELEMENT and FILTER_ACCEPT, 2 is FILTER_REJECT.
  const walker = document.createTreeWalker(item, 1, (node) => (getComputedStyle(node as Element).overflow === "visible" ? 1 : 2));
  for (let seen = 0; seen < OVERFLOW_SCAN_LIMIT && walker.nextNode(); seen++) {
    const rect = (walker.currentNode as Element).getBoundingClientRect();
    if (!rect.width) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

// `still_wanted` answers false once the mode is one where the box does not belong. `watch_user` starts a watch for a key press, click or wheel, which marks a focus move as the user's.
export function create_item_overlay(still_wanted: () => boolean, watch_user: () => UserLeft) {
  const host = document.createElement("div");
  const box = document.createElement("div");
  box.className = "desertfox-item-box";
  const style = document.createElement("style");
  style.textContent = STYLE;
  host.style.cssText = `all: initial; position: fixed; z-index: ${LAYERS.hints};`;
  host.attachShadow({ mode: "closed" }).append(style, box);
  let item: Element | undefined;
  // The row's item selector, which the box follows the focus by. None while the box is the focus mark of `item.mark`, which is not a `page.item` box.
  let item_selector: string | undefined;
  // The user's input since the box was last drawn.
  let user: UserLeft | undefined;
  // The ticks since the focus left the item, 0 while the item holds it. Undefined while the focus has not been in the item, so a box drawn while the focus is elsewhere (a j that only scrolls) waits for it.
  let ticks_away: number | undefined;
  let stop_following: (() => void) | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;

  const reposition = () => {
    const rect = item && covered_rect(item);
    const hidden = !rect?.width || !rect.height;
    box.style.visibility = hidden ? "hidden" : "";
    if (hidden) return;
    Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };

  // Focus moving inside the item (to a link in it) keeps the box. A move the user made, by key, click or wheel, clears it. A page script's move gets the grace: the item that takes the focus gets the box, and with none the box clears once the grace runs out.
  const follow_focus = () => {
    const focused = document.activeElement;
    const holder = focused?.closest(item_selector!);
    if (item!.contains(focused)) ticks_away = 0;
    else if (ticks_away === undefined) return;
    else if (user!.left_()) clear();
    else if (holder) show(holder, item_selector);
    else if (++ticks_away > PAGE_FOCUS_GRACE_TICKS) clear();
  };

  function clear(): void {
    item = undefined;
    user?.stop_();
    stop_following?.();
    stop_following = undefined;
    clearInterval(watch);
    host.remove();
  }

  // Without a selector the box is the focus mark. A redraw on the same item keeps the count of a page script's hold on the focus.
  function show(target: Element, selector?: string): void {
    if (target !== item) ticks_away = target.contains(document.activeElement) ? 0 : undefined;
    item = target;
    item_selector = selector;
    user?.stop_();
    user = watch_user();
    reposition();
    document.documentElement.append(host);
    if (stop_following) return;
    stop_following = follow_windows([window], reposition);
    watch = setInterval(() => {
      // A focus mark clears as soon as its element loses the focus, also inside a shadow root, which sends no focusout to the window.
      if (!still_wanted() || !item?.isConnected || (!item_selector && !item.matches(":focus"))) return clear();
      follow_focus();
      reposition();
    }, WATCH_MS);
  }

  return { clear, show, shown_: () => host.isConnected && !!item_selector };
}

export type ItemOverlay = ReturnType<typeof create_item_overlay>;

// The box that `page.item` draws around the item it moved to, in a closed shadow root so the page cannot restyle it. It does not use `create_surface`: that module and the theme code it pulls in would take the bundle from about 3 KB to over 10 KB. So the box has the default colors and takes no user theme, and it sits at the top of the page's stacking order, not in the top layer. It follows scroll and resize with the follower the hint labels use, and clears itself when the user moves the focus off the item or the mode is no longer wanted. When a page script moves the focus, the box follows it to the item that takes it.

import { LAYERS } from "../../shared/layers.ts";
import { follow_windows } from "../hints/follow.ts";
import type { UserLeft } from "../user_left.ts";
import { hover_at } from "./hover.ts";

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
const { min, max } = Math;
// The overflow scan reads at most this many elements per tick, so a huge item stays cheap.
const OVERFLOW_SCAN_LIMIT = 200;
// A hover starts this long after the last land, so a held j does not start a preview on every tile it passes.
const HOVER_DELAY_MS = 300;

// Under the pointer or while it holds the focus, the item's rectangle grows over the descendants that poke out of it, as a tile whose image zooms on hover or on focus (Google Shopping zooms on both). Otherwise, and on an item that clips its own content (an image tile that crops its image), it is the item's rectangle. The walk skips what a box inside the item clips (a carousel row), and that box with it. It also skips what the eye does not see: a hidden or transparent child (a menu) and one wholly outside the viewport (screen-reader text at left:-9999px), which would stretch the box on every tick.
function covered_rect(item: Element) {
  const own = item.getBoundingClientRect();
  const clips = (element: Element) => getComputedStyle(element).overflow !== "visible";
  if (!item.matches(":hover, :focus-within") || clips(item)) return own;
  let { left, top, right, bottom } = own;
  let seen = 0;
  // The NodeFilter values as numbers, which the bundle's size guard prefers: 1 is SHOW_ELEMENT and FILTER_ACCEPT, 2 is FILTER_REJECT. Past the limit every node is rejected unread.
  const walker = document.createTreeWalker(item, 1, (node) => (++seen > OVERFLOW_SCAN_LIMIT || clips(node as Element) ? 2 : 1));
  while (walker.nextNode()) {
    const rect = (walker.currentNode as Element).getBoundingClientRect();
    const seen_by_eye = (walker.currentNode as Element).checkVisibility({ visibilityProperty: true, opacityProperty: true }) && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    if (rect.width && seen_by_eye) [left, top, right, bottom] = [min(left, rect.left), min(top, rect.top), max(right, rect.right), max(bottom, rect.bottom)];
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

// `mode` is the frame's mode. `watch_user` starts a watch for a key press, click or wheel, which marks a focus move as the user's. `on_follow` hears of each item the box follows the focus to.
export function create_item_overlay(mode: () => string, watch_user: () => UserLeft, on_follow: (item: Element) => void) {
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
  // The ticks since the focus left the item, 0 while the item holds it. NaN while the focus has not been in the item, so a box drawn while the focus is elsewhere (a j that only scrolls) never runs out its grace: NaN counts on as NaN, which passes no limit.
  let ticks_away = NaN;
  // The focus when the box was last drawn. Only a row item that took the focus since then gets the box: one that already held it (a Tab, then a j that only scrolls another item) is the user's old focus, not a page script's move.
  let focus_at_show: Element | null = null;
  let stop_following: (() => void) | undefined;
  // What the box was last asked to hover with, the timer that waits to hover the item, and the function that undoes the hover once done.
  let hovers: (() => boolean) | undefined;
  let hover_timer: ReturnType<typeof setTimeout> | undefined;
  let unhover: (() => void) | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;
  let drawn_in: string | undefined;
  // The box belongs to item mode and to normal mode, where a row of the user's binds j and k and the focus mark shows. A box drawn in item mode clears once the frame leaves it by any route, a step from another frame included, which no input in this frame shows.
  const still_wanted = () => mode() === "item" || (mode() === "normal" && drawn_in !== "item");

  const reposition = () => {
    const rect = item && covered_rect(item);
    // The class sets every other property, so the inline style holds only the place or the hiding.
    box.style.cssText = !rect?.width || !rect.height ? "visibility:hidden" : `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
  };

  // Focus moving inside the item (to a link in it) keeps the box. A move the user made, by key, click or wheel, clears it. A page script's move gets the grace: the item that takes the focus gets the box, and with none the box clears once the grace runs out.
  const follow_focus = () => {
    const focused = document.activeElement;
    let holder;
    if (item!.contains(focused)) ticks_away = 0;
    else if (user!.left_()) clear();
    else if (focused !== focus_at_show && (holder = focused?.closest(item_selector!))) {
      show(holder, item_selector);
      on_follow(holder);
    } else if (++ticks_away > PAGE_FOCUS_GRACE_TICKS) clear();
  };

  function stop_hover(): void {
    clearTimeout(hover_timer);
    unhover?.();
    unhover = undefined;
  }

  function clear(): void {
    stop_hover();
    hovers = undefined;
    item = undefined;
    user?.stop_();
    stop_following?.();
    stop_following = undefined;
    clearInterval(watch);
    host.remove();
  }

  // Without a selector the box is the focus mark, which never hovers. A redraw on the same item keeps the count of a page script's hold on the focus. `hover` answers whether the item may still be hovered when the wait ends, and a redraw that asks the same keeps its hover. An item the box follows the page's focus to gets none.
  function show(target: Element, selector?: string, hover?: () => boolean): void {
    const changed = target !== item;
    if (changed) ticks_away = target.contains(document.activeElement) ? 0 : NaN;
    // A change of the item or of the request restarts the hover: a request that turns off cancels the wait or unhovers, and one that turns on waits.
    if (changed || !hover !== !hovers) {
      stop_hover();
      if (hover) hover_timer = setTimeout(() => target.isConnected && hover() && (unhover = hover_at(target)), HOVER_DELAY_MS);
    }
    hovers = hover;
    drawn_in = mode();
    item = target;
    item_selector = selector;
    focus_at_show = document.activeElement;
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

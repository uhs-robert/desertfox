// The box that `page.item` draws around the item it moved to, in a closed shadow root so the page cannot restyle it. It does not use `create_surface`: that module and the theme code it pulls in would take the bundle from about 3 KB to over 10 KB. So the box has the default colors and takes no user theme, and it sits at the top of the page's stacking order, not in the top layer. It follows scroll and resize with the follower the hint labels use, and clears itself when focus leaves the item or the mode is no longer wanted.

import { LAYERS } from "../../shared/layers.ts";
import { follow_windows } from "../hints/follow.ts";

// Defaults are var() fallbacks, never declarations, as in the hint labels.
const STYLE = `
.desertfox-item-box {
  position: fixed; box-sizing: border-box; pointer-events: none; border-radius: 3px;
  border: 2px solid var(--desertfox-primary, #7fa3c9); box-shadow: 0 0 0 1px var(--desertfox-bg-core, #0c0e13), 0 0 6px #0008;
}`;

// The mode changes in content.js, which a bundle cannot subscribe to, so a timer reads it while the box shows. The same tick puts the box back on an item that a layout shift moved.
const WATCH_MS = 100;

// `still_wanted` answers false once the mode is one where the box does not belong.
export function create_item_overlay(still_wanted: () => boolean) {
  const host = document.createElement("div");
  const box = document.createElement("div");
  box.className = "desertfox-item-box";
  const style = document.createElement("style");
  style.textContent = STYLE;
  host.style.cssText = `all: initial; position: fixed; z-index: ${LAYERS.hints};`;
  host.attachShadow({ mode: "closed" }).append(style, box);
  let item: Element | undefined;
  // True while the box is the focus mark of `item.mark`, which is not a `page.item` box.
  let is_focus_mark = false;
  let stop_following: (() => void) | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;

  const reposition = () => {
    const rect = item?.getBoundingClientRect();
    const hidden = rect === undefined || rect.width === 0 || rect.height === 0;
    box.style.visibility = hidden ? "hidden" : "";
    if (hidden) return;
    Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };

  // Focus moving to another element of the same item (a link inside it) keeps the box.
  const on_focusout = (event: FocusEvent) => {
    if (!item?.contains(event.relatedTarget as Node | null)) clear();
  };

  function clear(): void {
    item = undefined;
    is_focus_mark = false;
    stop_following?.();
    stop_following = undefined;
    clearInterval(watch);
    window.removeEventListener("focusout", on_focusout, true);
    host.remove();
  }

  return {
    clear,
    shown_: () => host.isConnected && !is_focus_mark,
    show: (target: Element, as_focus_mark = false): void => {
      item = target;
      is_focus_mark = as_focus_mark;
      reposition();
      document.documentElement.append(host);
      if (stop_following) return;
      stop_following = follow_windows([window], reposition);
      window.addEventListener("focusout", on_focusout, true);
      watch = setInterval(() => {
        // Focus moving inside a shadow root sends no focusout to the window, so a focus mark rechecks the focus itself.
        if (!still_wanted() || !item?.isConnected || (is_focus_mark && !item.matches(":focus"))) clear();
        else reposition();
      }, WATCH_MS);
    },
  };
}

export type ItemOverlay = ReturnType<typeof create_item_overlay>;

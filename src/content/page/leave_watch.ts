// Tells the background where the top page stood when the user left it, for the jump list: as the page hides (`jump_leave`), and as a single-page app changes its address in place (`jump_push`).
// The `page` and `hints` bundles both arm it, so a page only scrolled with `j` still reports once a hint follow leaves it. The first arm in a document wins and the window holds the watch.
// The `navigate` event also feeds `listen_`, for code that must react to an address change within the document in any frame.

import type { JumpLeave, JumpPush } from "../../shared/messages.ts";
import { mark_page_url } from "../../shared/mark_names.ts";
import type { BundleHostApi } from "../bundle_host.ts";

// A change this soon after a recorded change, or after a jump or step scrolled the page, records nothing. A burst of pushes is one move. A page that changes its address as it scrolls would otherwise record the scroll the jump list made itself.
export const LEAVE_QUIET_MS = 1000;

// The Navigation API types are missing from the TypeScript DOM library.
export type NavigateEvent = { navigationType: "push" | "replace" | "reload" | "traverse"; hashChange: boolean; destination: { url: string; sameDocument: boolean } };
export type SameDocumentListener = (event: NavigateEvent) => void;

export const scroll_offset = (host: BundleHostApi) => {
  const box = host.scroll_box_();
  return { x: box.scrollLeft, y: box.scrollTop };
};

export type LeaveWatch = {
  listen_: (listener: SameDocumentListener) => void;
  // A jump or step just scrolled the page.
  quiet_now_: () => void;
};
type WatchWindow = Window & { desertfox_leave_watch?: LeaveWatch; navigation?: EventTarget };

export function arm_leave_watch(host: BundleHostApi, page = window as WatchWindow): LeaveWatch {
  if (page.desertfox_leave_watch) return page.desertfox_leave_watch;
  const is_top = page === page.top;
  const listeners = new Set<SameDocumentListener>();
  let quiet_since = -Infinity;
  const send = (message: JumpPush | JumpLeave) => void browser.runtime.sendMessage(message).catch(() => undefined);

  listeners.add((event) => {
    // `replace` and `reload` keep the user where they are.
    const is_move = event.navigationType === "push" || event.navigationType === "traverse";
    const stays_on_page = mark_page_url(event.destination.url) === mark_page_url(page.location.href);
    const is_quiet = page.performance.now() - quiet_since < LEAVE_QUIET_MS;
    if (!is_top || !is_move || stays_on_page || page.document.visibilityState !== "visible" || is_quiet) return;
    quiet_since = page.performance.now();
    // The event fires before the address changes, so `location` and the offset are still the page left, before the app scrolls for its new view.
    send({ type: "jump_push", url: page.location.href, ...scroll_offset(host) });
  });
  page.navigation?.addEventListener("navigate", (event) => {
    const navigate = event as unknown as NavigateEvent;
    if (navigate.destination.sameDocument) for (const listener of listeners) listener(navigate);
  });
  // Only the top frame's report counts.
  if (is_top) page.addEventListener("pagehide", () => send({ type: "jump_leave", url: page.location.href, ...scroll_offset(host) }));
  return (page.desertfox_leave_watch = {
    listen_: (listener) => void listeners.add(listener),
    quiet_now_: () => void (quiet_since = page.performance.now()),
  });
}

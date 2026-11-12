// Tells the background where the top page stood when the user left it, for the jump list: as the page hides (`jump_leave`), and as a single-page app changes its address in place (`jump_push`).
// The `page` and `hints` bundles both arm it, so a page only scrolled with `j` still reports once a hint follow leaves it. The first arm in a document wins and the window holds the watch.
// Each push or traverse committed within the document also feeds `listen_`, in any frame, for code that must react to it (hint mode ends on it).

import type { JumpLeave, JumpPush } from "../../shared/messages.ts";
import { mark_page_url } from "../../shared/mark_names.ts";
import type { BundleHostApi } from "../bundle_host.ts";

// A change this soon after a recorded change, or after a jump or step scrolled the page, records nothing. A burst of pushes is one move. A page that changes its address as it scrolls would otherwise record the scroll the jump list made itself.
export const LEAVE_QUIET_MS = 1000;

// The Navigation API types are missing from the TypeScript DOM library.
export type NavigateEvent = { navigationType: "push" | "replace" | "reload" | "traverse"; hashChange: boolean; destination: { url: string; sameDocument: boolean } };

export const scroll_offset = (host: BundleHostApi) => {
  const box = host.scroll_box_();
  return { x: box.scrollLeft, y: box.scrollTop };
};

export type LeaveWatch = {
  listen_: (listener: () => void) => void;
  // Quiet: a jump or step just scrolled the page, so the address change it sets off is no move. Not quiet: the user acts now (a hint pick), so the change it makes is one.
  quiet_: (is_quiet: boolean) => void;
};
type WatchWindow = Window & { desertfox_leave_watch?: LeaveWatch; navigation?: EventTarget & { currentEntry?: { url: string } } };

export function arm_leave_watch(host: BundleHostApi, page = window as WatchWindow): LeaveWatch {
  const armed = page.desertfox_leave_watch;
  if (armed) return armed;
  const is_top = page === page.top;
  const listeners: (() => void)[] = [];
  let quiet_since = -Infinity;
  const now = () => page.performance.now();
  const navigation = page.navigation;
  const place_here = () => ({ url: page.location.href, ...scroll_offset(host) });
  // The place the latest `navigate` leaves, when it would be a move. Only a commit in this document (`currententrychange`) records it: a cancelled change never commits, and one that loads another document leaves it to `pagehide`.
  let pending: false | ReturnType<typeof place_here> = false;
  const send = (message: JumpPush | JumpLeave) => void browser.runtime.sendMessage(message);

  navigation?.addEventListener("navigate", (event) => {
    const navigate = event as unknown as NavigateEvent;
    // `replace` and `reload` keep the user where they are.
    const is_move = /^(push|traverse)$/.test(navigate.navigationType);
    const stays_on_page = mark_page_url(navigate.destination.url) === mark_page_url(page.location.href);
    // The event fires before the address changes and before the app scrolls for its new view, so `location` and the offset are still the page left.
    pending = is_top && is_move && !stays_on_page && place_here();
  });
  // An app that intercepts a link (`event.intercept()`) commits here too, though its `navigate` named another document.
  // A change with no navigation (`updateCurrentEntry()`) has no `navigationType`, and must not commit a read a navigation that never loaded left held.
  navigation?.addEventListener("currententrychange", (event) => {
    const type = (event as unknown as { navigationType: string | null }).navigationType;
    const left = type && pending;
    pending = false;
    const is_quiet = now() - quiet_since < LEAVE_QUIET_MS;
    if (left && !page.document.hidden && !is_quiet) {
      quiet_since = now();
      send({ type: "jump_push", ...left });
    }
    // The listeners run after the record, so one that throws cannot skip it. `replace` keeps the view the user is on.
    if (/^(push|traverse)$/.test(type!)) for (const listener of listeners) listener();
  });
  // Only the top frame's report counts.
  if (is_top) page.addEventListener("pagehide", () => send({ type: "jump_leave", ...place_here() }));
  return (page.desertfox_leave_watch = {
    listen_: (listener) => void listeners.push(listener),
    quiet_: (is_quiet) => void (quiet_since = is_quiet ? now() : -Infinity),
  });
}

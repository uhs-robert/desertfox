// Tells the background where the top page stood when the user left it, for the jump list: as the page hides (`jump_leave`), and as a single-page app changes its address in place (`jump_push`).
// The `page` and `hints` bundles both arm it, so a page only scrolled with `j` still reports once a hint follow leaves it. The first arm in a document wins and the window holds the watch.
// Each address change committed within the document also feeds `listen_`, in any frame, for code that must react to it.

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
  // Quiet: a jump or step just scrolled the page, so the address change it sets off is no move. Not quiet: the user acts now (a hint pick), so the change it makes is one.
  quiet_: (is_quiet: boolean) => void;
};
type WatchWindow = Window & { desertfox_leave_watch?: LeaveWatch; navigation?: EventTarget & { currentEntry?: { url: string } } };

export function arm_leave_watch(host: BundleHostApi, page = window as WatchWindow): LeaveWatch {
  if (page.desertfox_leave_watch) return page.desertfox_leave_watch;
  const is_top = page === page.top;
  const listeners = new Set<SameDocumentListener>();
  let quiet_since = -Infinity;
  const now = () => page.performance.now();
  const navigation = page.navigation;
  // The latest `navigate` and, when it would be a move, the place it leaves. Only a commit in this document (`currententrychange`) acts on it: a cancelled change never commits, and one that loads another document leaves it to `pagehide`.
  let pending: { event: NavigateEvent; left?: JumpPush } | undefined;
  const send = (message: JumpPush | JumpLeave) => void browser.runtime.sendMessage(message).catch(() => undefined);

  navigation?.addEventListener("navigate", (event) => {
    const navigate = event as unknown as NavigateEvent;
    // `replace` and `reload` keep the user where they are.
    const is_move = navigate.navigationType === "push" || navigate.navigationType === "traverse";
    const stays_on_page = mark_page_url(navigate.destination.url) === mark_page_url(page.location.href);
    // The event fires before the address changes and before the app scrolls for its new view, so `location` and the offset are still the page left.
    pending = { event: navigate, ...(is_top && is_move && !stays_on_page && { left: { type: "jump_push", url: page.location.href, ...scroll_offset(host) } }) };
  });
  // An app that intercepts a link (`event.intercept()`) commits here too, though its `navigate` named another document.
  navigation?.addEventListener("currententrychange", () => {
    const committed = pending;
    pending = undefined;
    if (!committed) return;
    for (const listener of listeners) listener(committed.event);
    const is_quiet = now() - quiet_since < LEAVE_QUIET_MS;
    if (!committed.left || page.document.hidden || is_quiet) return;
    quiet_since = now();
    send(committed.left);
  });
  // Only the top frame's report counts.
  if (is_top) page.addEventListener("pagehide", () => send({ type: "jump_leave", url: page.location.href, ...scroll_offset(host) }));
  return (page.desertfox_leave_watch = {
    listen_: (listener) => void listeners.add(listener),
    quiet_: (is_quiet) => void (quiet_since = is_quiet ? now() : -Infinity),
  });
}

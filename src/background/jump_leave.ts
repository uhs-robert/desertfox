// Records the place a page leaves when its tab goes to another page, whatever started the navigation: a click, a typed address, a script.
// Only the page knows its offset, and it is gone once the page hides. So the leave watch of the `page` or `hints` bundle reports the offset as the page hides, and this holds it until the tab shows where it went.
// Each event (the report, an address change, the end of a load) judges the held offset against the tab as it is now, never against an earlier event, so the order the events arrive in does not matter:
// - the tab shows another page: the user left, so the offset is recorded, unless a jump step took the tab away from that page;
// - the tab finished loading the same page: a reload, which records nothing;
// - the tab is still loading the same page: wait. A hash change keeps the page, so it never ends the wait.
// The Navigation API's `navigate` event cannot judge this from the page: Firefox fires it only for navigations the page starts, not for a typed address, a reload key or the `tabs.update` of a jump step.

import { place_in_tab, url_origin } from "../shared/jump_names.ts";
import { mark_page_url } from "../shared/mark_names.ts";
import type { JumpLeave } from "../shared/messages.ts";
import type { JumpStore, Leaving, LeavingVerdict } from "./jump_store.ts";
import type { MarkSender } from "./mark_store.ts";

// The tab's address and load status now. Undefined once the tab is gone: a page's report can arrive after its tab closed.
export type TabNow = { url: string | undefined; status: string | undefined };

export type JumpLeaveDeps = {
  store: JumpStore;
  tab_now: (tab_id: number) => Promise<TabNow | undefined>;
};

export type TabChange = { tab_id: number; incognito: boolean; url: string | undefined; status: string | undefined };

const verdict_at =
  (now: TabNow | undefined) =>
  (leaving: Leaving, step_from: string | undefined): LeavingVerdict => {
    if (!now) return "drop";
    if (now.url === undefined || mark_page_url(now.url) === leaving.entry.url) return now.status === "complete" ? "drop" : "wait";
    return step_from === leaving.entry.url ? "drop" : "record";
  };

export function create_jump_leave(deps: JumpLeaveDeps) {
  const settle = (tab_id: number, is_private: boolean, now: TabNow | undefined): Promise<void> => deps.store.settle_leaving(tab_id, is_private, verdict_at(now));

  return {
    forget: async (tab_id: number): Promise<void> => void (await Promise.all([false, true].map((is_private) => deps.store.forget_tab(tab_id, is_private)))),
    // The page says where it was as it hides. The tab is read after the hold, so an address change that came before the hold shows in the read, and one after it finds the hold.
    // The page names its address, because `document_url` (the sender's) stays the one the document loaded at after a `pushState`, and a step mark names the address shown.
    leave: async (request: JumpLeave, sender: MarkSender | undefined, document_url: string): Promise<void> => {
      if (sender?.frame_id !== 0 || sender.id === undefined || sender.window_id === undefined) return;
      const entry = place_in_tab(request, document_url, url_origin);
      if (!entry) return;
      const is_private = sender.incognito === true;
      await deps.store.hold_leaving(sender.id, is_private, { window_id: sender.window_id, entry });
      await settle(sender.id, is_private, await deps.tab_now(sender.id));
    },
    // The tab's address changed, or a load ended.
    updated: async (tab: TabChange, change: { url?: string | undefined; status?: string | undefined }): Promise<void> => {
      if (change.url !== undefined || change.status === "complete") await settle(tab.tab_id, tab.incognito, { url: tab.url, status: tab.status });
    },
  };
}

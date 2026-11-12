// Records the place a page leaves when its tab goes to another address, whatever started the navigation: a click, a typed address, a script.
// Only the page knows its offset, and it is gone when the address changes. So the `page` bundle reports the offset as the page hides, and this holds it until the tab's address changes.
// Held offsets are dropped when the page loads again at the same address (a reload), so a redirect or a reload records nothing. A redirect chain records once, for the page the user left.

import { mark_page_url } from "../shared/mark_names.ts";
import type { JumpLeave } from "../shared/messages.ts";
import type { JumpStore } from "./jump_store.ts";
import type { MarkSender } from "./mark_store.ts";

export type JumpLeaveDeps = {
  store: JumpStore;
  // True while a jump step is taking the tab to another address: that move is not a new place.
  is_stepping: (tab_id: number) => boolean;
};

export type TabChange = { tab_id: number; window_id: number; incognito: boolean; url: string | undefined };

export function create_jump_leave(deps: JumpLeaveDeps) {
  async function record(tab_id: number, is_private: boolean, new_url: string): Promise<void> {
    const leaving = await deps.store.take_leaving(tab_id, is_private);
    if (!leaving || mark_page_url(new_url) === leaving.entry.url || deps.is_stepping(tab_id)) return;
    await deps.store.push(leaving.window_id, is_private, leaving.entry);
  }

  return {
    // A closed tab leaves nothing to record.
    forget: async (tab_id: number): Promise<void> => void (await Promise.all([false, true].map((is_private) => deps.store.take_leaving(tab_id, is_private)))),
    // The page says where it was as it hides. A tab that already shows another address records at once, because the address change came first.
    leave: async (request: JumpLeave, sender: MarkSender | undefined, document_url: string): Promise<void> => {
      if (sender?.frame_id !== 0 || sender.id === undefined || sender.window_id === undefined || sender.url === undefined) return;
      const is_private = sender.incognito === true;
      const entry = { url: mark_page_url(document_url), x: request.x, y: request.y };
      await deps.store.hold_leaving(sender.id, is_private, { window_id: sender.window_id, entry });
      if (mark_page_url(sender.url) !== entry.url) await record(sender.id, is_private, sender.url);
    },
    // The tab's address changed, or its page finished loading.
    updated: async (tab: TabChange, change: { url?: string | undefined; status?: string | undefined }): Promise<void> => {
      if (change.url !== undefined) return record(tab.tab_id, tab.incognito, change.url);
      // Done loading at the same address, so the page was reloaded and nothing was left.
      if (change.status === "complete") await deps.store.take_leaving(tab.tab_id, tab.incognito);
    },
  };
}

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
  // False once the tab is gone. A page's report can arrive after its tab closed, and nothing would take the held offset then.
  is_open: (tab_id: number) => Promise<boolean>;
};

export type TabChange = { tab_id: number; window_id: number; incognito: boolean; url: string | undefined };

export function create_jump_leave(deps: JumpLeaveDeps) {
  // False when the tab holds nothing.
  async function record(tab_id: number, is_private: boolean, new_url: string): Promise<boolean> {
    const leaving = await deps.store.take_leaving(tab_id, is_private);
    if (!leaving) return false;
    if (mark_page_url(new_url) !== leaving.entry.url && !deps.is_stepping(tab_id)) await deps.store.push(leaving.window_id, is_private, leaving.entry);
    return true;
  }

  return {
    // A closed tab leaves nothing to record.
    forget: async (tab_id: number): Promise<void> => void (await Promise.all([false, true].flatMap((is_private) => [deps.store.take_leaving(tab_id, is_private), deps.store.take_moved(tab_id, is_private)]))),
    // The page says where it was as it hides. A tab that already shows another address records at once, because the address change came first.
    leave: async (request: JumpLeave, sender: MarkSender | undefined, document_url: string): Promise<void> => {
      if (sender?.frame_id !== 0 || sender.id === undefined || sender.window_id === undefined || sender.url === undefined) return;
      const is_private = sender.incognito === true;
      const entry = { url: mark_page_url(document_url), x: request.x, y: request.y };
      await deps.store.hold_leaving(sender.id, is_private, { window_id: sender.window_id, entry });
      if (!(await deps.is_open(sender.id))) return void (await deps.store.take_leaving(sender.id, is_private));
      // The report may come first, with the tab still on the old address, or last. The address change may have come before it: then it noted where the tab went.
      const moved = await deps.store.take_moved(sender.id, is_private);
      const new_url = mark_page_url(sender.url) !== entry.url ? sender.url : moved;
      if (new_url !== undefined) await record(sender.id, is_private, new_url);
    },
    // The tab's address changed, or its page finished loading.
    updated: async (tab: TabChange, change: { url?: string | undefined; status?: string | undefined }): Promise<void> => {
      if (change.url !== undefined) {
        // With nothing held yet the page's report is still on its way: note the address for it.
        if (!(await record(tab.tab_id, tab.incognito, change.url))) await deps.store.note_moved(tab.tab_id, tab.incognito, change.url);
        return;
      }
      // Done loading at the same address, so the page was reloaded and nothing was left. The address change that came with it needs no note either.
      if (change.status === "complete") {
        await deps.store.take_leaving(tab.tab_id, tab.incognito);
        await deps.store.take_moved(tab.tab_id, tab.incognito);
      }
    },
  };
}

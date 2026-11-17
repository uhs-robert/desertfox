// The address a frame shows now. `sender.url` stays the address the document loaded at, so a page that changes its address in place (pushState, replaceState, history.back into an earlier entry, a hash change) reports the new one here, and every handler that matches site rows reads it back through `located`.
// It lives in `storage.session`, so a restarted background still knows and a browser restart clears it.

import { PAGE_ADDRESS_STORAGE_PREFIX } from "./storage_keys.ts";

type SessionStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

// `loaded` is the `sender.url` of the document that reported. A report outlives its document only if the frame forgets are missed, and a document that loaded at another address then never reads it.
type FrameAddress = { loaded: string; url: string };

type Sender = { url?: string | undefined; frameId?: number | undefined; tab?: { id?: number | undefined } | undefined };

const key_of = (tab_id: number, frame_id: number): string => `${PAGE_ADDRESS_STORAGE_PREFIX}${tab_id}_${frame_id}`;

export function create_page_addresses(storage: SessionStorage) {
  return {
    report: (tab_id: number, frame_id: number, loaded: string | undefined, url: string): Promise<void> => (loaded === undefined ? Promise.resolve() : storage.set({ [key_of(tab_id, frame_id)]: { loaded, url } satisfies FrameAddress })),
    // A new document in the frame: its own load address is right again.
    forget_frame: (tab_id: number, frame_id: number): Promise<void> => storage.remove(key_of(tab_id, frame_id)),
    forget_tab: async (tab_id: number): Promise<void> => {
      const prefix = `${PAGE_ADDRESS_STORAGE_PREFIX}${tab_id}_`;
      await storage.remove(Object.keys(await storage.get(null)).filter((key) => key.startsWith(prefix)));
    },
    // The sender with `url` replaced by the frame's current address, when the frame reported one for the document that asks.
    located: async <S extends Sender>(sender: S): Promise<S> => {
      if (sender.tab?.id === undefined || sender.frameId === undefined) return sender;
      const key = key_of(sender.tab.id, sender.frameId);
      const stored = (await storage.get(key))[key] as FrameAddress | undefined;
      return stored && stored.loaded === sender.url ? { ...sender, url: stored.url } : sender;
    },
  };
}

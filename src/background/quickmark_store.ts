// The quickmarks added with `M`. The config table is the base and this store lays its entries on top, as the saved settings do over the settings file.
// A normal window keeps its entries in `storage.local`. A private window keeps its own in `storage.session`, apart from the normal ones, and loses them with its last window.
// A private window still reads the normal entries: they are addresses the user filed outside it, and the private ones win over them.

import { RuntimeRefusal } from "../shared/command.ts";
import { MAX_QUICKMARK_URL_CHARS, QUICKMARK_KEY } from "../shared/quickmark_names.ts";
import type { QuickmarkTable } from "../shared/quickmark_names.ts";
import { create_write_queue } from "./store_turns.ts";
import { QUICKMARK_PRIVATE_STORAGE_KEY, QUICKMARK_STORAGE_KEY } from "./storage_keys.ts";

export type QuickmarkArea = Pick<typeof browser.storage.local, "get" | "set" | "remove">;

export type QuickmarkStoreDeps = {
  local: () => QuickmarkArea;
  session: () => QuickmarkArea;
};

// A damaged value, or a damaged entry in it, reads as no quickmark.
const valid_entries = (stored: unknown): QuickmarkTable => {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  return Object.fromEntries(Object.entries(stored).filter(([key, url]) => QUICKMARK_KEY.test(key) && typeof url === "string" && url !== ""));
};

export function create_quickmark_store(deps: QuickmarkStoreDeps) {
  const read = async (area: QuickmarkArea, key: string): Promise<QuickmarkTable> => valid_entries((await area.get(key))[key]);

  const in_turn = create_write_queue();

  return {
    // The quickmarks a window opens: the config table, then the saved ones, then (in a private window) the private ones.
    table: async (configured: QuickmarkTable, is_private: boolean): Promise<QuickmarkTable> => ({
      ...configured,
      ...(await read(deps.local(), QUICKMARK_STORAGE_KEY)),
      ...(is_private ? await read(deps.session(), QUICKMARK_PRIVATE_STORAGE_KEY) : {}),
    }),
    // Saving the same key again replaces it.
    add: (key: string, url: string, is_private: boolean) =>
      in_turn(async () => {
        if (!QUICKMARK_KEY.test(key)) throw new RuntimeRefusal("Quickmarks use a to z, A to Z and 0 to 9");
        if (url.length > MAX_QUICKMARK_URL_CHARS) throw new RuntimeRefusal("URL too long for a quickmark");
        const area = is_private ? deps.session() : deps.local();
        const storage_key = is_private ? QUICKMARK_PRIVATE_STORAGE_KEY : QUICKMARK_STORAGE_KEY;
        await area.set({ [storage_key]: { ...(await read(area, storage_key)), [key]: url } });
      }),
    // Drops every private quickmark unless a private window is open. The window check runs in the queue, so a write from a window that just opened is never deleted.
    clear_private_without_window: (has_private_window: () => Promise<boolean>) =>
      in_turn(async () => {
        if (await has_private_window()) return;
        await deps.session().remove(QUICKMARK_PRIVATE_STORAGE_KEY);
      }),
  };
}

export type QuickmarkStore = ReturnType<typeof create_quickmark_store>;

// Calls the browser at use, so the command modules load in Node.
export const browser_quickmark_store = create_quickmark_store({ local: () => browser.storage.local, session: () => browser.storage.session });

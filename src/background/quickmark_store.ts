// The quickmarks added with `M`. The config table is the base and this store lays its entries on top, as the saved settings do over the settings file.
// A normal window keeps its entries in `storage.local`. A private window keeps its own in `storage.session`, apart from the normal ones, and loses them with its last window.
// A private window still reads the normal entries: they are addresses the user filed outside it, and the private ones win over them.

import { RuntimeRefusal } from "../shared/command.ts";
import { MAX_QUICKMARK_URL_CHARS, QUICKMARK_KEY, valid_quickmark_entries } from "../shared/quickmark_names.ts";
import type { QuickmarkTable } from "../shared/quickmark_names.ts";
import { create_write_queue } from "./store_turns.ts";
import { QUICKMARK_PRIVATE_STORAGE_KEY, QUICKMARK_STORAGE_KEY } from "./storage_keys.ts";

export type QuickmarkArea = Pick<typeof browser.storage.local, "get" | "set" | "remove">;

export type QuickmarkStoreDeps = {
  local: () => QuickmarkArea;
  session: () => QuickmarkArea;
};

export function create_quickmark_store(deps: QuickmarkStoreDeps) {
  // A damaged value, or a damaged entry in it, reads as no quickmark.
  const read = async (area: QuickmarkArea, key: string): Promise<QuickmarkTable> => valid_quickmark_entries((await area.get(key))[key]);

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
    // The entries a window may delete: the saved ones of its own layer. A private window never touches the normal layer.
    saved: (is_private: boolean): Promise<QuickmarkTable> => (is_private ? read(deps.session(), QUICKMARK_PRIVATE_STORAGE_KEY) : read(deps.local(), QUICKMARK_STORAGE_KEY)),
    // Drops the saved entry of a key from the window's own layer. An entry of quickmarks.toml stays until the file changes.
    remove: (key: string, is_private: boolean) =>
      in_turn(async () => {
        const area = is_private ? deps.session() : deps.local();
        const storage_key = is_private ? QUICKMARK_PRIVATE_STORAGE_KEY : QUICKMARK_STORAGE_KEY;
        const { [key]: gone, ...kept } = await read(area, storage_key);
        if (gone === undefined) {
          const in_normal_window = is_private && (await read(deps.local(), QUICKMARK_STORAGE_KEY))[key] !== undefined;
          throw new RuntimeRefusal(in_normal_window ? `Quickmark ${key} is saved in a normal window, delete it there` : `Quickmark ${key} is not saved, its key comes from quickmarks.toml and must be removed there`);
        }
        await area.set({ [storage_key]: kept });
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

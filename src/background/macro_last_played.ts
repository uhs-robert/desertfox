// The register `@@` plays: the last one a play named, in `storage.session`. A normal window and the private windows each have one, apart, so a private play never shows in a normal window.

import { MACRO_LAST_PLAYED_PRIVATE_STORAGE_KEY, MACRO_LAST_PLAYED_STORAGE_KEY } from "./storage_keys.ts";
import { create_write_queue } from "./store_turns.ts";

type SessionArea = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export type LastPlayedDeps = { session: () => SessionArea };

const key_of = (is_private: boolean) => (is_private ? MACRO_LAST_PLAYED_PRIVATE_STORAGE_KEY : MACRO_LAST_PLAYED_STORAGE_KEY);

export function create_last_played(deps: LastPlayedDeps) {
  const in_turn = create_write_queue();

  const read = async (is_private: boolean): Promise<string | undefined> => {
    const stored = (await deps.session().get(key_of(is_private)))[key_of(is_private)];
    return typeof stored === "string" ? stored : undefined;
  };

  return {
    read,
    write: (register: string, is_private: boolean) => in_turn(() => deps.session().set({ [key_of(is_private)]: register })),
    // Drops the private pointer once no private window is left.
    clear_private_without_window: (has_private_window: () => Promise<boolean>) =>
      in_turn(async () => {
        if (!(await has_private_window())) await deps.session().remove(key_of(true));
      }),
  };
}

export type LastPlayed = ReturnType<typeof create_last_played>;

// Calls the browser at use, so the command modules load in Node for the commands.json build.
export const browser_last_played = create_last_played({ session: () => browser.storage.session });

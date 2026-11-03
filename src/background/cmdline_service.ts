// What the command line page asks of the background: the history to walk and the lists that bare words read from.

import type { CmdlineOpened } from "../shared/messages.ts";
import { CMDLINE_HISTORY_STORAGE_KEY } from "./storage_keys.ts";

export const HISTORY_LIMIT = 100;

type HistoryStorage = Pick<typeof browser.storage.local, "get" | "set">;

export type CmdlineServiceDeps = {
  storage: HistoryStorage;
  sources: () => Promise<CmdlineOpened["sources"]>;
};

// A repeated command moves to the newest place instead of filling the cap with copies.
export function add_to_history(history: readonly string[], text: string): string[] {
  return [...history.filter((entry) => entry !== text), text].slice(-HISTORY_LIMIT);
}

export function create_cmdline_service(deps: CmdlineServiceDeps) {
  const read = async (): Promise<string[]> => {
    const stored = await deps.storage.get(CMDLINE_HISTORY_STORAGE_KEY);
    const history: unknown = stored[CMDLINE_HISTORY_STORAGE_KEY];
    return Array.isArray(history) ? history.filter((entry): entry is string => typeof entry === "string") : [];
  };
  // Two records in a row would both read the old list, so each waits for the one before.
  let last_write: Promise<unknown> = Promise.resolve();

  return {
    open: async (): Promise<CmdlineOpened> => ({ history: await read(), sources: await deps.sources() }),
    record: (text: string, from_private_window: boolean): Promise<void> => {
      if (from_private_window || text.trim() === "") return Promise.resolve();
      const written = last_write.then(async () => deps.storage.set({ [CMDLINE_HISTORY_STORAGE_KEY]: add_to_history(await read(), text) }));
      last_write = written.catch(() => undefined);
      return written;
    },
  };
}

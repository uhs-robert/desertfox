// What the command line page asks of the background: the history to walk, the commands and the lists that bare words read from.

import type { CmdlineOpened } from "../shared/messages.ts";
import { CMDLINE_HISTORY_STORAGE_KEY, CMDLINE_TICKET_STORAGE_PREFIX } from "./storage_keys.ts";

export const HISTORY_LIMIT = 100;

type HistoryStorage = Pick<typeof browser.storage.local, "get" | "set">;
type TicketStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export type CmdlineServiceDeps = {
  storage: HistoryStorage;
  tickets: TicketStorage;
  new_ticket: () => string;
  sources: () => Promise<CmdlineOpened["sources"]>;
  // Read on every open, after the config has loaded.
  page_config: () => Promise<Pick<CmdlineOpened, "commands" | "command_aliases" | "css">>;
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
  // Two redemptions of one ticket at once would both read it before either removed it, so each waits for the one before.
  let last_redeem: Promise<unknown> = Promise.resolve();
  const redeem = async (ticket: string): Promise<unknown> => {
    const key = CMDLINE_TICKET_STORAGE_PREFIX + ticket;
    const issued_for: unknown = (await deps.tickets.get(key))[key];
    await deps.tickets.remove(key);
    return issued_for;
  };

  return {
    // The host asks before it mounts the line and hands the ticket to its own frame only.
    issue_ticket: async (tab_id: number | undefined): Promise<string | undefined> => {
      if (tab_id === undefined) return undefined;
      const ticket = deps.new_ticket();
      await deps.tickets.set({ [CMDLINE_TICKET_STORAGE_PREFIX + ticket]: tab_id });
      return ticket;
    },
    // Used up on the first try, so a frame reloaded with an old ticket gets nothing either.
    open: async (ticket: unknown, tab_id: number | undefined): Promise<CmdlineOpened | undefined> => {
      if (typeof ticket !== "string" || tab_id === undefined) return undefined;
      const redeemed = last_redeem.then(() => redeem(ticket));
      last_redeem = redeemed.catch(() => undefined);
      if ((await redeemed) !== tab_id) return undefined;
      // After the pending writes, so a line reopened at once already has the last command.
      await last_write;
      return { history: await read(), sources: await deps.sources(), ...(await deps.page_config()) };
    },
    record: (text: string, from_private_window: boolean): Promise<void> => {
      if (from_private_window || text.trim() === "") return Promise.resolve();
      const written = last_write.then(async () => deps.storage.set({ [CMDLINE_HISTORY_STORAGE_KEY]: add_to_history(await read(), text) }));
      last_write = written.catch(() => undefined);
      return written;
    },
  };
}

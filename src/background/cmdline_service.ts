// What the command line page asks of the background: the history to walk, the commands and the lists that bare words read from.

import type { CmdlineOpened } from "../shared/messages.ts";
import { CMDLINE_HISTORY_STORAGE_KEY, CMDLINE_LATEST_TICKET_STORAGE_PREFIX, CMDLINE_OPENER_STORAGE_PREFIX, CMDLINE_TICKET_STORAGE_PREFIX } from "./storage_keys.ts";

export const HISTORY_LIMIT = 100;

type HistoryStorage = Pick<typeof browser.storage.local, "get" | "set" | "remove">;
type TicketStorage = Pick<typeof browser.storage.session, "get" | "set" | "remove">;

export type CmdlineServiceDeps = {
  storage: HistoryStorage;
  tickets: TicketStorage;
  new_ticket: () => string;
  sources: () => Promise<CmdlineOpened["sources"]>;
  // What a tab list can reopen tabs in. Not asked of a private line.
  container_stores: () => Promise<CmdlineOpened["container_stores"]>;
  // Read on every open, after the config has loaded.
  page_config: () => Promise<Pick<CmdlineOpened, "commands" | "help_ids" | "command_aliases" | "prompt" | "all_windows" | "statusbar_widgets">>;
  tab_count: (window_id: number) => Promise<number>;
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
  // Two redemptions of one ticket at once would both read it before either removed it, so each waits for the one
  // before. Per ticket, so a site that floods guessed tickets does not hold up the real one.
  const redemptions = new Map<string, Promise<unknown>>();
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
      await deps.tickets.set({ [CMDLINE_TICKET_STORAGE_PREFIX + ticket]: tab_id, [CMDLINE_LATEST_TICKET_STORAGE_PREFIX + tab_id]: ticket });
      return ticket;
    },
    // Used up on the first try, so a frame reloaded with an old ticket gets nothing either.
    open: async (ticket: unknown, tab_id: number | undefined, frame_id: number | undefined, window_id: number | undefined, tab: { url?: string | undefined; index?: number | undefined } = {}, incognito = false): Promise<CmdlineOpened | undefined> => {
      if (typeof ticket !== "string" || tab_id === undefined || frame_id === undefined || window_id === undefined) return undefined;
      const redeemed = (redemptions.get(ticket) ?? Promise.resolve()).then(() => redeem(ticket));
      const settled = redeemed.catch(() => undefined);
      redemptions.set(ticket, settled);
      void settled.then(() => redemptions.get(ticket) === settled && redemptions.delete(ticket));
      if ((await redeemed) !== tab_id) return undefined;
      // A line that closed while its redemption was slow must not take the mark from the line that replaced it.
      const latest_key = CMDLINE_LATEST_TICKET_STORAGE_PREFIX + tab_id;
      if ((await deps.tickets.get(latest_key))[latest_key] !== ticket) return undefined;
      // The frame, not just the tab: any frame of the page can embed another `cmdline.html`, and that copy redeemed nothing.
      // Each line mounts a new frame and Firefox never reuses a frame id inside a tab, so the next line replaces the mark and a closed line's mark matches no live frame.
      await deps.tickets.set({ [CMDLINE_OPENER_STORAGE_PREFIX + tab_id]: frame_id });
      // After the pending writes, so a line reopened at once already has the last command.
      await last_write;
      const status = { url: tab.url ?? "", tab_index: tab.index ?? 0, tab_count: await deps.tab_count(window_id) };
      return { history: await read(), sources: await deps.sources(), container_stores: incognito ? [] : await deps.container_stores(), window_id, status, ...(await deps.page_config()) };
    },
    // Whether this frame of the tab redeemed the tab's latest ticket, and the tab has not closed or navigated since.
    is_opener: async (tab_id: number | undefined, frame_id: number | undefined): Promise<boolean> => {
      if (tab_id === undefined || frame_id === undefined) return false;
      const key = CMDLINE_OPENER_STORAGE_PREFIX + tab_id;
      return (await deps.tickets.get(key))[key] === frame_id;
    },
    forget_opener: (tab_id: number): Promise<void> => deps.tickets.remove([CMDLINE_OPENER_STORAGE_PREFIX + tab_id, CMDLINE_LATEST_TICKET_STORAGE_PREFIX + tab_id]),
    // A new page in the tab is not the page that opened the line, and its own embedded copy of the line page must get nothing.
    forget_opener_on_navigation: async (tab_id: number, change: { status?: string | undefined }): Promise<void> => {
      if (change.status === "loading") await deps.tickets.remove(CMDLINE_OPENER_STORAGE_PREFIX + tab_id);
    },
    // For a browser-wide history clear: the typed lines hold page addresses. Waits for the writes before it, so a late record cannot bring the old list back.
    clear_history: (): Promise<void> => {
      const cleared = last_write.then(() => deps.storage.remove(CMDLINE_HISTORY_STORAGE_KEY));
      last_write = cleared.catch(() => undefined);
      return cleared;
    },
    record: (text: string, from_private_window: boolean): Promise<void> => {
      if (from_private_window || text.trim() === "") return Promise.resolve();
      const written = last_write.then(async () => deps.storage.set({ [CMDLINE_HISTORY_STORAGE_KEY]: add_to_history(await read(), text) }));
      last_write = written.catch(() => undefined);
      return written;
    },
  };
}

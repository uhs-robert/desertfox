// The command line on a locked page: DesertFox's own `cmdline.html` in a panel the browser module opens over the tab (see docs/design/browser_module.md, "The command line panel").
// The panel's page has no tab of its own, so the background records the panel before it asks the module, and every message of that page reads the tab from the record.

import type { ModuleArgs } from "../shared/browser_module_protocol.ts";
import { CMDLINE_PANEL_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import type { CmdlineOpened, PanelCmdlineOpened } from "../shared/messages/content.ts";
import { keep_chain } from "../shared/swallow.ts";
import type { CallResult } from "./browser_module_call.ts";
import type { Asker } from "./complete_items.ts";

// The panel is no frame of the tab. The line it opens marks this id as the tab's opener, so the opener checks of the in-page line admit the panel's page and no frame of the tab.
export const PANEL_FRAME_ID = -1;

// `opened` is set once the page took its data, so a second page at the same address gets nothing.
type PanelRecord = { tab_id: number; window_id: number; incognito: boolean; mode: string; text: string; opened: boolean };

export type PanelTab = { tab_id: number; window_id: number; incognito: boolean; url?: string | undefined; index?: number | undefined };

export type PanelSender = { id?: string | undefined; url?: string | undefined; frameId?: number | undefined; tab?: { id?: number | undefined; windowId?: number | undefined; incognito?: boolean | undefined } | undefined };

export type CmdlinePanelDeps = {
  session: Pick<typeof browser.storage.session, "get" | "set" | "remove">;
  extension_id: string;
  // The address of `cmdline.html`, which the module loads as it is.
  page_url: string;
  get_tab: (tab_id: number) => Promise<PanelTab | undefined>;
  call: (kind: string, args: ModuleArgs) => Promise<CallResult>;
  // The command line service's data for a line of this tab, after a ticket it issues and redeems itself.
  open_line: (tab: PanelTab, frame_id: number, mode: string) => Promise<CmdlineOpened | undefined>;
};

const is_record = (value: unknown): value is PanelRecord => {
  const record = value as Partial<PanelRecord> | null | undefined;
  return typeof record === "object" && record !== null && Number.isInteger(record.tab_id) && Number.isInteger(record.window_id) && typeof record.incognito === "boolean" && typeof record.mode === "string" && typeof record.text === "string" && typeof record.opened === "boolean";
};

// A frame of a tab, by its sender.
export const frame_asker_of = (sender: PanelSender): Asker | undefined => {
  const { id, windowId, incognito } = sender.tab ?? {};
  return id === undefined || windowId === undefined || sender.frameId === undefined ? undefined : { tab_id: id, frame_id: sender.frameId, window_id: windowId, incognito: incognito === true };
};

export function create_cmdline_panel(deps: CmdlinePanelDeps) {
  const read = async (): Promise<PanelRecord | undefined> => {
    const value: unknown = (await deps.session.get(CMDLINE_PANEL_STORAGE_KEY))[CMDLINE_PANEL_STORAGE_KEY];
    return is_record(value) ? value : undefined;
  };
  const write = (record: PanelRecord) => deps.session.set({ [CMDLINE_PANEL_STORAGE_KEY]: record });

  // The panel page alone: DesertFox's own top-level `cmdline.html` with no tab. A web page can frame the page or open it in a tab, and then it has one. The toolbar popup is another address.
  // Two pages at once would both read the record before either marked it, so each waits for the one before.
  let last_claim: Promise<unknown> = Promise.resolve();
  const claim = (): Promise<PanelRecord | undefined> => {
    const claimed = last_claim.then(async () => {
      const record = await read();
      if (!record || record.opened) return undefined;
      await write({ ...record, opened: true });
      return record;
    });
    last_claim = keep_chain(claimed);
    return claimed;
  };

  const is_panel_page = (sender: PanelSender): boolean => sender.id === deps.extension_id && sender.tab === undefined && sender.url === deps.page_url && (sender.frameId ?? 0) === 0;

  return {
    // Records the panel, then asks the module. False when the module refused or did not answer, so the caller falls back to the address bar.
    open: async (tab_id: number, text: string, mode = "normal"): Promise<boolean> => {
      const tab = await deps.get_tab(tab_id);
      if (!tab) return false;
      await write({ tab_id, window_id: tab.window_id, incognito: tab.incognito, mode, text, opened: false });
      const answer = await deps.call("cmdline_panel.open", { tab_id });
      if (!answer.ok) await deps.session.remove(CMDLINE_PANEL_STORAGE_KEY);
      return answer.ok;
    },
    // The answer to `open_panel_cmdline`: once per recorded panel, and only while its tab is still in the window it was recorded in.
    opened: async (sender: PanelSender): Promise<PanelCmdlineOpened | undefined> => {
      if (!is_panel_page(sender)) return undefined;
      const record = await claim();
      if (!record) return undefined;
      const tab = await deps.get_tab(record.tab_id);
      if (!tab || tab.window_id !== record.window_id) return undefined;
      const opened = await deps.open_line(tab, PANEL_FRAME_ID, record.mode);
      return opened && { ...opened, text: record.text, mode: record.mode };
    },
    // Who asks: a frame of a tab, or the panel page for the tab it was opened over. Undefined for anyone else.
    asker_of: async (sender: PanelSender): Promise<Asker | undefined> => {
      if (sender.tab) return frame_asker_of(sender);
      if (!is_panel_page(sender)) return undefined;
      const record = await read();
      return record?.opened ? { tab_id: record.tab_id, frame_id: PANEL_FRAME_ID, window_id: record.window_id, incognito: record.incognito } : undefined;
    },
    forget: async (tab_id: number): Promise<void> => {
      if ((await read())?.tab_id === tab_id) await deps.session.remove(CMDLINE_PANEL_STORAGE_KEY);
    },
  };
}

export type CmdlinePanel = ReturnType<typeof create_cmdline_panel>;

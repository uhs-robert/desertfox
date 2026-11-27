// The command line on a locked page: DesertFox's own `cmdline.html` in a panel the browser module opens over the tab (see docs/design/browser_module.md, "The command line panel").
// The panel's page has no tab of its own, so the background records the panel the module opened, and every message of that page reads the tab from the record.

import type { ModuleArgs } from "../shared/browser_module_protocol.ts";
import { CMDLINE_PANEL_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import type { CmdlineOpened, PanelCmdlineOpened } from "../shared/messages/content.ts";
import { keep_chain } from "../shared/swallow.ts";
import type { CallResult } from "./browser_module_call.ts";
import type { Asker } from "./complete_items.ts";

// The panel is no frame of the tab. The line it opens marks this id as the tab's opener, so the opener checks of the in-page line admit the panel's page and no frame of the tab.
export const PANEL_FRAME_ID = -1;

// `url` is the panel page's own address, with the key the module made for it, so only that page is admitted. `opened` is set once the page took its data.
type PanelRecord = { tab_id: number; window_id: number; incognito: boolean; mode: string; text: string; url: string; opened: boolean };

export type PanelTab = { tab_id: number; window_id: number; incognito: boolean; url?: string | undefined; index?: number | undefined };

export type PanelSender = { id?: string | undefined; url?: string | undefined; frameId?: number | undefined; tab?: { id?: number | undefined; windowId?: number | undefined; incognito?: boolean | undefined } | undefined };

export type CmdlinePanelDeps = {
  session: Pick<typeof browser.storage.session, "get" | "set" | "remove">;
  extension_id: string;
  // The address of `cmdline.html`. The module loads it with `?panel=` and its key.
  page_url: string;
  get_tab: (tab_id: number) => Promise<PanelTab | undefined>;
  call: (kind: string, args: ModuleArgs) => Promise<CallResult>;
  // The command line service's data for a line of this tab, after a ticket it issues and redeems itself.
  open_line: (tab: PanelTab, frame_id: number, mode: string) => Promise<CmdlineOpened | undefined>;
};

// The module's reply to `cmdline_panel.open`, foreign input: the key of the page it loads and the keys typed while the line opened.
const PANEL_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TYPED_CHARS = 64;
function panel_reply_of(value: string | undefined): { key: string; typed: string } | undefined {
  let reply: unknown;
  try {
    reply = JSON.parse(value ?? "");
  } catch {
    return undefined;
  }
  const { key, typed } = (typeof reply === "object" && reply !== null ? reply : {}) as { key?: unknown; typed?: unknown };
  if (typeof key !== "string" || !PANEL_KEY.test(key)) return undefined;
  return { key, typed: typeof typed === "string" ? [...typed.replace(/[\p{Cc}\p{Cf}]/gu, "")].slice(0, MAX_TYPED_CHARS).join("") : "" };
}

const is_record = (value: unknown): value is PanelRecord => {
  const record = value as Partial<PanelRecord> | null | undefined;
  return typeof record === "object" && record !== null && Number.isInteger(record.tab_id) && Number.isInteger(record.window_id) && typeof record.incognito === "boolean" && typeof record.mode === "string" && typeof record.text === "string" && typeof record.url === "string" && typeof record.opened === "boolean";
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
  const remove = () => deps.session.remove(CMDLINE_PANEL_STORAGE_KEY);

  // Every change to the record waits for the one before, so an open, a page's claim and a forget never interleave: none deletes or overwrites a record written after it read.
  // A page that asks while its panel's open still waits for the module's reply finds the record once the reply is in.
  let last_change: Promise<unknown> = Promise.resolve();
  const in_turn = <T>(change: () => Promise<T>): Promise<T> => {
    const done = last_change.then(change);
    last_change = keep_chain(done);
    return done;
  };
  const forget_if = (stale: (record: PanelRecord) => boolean) =>
    in_turn(async () => {
      const record = await read();
      if (record && stale(record)) await remove();
    });

  // The panel page alone: DesertFox's own `cmdline.html` with no tab, at the address with this panel's key. Another copy of the page, framed or opened anywhere, has another address or a tab.
  const is_panel_page = (sender: PanelSender, record: PanelRecord): boolean => sender.id === deps.extension_id && sender.tab === undefined && sender.url === record.url;

  return {
    // Asks the module, then records the panel it opened. False when the module refused or did not answer, so the caller falls back to the address bar. A refusal leaves the record as it was.
    open: (tab_id: number, text: string, mode = "normal"): Promise<boolean> =>
      in_turn(async () => {
        const tab = await deps.get_tab(tab_id);
        if (!tab) return false;
        const answer = await deps.call("cmdline_panel.open", { tab_id });
        const reply = answer.ok ? panel_reply_of(answer.value) : undefined;
        if (!reply) return false;
        await write({ tab_id, window_id: tab.window_id, incognito: tab.incognito, mode, text: text + reply.typed, url: `${deps.page_url}?panel=${reply.key}`, opened: false });
        return true;
      }),
    // The answer to `open_panel_cmdline`: once per recorded panel, and only while its tab is still in the window it was recorded in.
    opened: async (sender: PanelSender): Promise<PanelCmdlineOpened | undefined> => {
      const record = await in_turn(async () => {
        const unclaimed = await read();
        if (!unclaimed || unclaimed.opened || !is_panel_page(sender, unclaimed)) return undefined;
        await write({ ...unclaimed, opened: true });
        return unclaimed;
      });
      if (!record) return undefined;
      const tab = await deps.get_tab(record.tab_id);
      if (!tab || tab.window_id !== record.window_id) return undefined;
      const opened = await deps.open_line(tab, PANEL_FRAME_ID, record.mode);
      return opened && { ...opened, text: record.text, mode: record.mode };
    },
    // Who asks: a frame of a tab, or the panel page for the tab it was opened over. Undefined for anyone else.
    asker_of: async (sender: PanelSender): Promise<Asker | undefined> => {
      if (sender.tab) return frame_asker_of(sender);
      const record = await read();
      return record?.opened && is_panel_page(sender, record) ? { tab_id: record.tab_id, frame_id: PANEL_FRAME_ID, window_id: record.window_id, incognito: record.incognito } : undefined;
    },
    // The panel page ended its line (Enter or Escape).
    closed: (sender: PanelSender): Promise<void> => forget_if((record) => is_panel_page(sender, record)),
    // The panel's tab closed or began a load.
    forget: (tab_id: number): Promise<void> => forget_if((record) => record.tab_id === tab_id),
    // Another tab of the panel's window came to the front, or another window took the focus: Firefox closes the panel then.
    left: (window_id: number): Promise<void> => forget_if((record) => record.window_id === window_id),
    focused: (window_id: number): Promise<void> => forget_if((record) => record.window_id !== window_id),
  };
}

export type CmdlinePanel = ReturnType<typeof create_cmdline_panel>;

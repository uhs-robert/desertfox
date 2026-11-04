import type { CommandContext } from "../shared/command.ts";
import type { ListedTab } from "../background/complete_items.ts";
import { browser_complete_items_deps, read_tabs } from "../background/complete_items.ts";
import { get_config } from "../background/startup.ts";
import { best_match } from "../shared/score.ts";
import { define } from "../shared/registry/index.ts";
import type { FindContainerStoreId } from "./open_target.ts";
import { find_container_store_id, require_tab_id, resolve_container_store_id } from "./open_target.ts";

export type TabInfo = {
  id: number;
  index: number;
  pinned: boolean;
  audible: boolean;
  muted: boolean;
  url: string | undefined;
  cookie_store_id: string | undefined;
};

export type TabDeps = {
  tabs_in_window: (window_id: number) => Promise<TabInfo[]>;
  activate: (tab_id: number) => Promise<void>;
  set_pinned: (tab_id: number, pinned: boolean) => Promise<void>;
  set_muted: (tab_id: number, muted: boolean) => Promise<void>;
  move: (tab_id: number, index: number) => Promise<void>;
  duplicate: (tab_id: number) => Promise<void>;
  remove: (tab_ids: number[]) => Promise<void>;
  detach_to_new_window: (tab_id: number) => Promise<void>;
  open_tab: (open: { window_id: number; url: string; index: number; pinned: boolean; cookie_store_id: string }) => Promise<void>;
  // False when the closed-tab list is empty.
  restore_last_closed_tab: () => Promise<boolean>;
  // Undefined when no container has the name.
  find_container_store_id: FindContainerStoreId;
  // The tabs the line lists, the same list the completion shows: the line's window, or every window, and only tabs of the line's privacy.
  listed_tabs: (ctx: CommandContext) => Promise<ListedTab[]>;
  focus_window: (window_id: number) => Promise<void>;
};

type CloseSide = "none" | "all_before" | "all_after" | "focus_previous";

type Position = { tabs: TabInfo[]; current: TabInfo };

export function make_tab_handlers(deps: TabDeps) {
  async function position_of(ctx: CommandContext): Promise<Position> {
    if (ctx.window_id === undefined) throw new Error("No window");
    require_tab_id(ctx);
    const tabs = await deps.tabs_in_window(ctx.window_id);
    const current = tabs.find((tab) => tab.id === ctx.tab_id);
    if (!current) throw new Error("the active tab is gone");
    return { tabs, current };
  }

  async function activate_at(tabs: TabInfo[], index: number): Promise<void> {
    const target = tabs[index];
    if (target) await deps.activate(target.id);
  }

  return {
    next: async (ctx: CommandContext) => {
      const { tabs, current } = await position_of(ctx);
      await activate_at(tabs, wrap_index(current.index + 1, tabs.length));
    },
    prev: async (ctx: CommandContext) => {
      const { tabs, current } = await position_of(ctx);
      await activate_at(tabs, wrap_index(current.index - 1, tabs.length));
    },
    goto: async (ctx: CommandContext, args: { index: number }) => {
      const { tabs, current } = await position_of(ctx);
      if (args.index === NEXT_TAB_INDEX) return activate_at(tabs, wrap_index(current.index + 1, tabs.length));
      await activate_at(tabs, goto_target_index(args.index, tabs.length));
    },
    move: async (ctx: CommandContext, args: { offset: number }) => {
      const { tabs, current } = await position_of(ctx);
      await deps.move(current.id, clamp_index(current.index + args.offset, tabs.length));
    },
    duplicate: async (ctx: CommandContext) => {
      const { current } = await position_of(ctx);
      await deps.duplicate(current.id);
    },
    detach: async (ctx: CommandContext) => {
      const { tabs, current } = await position_of(ctx);
      if (tabs.length === 1) throw new Error("this is the only tab in its window");
      await deps.detach_to_new_window(current.id);
    },
    goto_audible: async (ctx: CommandContext) => {
      const { tabs, current } = await position_of(ctx);
      const target = next_audible_index(tabs, current.index);
      if (target === undefined) throw new Error("no tab is playing sound");
      await activate_at(tabs, target);
    },
    pin: async (ctx: CommandContext) => {
      const { current } = await position_of(ctx);
      await deps.set_pinned(current.id, !current.pinned);
    },
    mute: async (ctx: CommandContext) => {
      const { current } = await position_of(ctx);
      await deps.set_muted(current.id, !current.muted);
    },
    close: async (ctx: CommandContext, args: { side: CloseSide }) => {
      const { tabs, current } = await position_of(ctx);
      if (args.side === "all_before" || args.side === "all_after") {
        await deps.remove(side_tab_ids(tabs, current.index, args.side === "all_before" ? "before" : "after"));
        return;
      }
      const neighbor_index = focus_index_after_close(current.index, tabs.length, args.side === "focus_previous" ? "previous" : "next");
      // Focus moves first so Firefox does not pick the tab it would choose after the close.
      if (neighbor_index !== undefined) await activate_at(tabs, neighbor_index);
      await deps.remove([current.id]);
    },
    undo_close: async () => {
      if (!(await deps.restore_last_closed_tab())) throw new Error("no closed tab to restore");
    },
    switch: async (ctx: CommandContext, args: { tab: string }) => {
      const picked = pick_tab(await deps.listed_tabs(ctx), args.tab, ctx.window_id);
      await deps.activate(picked.id);
      if (picked.window_id !== ctx.window_id) await deps.focus_window(picked.window_id);
    },
    reopen_in_container: async (ctx: CommandContext, args: { container: string }) => {
      const { current } = await position_of(ctx);
      if (current.url === undefined || ctx.window_id === undefined) throw new Error("this tab has no address to reopen");
      const cookie_store_id = await resolve_container_store_id(args.container, deps.find_container_store_id);
      await deps.open_tab({ window_id: ctx.window_id, url: current.url, index: current.index, pinned: current.pinned, cookie_store_id });
      await deps.remove([current.id]);
    },
  };
}

const NUMBER_PICK = /^(\d+)(?:\s+(.*))?$/s;

// `3 GitHub` is what a completion pick puts in the line: the tab at place 3 of the tab bar, then its title. The number
// wins over the title, because the title may have changed since the pick. Other text is a fuzzy match on title and
// address, and an equal tie is refused. With several windows listed the same number exists once per window, so the
// title then picks one, else the line's own window.
export function pick_tab(tabs: readonly ListedTab[], text: string, current_window_id: number | undefined): ListedTab {
  const typed = text.trim();
  const numbered = NUMBER_PICK.exec(typed);
  const at_place = numbered ? tabs.filter((tab) => tab.number === Number(numbered[1])) : [];
  if (at_place.length === 1) return at_place[0] as ListedTab;
  if (at_place.length > 1) {
    const title = numbered?.[2]?.trim();
    const by_title = at_place.filter((tab) => tab.title === title);
    const own = at_place.filter((tab) => tab.window_id === current_window_id);
    const chosen = by_title.length === 1 ? by_title : own;
    if (chosen.length === 1) return chosen[0] as ListedTab;
    throw new Error(`tab ${numbered?.[1]} exists in several windows: ${at_place.map((tab) => `"${tab.title}"`).join(" and ")}`);
  }
  if (numbered && numbered[2] === undefined) throw new Error(`no tab at place ${numbered[1]}`);
  const match = best_match(typed, tabs, (tab) => ({ name: tab.title, description: tab.url }));
  if (match.found === "none") throw new Error(`no tab matches "${typed}"`);
  if (match.found === "tie") throw new Error(`"${typed}" matches "${match.first.number} ${match.first.title}" and "${match.second.number} ${match.second.title}" equally, use a number`);
  return match.item;
}

// `tab.goto` fills `index` with this when the user gives neither an index nor a count.
export const NEXT_TAB_INDEX = 0;

export function wrap_index(index: number, length: number): number {
  return ((index % length) + length) % length;
}

export function clamp_index(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length - 1);
}

// 1 is the first tab and -1 the last. Out of range clamps to the nearest end.
export function goto_target_index(index: number, length: number): number {
  return clamp_index(index > 0 ? index - 1 : length + index, length);
}

export function focus_index_after_close(closing_index: number, length: number, focus: "next" | "previous"): number | undefined {
  if (length === 1) return undefined;
  const preferred = focus === "previous" ? closing_index - 1 : closing_index + 1;
  return preferred >= 0 && preferred < length ? preferred : focus === "previous" ? closing_index + 1 : closing_index - 1;
}

// Pinned tabs stay, as in the Firefox "close tabs to the right/left" items.
export function side_tab_ids(tabs: TabInfo[], current_index: number, side: "before" | "after"): number[] {
  return tabs
    .filter((tab) => !tab.pinned && (side === "before" ? tab.index < current_index : tab.index > current_index))
    .map((tab) => tab.id);
}

// The next audible tab after the current one, wrapping. The current tab itself when it is the only one. Undefined when none is audible.
export function next_audible_index(tabs: TabInfo[], current_index: number): number | undefined {
  for (let step = 1; step <= tabs.length; step++) {
    const candidate = tabs[wrap_index(current_index + step, tabs.length)];
    if (candidate?.audible) return candidate.index;
  }
  return undefined;
}

function to_tab_info(tab: browser.tabs.Tab): TabInfo {
  return {
    id: tab.id ?? -1,
    index: tab.index,
    pinned: tab.pinned,
    audible: tab.audible ?? false,
    muted: tab.mutedInfo?.muted ?? false,
    url: tab.url,
    cookie_store_id: tab.cookieStoreId,
  };
}

export const browser_tab_deps: TabDeps = {
  tabs_in_window: async (window_id) => (await browser.tabs.query({ windowId: window_id })).map(to_tab_info).sort((a, b) => a.index - b.index),
  activate: async (tab_id) => void (await browser.tabs.update(tab_id, { active: true })),
  set_pinned: async (tab_id, pinned) => void (await browser.tabs.update(tab_id, { pinned })),
  set_muted: async (tab_id, muted) => void (await browser.tabs.update(tab_id, { muted })),
  move: async (tab_id, index) => void (await browser.tabs.move(tab_id, { index })),
  duplicate: async (tab_id) => void (await browser.tabs.duplicate(tab_id)),
  remove: (tab_ids) => browser.tabs.remove(tab_ids),
  detach_to_new_window: async (tab_id) => void (await browser.windows.create({ tabId: tab_id })),
  open_tab: async ({ window_id, url, index, pinned, cookie_store_id }) => {
    await browser.tabs.create({ windowId: window_id, url, index, pinned, cookieStoreId: cookie_store_id, active: true });
  },
  restore_last_closed_tab: async () => {
    const [closed] = (await browser.sessions.getRecentlyClosed()).filter((item) => item.tab);
    if (!closed?.tab?.sessionId) return false;
    await browser.sessions.restore(closed.tab.sessionId);
    return true;
  },
  find_container_store_id,
  listed_tabs: async (ctx) => {
    const tab = await browser.tabs.get(require_tab_id(ctx));
    if (tab.windowId === undefined) throw new Error("No window");
    const settings = (await get_config()).settings;
    return read_tabs(browser_complete_items_deps.query_tabs, { window_id: tab.windowId, incognito: tab.incognito }, settings.completion_all_windows === true);
  },
  focus_window: async (window_id) => void (await browser.windows.update(window_id, { focused: true })),
};

const handlers = make_tab_handlers(browser_tab_deps);

define("tab.next", {
  label: "Next tab",
  intent: "Switch to the next tab. It wraps from the last tab to the first. A count prefix repeats it.",
  runs_in: "background",
  count: "repeat",
  run: (ctx) => handlers.next(ctx),
});

define("tab.prev", {
  label: "Previous tab",
  intent: "Switch to the previous tab. It wraps from the first tab to the last. A count prefix repeats it.",
  runs_in: "background",
  count: "repeat",
  run: (ctx) => handlers.prev(ctx),
});

define("tab.undo_close", {
  label: "Reopen closed tab",
  intent: "Reopen the last closed tab. A count prefix restores that many.",
  runs_in: "background",
  count: "repeat",
  run: () => handlers.undo_close(),
});

define("tab.move", {
  label: "Move tab",
  intent: "Move the tab along the strip. A positive offset moves it later and a negative one earlier. A count prefix repeats it.",
  params: [{ name: "offset", type: "int" }],
  runs_in: "background",
  count: "repeat",
  run: (ctx, args) => handlers.move(ctx, args as { offset: number }),
});

define("tab.duplicate", {
  label: "Duplicate tab",
  intent: "Open a copy of the tab next to it.",
  runs_in: "background",
  run: (ctx) => handlers.duplicate(ctx),
});

define("tab.detach", {
  label: "Detach tab",
  intent: "Move the tab into a new window.",
  runs_in: "background",
  run: (ctx) => handlers.detach(ctx),
});

define("tab.goto", {
  label: "Go to tab",
  intent: "Switch to a tab by its position. Index 1 is the first tab and -1 the last. Index 0 means the next tab.",
  params: [{ name: "index", type: "int", default: NEXT_TAB_INDEX }],
  runs_in: "background",
  count: { param: "index" },
  run: (ctx, args) => handlers.goto(ctx, args as { index: number }),
});

define("tab.goto_audible", {
  label: "Go to audible tab",
  intent: "Switch to the next tab in this window that is playing sound.",
  runs_in: "background",
  run: (ctx) => handlers.goto_audible(ctx),
});

define("tab.pin", {
  label: "Toggle pin",
  intent: "Pin the tab, or unpin it when it is pinned.",
  runs_in: "background",
  run: (ctx) => handlers.pin(ctx),
});

define("tab.mute", {
  label: "Toggle mute",
  intent: "Mute the tab, or unmute it when it is muted.",
  runs_in: "background",
  run: (ctx) => handlers.mute(ctx),
});

define("tab.close", {
  label: "Close tab",
  intent: "Close the tab, or the tabs around it. Without all_before or all_after, it focuses the next tab, or the previous tab with focus_previous. With all_before or all_after, it keeps this tab and closes every unpinned tab before or after it. A count prefix repeats it.",
  params: [
    {
      name: "side",
      type: "enum",
      values: ["none", "all_before", "all_after", "focus_previous"],
      default: "none",
      short: { all_before: "B", all_after: "A", focus_previous: "P" },
      value_labels: { all_before: "for all before it", all_after: "for all after it", focus_previous: "and focus previous" },
      description: {
        all_before: "Close every unpinned tab before this one.",
        all_after: "Close every unpinned tab after this one.",
        focus_previous: "Focus the previous tab instead of the next.",
      },
    },
  ],
  runs_in: "background",
  count: "repeat",
  run: (ctx, args) => handlers.close(ctx, args as { side: CloseSide }),
});

define("tab.reopen_in_container", {
  label: "Reopen in container",
  intent: "Reopen the page in a container. It opens in the same place and closes the old tab. The container default means none.",
  params: [{ name: "container", type: "string", main: true, values: { from: "containers" } }],
  runs_in: "background",
  run: (ctx, args) => handlers.reopen_in_container(ctx, args as { container: string }),
});

define("tab.switch", {
  name: "tab",
  label: "Switch tab",
  intent: "Switch to an open tab by number, title or address. The number is its place in the tab bar.",
  params: [{ name: "tab", type: "string", rest: true, main: true, values: { from: "tabs" } }],
  runs_in: "background",
  run: (ctx, args) => handlers.switch(ctx, args as { tab: string }),
});

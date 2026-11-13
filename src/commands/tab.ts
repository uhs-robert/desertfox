import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import type { ToastKind } from "../shared/messages.ts";
import type { ListedTab } from "../background/complete_items.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";
import { browser_tab_action_deps, move_tabs, reopen_in_container, set_muted, set_pinned } from "../background/tab_actions.ts";
import type { TabActionDeps } from "../background/tab_actions.ts";
import { browser_discard_deps, describe_result, set_unloaded } from "../background/tab_discard.ts";
import type { DiscardDeps, SetUnloadedResult } from "../background/tab_discard.ts";
import { browser_complete_items_deps, read_tabs } from "../background/complete_items.ts";
import { shared_previous_tabs } from "../background/previous_tab.ts";
import { get_config } from "../background/startup.ts";
import { best_match } from "../shared/score.ts";
import { site_key } from "../shared/site_key.ts";
import { define } from "../shared/registry/builtin.ts";
import type { FindContainerStoreId } from "./open_target.ts";
import { find_container_store_id, require_tab_id, resolve_container_store_id } from "./open_target.ts";

export type TabInfo = {
  id: number;
  index: number;
  pinned: boolean;
  // -1 for a tab in no split view.
  split_id: number;
  active: boolean;
  audible: boolean;
  muted: boolean;
  url: string | undefined;
  cookie_store_id: string | undefined;
};

export type TabDeps = TabActionDeps & {
  tabs_in_window: (window_id: number) => Promise<TabInfo[]>;
  activate: (tab_id: number) => Promise<void>;
  duplicate: (tab_id: number) => Promise<void>;
  detach_to_new_window: (tab_id: number) => Promise<void>;
  // False when the closed-tab list is empty.
  restore_last_closed_tab: () => Promise<boolean>;
  // Undefined when no container has the name.
  find_container_store_id: FindContainerStoreId;
  // The tabs the line lists, the same list the completion shows: the line's window, or every window, and only tabs of the line's privacy.
  listed_tabs: (ctx: CommandContext) => Promise<ListedTab[]>;
  focus_window: (window_id: number) => Promise<void>;
  // The tab the window was on before the current one.
  previous_tab_of: (window_id: number) => Promise<number | undefined>;
  // What `tab.unload` and `tab.load` act through.
  discard: DiscardDeps;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
};

type UnloadSide = "none" | "all_before" | "all_after" | "site";

type CloseSide = "none" | "all_before" | "all_after" | "focus_previous" | "site";

type Position = { tabs: TabInfo[]; current: TabInfo };

export function make_tab_handlers(deps: TabDeps) {
  async function position_of(ctx: CommandContext): Promise<Position> {
    if (ctx.window_id === undefined) throw new RuntimeRefusal("No window");
    require_tab_id(ctx);
    const tabs = await deps.tabs_in_window(ctx.window_id);
    const current = tabs.find((tab) => tab.id === ctx.tab_id);
    if (!current) throw new RuntimeRefusal("the active tab is gone");
    return { tabs, current };
  }

  const current_window_id = (ctx: CommandContext): number => ctx.window_id!;

  async function activate_at(tabs: TabInfo[], index: number): Promise<void> {
    const target = tabs[index];
    if (target) await deps.activate(target.id);
  }

  // A whole number is a place in this window and counts from the end when negative. Other text names a tab, which takes the place of the picked tab, so the tabs between shift like a drag. No text means the offset decides.
  async function move_target(ctx: CommandContext, tabs: TabInfo[], args: { tab: string }): Promise<number | undefined> {
    const text = args.tab.trim();
    if (text === "") return undefined;
    if (WHOLE_NUMBER.test(text)) return goto_target_index(Number(text), tabs.length);
    const picked = pick_tab(await deps.listed_tabs(ctx), text, ctx.window_id);
    if (picked.window_id !== ctx.window_id) throw new RuntimeRefusal("the picked tab is in another window");
    const index = tabs.find((tab) => tab.id === picked.id)?.index;
    if (index === undefined) throw new RuntimeRefusal("the picked tab is gone");
    return index;
  }

  // Firefox moves a split view as one unit, so the place is where the pair starts. A move onto the partner's place swaps the two tabs instead,
  // and `tab.split_swap` is the key for that, so one step right jumps the tab after the pair over it.
  async function move_split_pair(tabs: TabInfo[], current: TabInfo, target: number | undefined, offset: number, first_place: number): Promise<void> {
    const pair = tabs.filter((tab) => tab.split_id === current.split_id);
    const start = Math.min(...pair.map((tab) => tab.index));
    const place = Math.min(Math.max(target ?? start + offset, first_place), tabs.length - pair.length);
    if (place === start) return;
    const step_over = place === start + 1 ? tabs.find((tab) => tab.index === start + pair.length) : undefined;
    if (step_over) await move_tabs(deps, [step_over.id], start);
    else await move_tabs(deps, [pair.find((tab) => tab.index === start)!.id], place);
  }

  // The subject is the tab named by `tab`, else the line's own tab. A side acts on the neighbors and leaves the subject, except `site`, which acts on the subject too. A count adds neighbors after the subject. Neighbors skip pinned tabs, the subject never does.
  async function change_loaded(ctx: CommandContext, args: { tab: string; side: UnloadSide; count: number }, unloaded: boolean): Promise<void> {
    const named = args.tab.trim() === "" ? undefined : pick_tab(await deps.listed_tabs(ctx), args.tab, ctx.window_id);
    const window_id = named?.window_id ?? ctx.window_id;
    if (window_id === undefined) throw new RuntimeRefusal("No window");
    const tabs = await deps.tabs_in_window(window_id);
    const subject = tabs.find((tab) => tab.id === (named?.id ?? require_tab_id(ctx)));
    if (!subject) throw new RuntimeRefusal("the tab is gone");
    const unpinned = tabs.filter((tab) => !tab.pinned);
    // The site is read in the line's window, though a named subject may sit in another one.
    const line_window_id = ctx.window_id ?? window_id;
    const site_pool = line_window_id === window_id ? tabs : await deps.tabs_in_window(line_window_id);
    const ids = (
      args.side === "none"
        ? [subject, ...unpinned.filter((tab) => tab.index > subject.index && tab.index < subject.index + args.count)]
        : args.side === "site"
          ? [subject, ...site_tabs(site_pool, subject).filter((tab) => tab.id !== subject.id)]
          : unpinned.filter((tab) => (args.side === "all_before" ? tab.index < subject.index : tab.index > subject.index))
    ).map((tab) => tab.id);
    const result = await set_unloaded(deps.discard, ids, unloaded, ctx.tab_id === undefined ? {} : { leave_active: ctx.tab_id });
    await report(ctx, window_id, unloaded ? "unloaded" : "loaded", result);
  }

  // The toast goes to the tab that is active now: the command's own tab may have just unloaded, and a discarded tab shows nothing.
  async function report(ctx: CommandContext, window_id: number, verb: "unloaded" | "loaded", result: SetUnloadedResult): Promise<void> {
    const message = describe_result(verb, result);
    if (result.changed.length === 0) throw new RuntimeRefusal(message);
    const active = (await deps.discard.tabs_in_window(window_id)).find((tab) => tab.active);
    await deps.toast(active ? { ...ctx, tab_id: active.id, frame_id: 0 } : ctx, result.skipped.length === 0 ? "success" : "warning", message);
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
    move: async (ctx: CommandContext, args: { tab: string; offset: number }) => {
      const { tabs, current } = await position_of(ctx);
      const target = await move_target(ctx, tabs, args);
      const wanted = target ?? clamp_index(current.index + args.offset, tabs.length);
      // Firefox ignores a move across the pinned boundary, so land at the nearest place on the tab's own side.
      const pinned_count = tabs.filter((tab) => tab.pinned).length;
      const own_side = current.pinned ? { first: 0, last: pinned_count - 1 } : { first: pinned_count, last: tabs.length - 1 };
      if (current.split_id !== -1) return move_split_pair(tabs, current, target, args.offset, own_side.first);
      await move_tabs(deps, [current.id], Math.min(Math.max(wanted, own_side.first), own_side.last));
    },
    duplicate: async (ctx: CommandContext) => {
      const { current } = await position_of(ctx);
      await deps.duplicate(current.id);
    },
    detach: async (ctx: CommandContext) => {
      const { tabs, current } = await position_of(ctx);
      if (tabs.length === 1) throw new RuntimeRefusal("this is the only tab in its window");
      await deps.detach_to_new_window(current.id);
    },
    alternate: async (ctx: CommandContext) => {
      const { tabs, current } = await position_of(ctx);
      const previous_id = await deps.previous_tab_of(current_window_id(ctx));
      const target = tabs.find((tab) => tab.id === previous_id && tab.id !== current.id);
      if (!target) throw new RuntimeRefusal("no previous tab");
      await deps.activate(target.id);
    },
    goto_audible: async (ctx: CommandContext) => {
      const { tabs, current } = await position_of(ctx);
      const target = next_audible_index(tabs, current.index);
      if (target === undefined) throw new RuntimeRefusal("no tab is playing sound");
      await activate_at(tabs, target);
    },
    pin: async (ctx: CommandContext) => {
      const { current } = await position_of(ctx);
      await set_pinned(deps, [current.id], !current.pinned);
    },
    mute: async (ctx: CommandContext) => {
      const { current } = await position_of(ctx);
      await set_muted(deps, [current.id], !current.muted);
    },
    close: async (ctx: CommandContext, args: { side: CloseSide }) => {
      const { tabs, current } = await position_of(ctx);
      if (args.side === "site") {
        const closing = site_tabs(tabs, current).map((tab) => tab.id);
        // A pinned tab of the site stays open but must not take focus: the focus leaves the site.
        const site = site_key(current.url ?? "").key;
        const outside = nearest_tab(tabs, current.index, (tab) => site_key(tab.url ?? "").key !== site);
        // Focus moves first, as for one tab, so Firefox does not pick its own tab after the close.
        if (outside && current.active) await deps.activate(outside.id);
        await deps.remove(closing);
        return;
      }
      if (args.side === "all_before" || args.side === "all_after") {
        await deps.remove(side_tab_ids(tabs, current.index, args.side === "all_before" ? "before" : "after"));
        return;
      }
      // The other pane takes the focus, as Firefox does for a pair whose tab closes.
      const partner = current.split_id === -1 ? undefined : tabs.find((tab) => tab.split_id === current.split_id && tab.id !== current.id);
      if (partner) {
        if (current.active) await deps.activate(partner.id);
        await deps.remove([current.id]);
        return;
      }
      const neighbor_index = focus_index_after_close(current.index, tabs.length, args.side === "focus_previous" ? "previous" : "next");
      // Focus moves first so Firefox does not pick the tab it would choose after the close. A tab that is no longer active (the key came from it before a tab switch) leaves focus where it is.
      if (neighbor_index !== undefined && current.active) await activate_at(tabs, neighbor_index);
      await deps.remove([current.id]);
    },
    undo_close: async () => {
      if (!(await deps.restore_last_closed_tab())) throw new RuntimeRefusal("no closed tab to restore");
    },
    switch: async (ctx: CommandContext, args: { tab: string }) => {
      const picked = pick_tab(await deps.listed_tabs(ctx), args.tab, ctx.window_id);
      await deps.activate(picked.id);
      if (picked.window_id !== ctx.window_id) await deps.focus_window(picked.window_id);
    },
    unload: (ctx: CommandContext, args: { tab: string; side: UnloadSide; count: number }) => change_loaded(ctx, args, true),
    load: (ctx: CommandContext, args: { tab: string; side: UnloadSide; count: number }) => change_loaded(ctx, args, false),
    reopen_in_container: async (ctx: CommandContext, args: { container: string }) => {
      const { current } = await position_of(ctx);
      if (current.url === undefined || ctx.window_id === undefined) throw new RuntimeRefusal("this tab has no address to reopen");
      const cookie_store_id = await resolve_container_store_id(args.container, deps.find_container_store_id);
      await reopen_in_container(deps, ctx.window_id, [current], cookie_store_id);
    },
  };
}

const WHOLE_NUMBER = /^-?\d+$/;
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
    throw new RuntimeRefusal(`tab ${numbered?.[1]} exists in several windows: ${at_place.map((tab) => `"${tab.title}"`).join(" and ")}`);
  }
  if (numbered && numbered[2] === undefined) throw new RuntimeRefusal(`no tab at place ${numbered[1]}`);
  const match = best_match(typed, tabs, (tab) => ({ name: tab.title, description: tab.url }));
  if (match.found === "none") throw new RuntimeRefusal(`no tab matches "${typed}"`);
  if (match.found === "tie") throw new RuntimeRefusal(`"${typed}" matches "${match.first.number} ${match.first.title}" and "${match.second.number} ${match.second.title}" equally, use a number`);
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

// Every tab of the window with the subject's site key, in tab bar order. Pinned tabs stay, the subject never does.
export function site_tabs(tabs: TabInfo[], subject: TabInfo): TabInfo[] {
  const key = site_key(subject.url ?? "").key;
  return tabs.filter((tab) => tab.id === subject.id || (!tab.pinned && site_key(tab.url ?? "").key === key));
}

// The tab nearest to `index` among those `eligible` accepts. A tie goes to the tab after.
export function nearest_tab(tabs: TabInfo[], index: number, eligible: (tab: TabInfo) => boolean): TabInfo | undefined {
  return tabs
    .filter(eligible)
    .reduce<TabInfo | undefined>((best, tab) => {
      const distance = Math.abs(tab.index - index);
      const best_distance = best && Math.abs(best.index - index);
      return best_distance === undefined || distance < best_distance || (distance === best_distance && tab.index > index) ? tab : best;
    }, undefined);
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
    split_id: tab.splitViewId ?? -1,
    active: tab.active,
    audible: tab.audible ?? false,
    muted: tab.mutedInfo?.muted ?? false,
    url: tab.url,
    cookie_store_id: tab.cookieStoreId,
  };
}

export const browser_tab_deps: TabDeps = {
  tabs_in_window: async (window_id) => (await browser.tabs.query({ windowId: window_id })).map(to_tab_info).sort((a, b) => a.index - b.index),
  activate: async (tab_id) => void (await browser.tabs.update(tab_id, { active: true })),
  ...browser_tab_action_deps,
  duplicate: async (tab_id) => void (await browser.tabs.duplicate(tab_id)),
  detach_to_new_window: async (tab_id) => void (await browser.windows.create({ tabId: tab_id })),
  restore_last_closed_tab: async () => {
    const [closed] = (await browser.sessions.getRecentlyClosed()).filter((item) => item.tab);
    if (!closed?.tab?.sessionId) return false;
    await browser.sessions.restore(closed.tab.sessionId);
    return true;
  },
  find_container_store_id,
  listed_tabs: async (ctx) => {
    const tab = await browser.tabs.get(require_tab_id(ctx));
    if (tab.windowId === undefined) throw new RuntimeRefusal("No window");
    const settings = (await get_config()).settings;
    return read_tabs(browser_complete_items_deps.query_tabs, { window_id: tab.windowId, incognito: tab.incognito }, settings.completion_all_windows === true);
  },
  focus_window: async (window_id) => void (await browser.windows.update(window_id, { focused: true })),
  previous_tab_of: (window_id) => shared_previous_tabs().previous_of(window_id),
  discard: browser_discard_deps,
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "tab.unload", message, kind),
};

const handlers = make_tab_handlers(browser_tab_deps);

const subject_param = { name: "tab", type: "string", rest: true, main: true, optional: true, values: { from: "tabs" } } as const;

const side_param = (verb: "Unload" | "Load") =>
  ({
    name: "side",
    type: "enum",
    values: ["none", "all_before", "all_after", "site"],
    default: "none",
    short: { all_before: "B", all_after: "A", site: "S" },
    value_labels: { all_before: "for all before it", all_after: "for all after it", site: "for its whole site" },
    description: {
      all_before: `${verb} every unpinned tab before the tab.`,
      all_after: `${verb} every unpinned tab after the tab.`,
      site: `${verb} the tab and the unpinned tabs of its site.`,
    },
  }) as const;

const count_param = { name: "count", type: "int", min: 1, default: 1, when: { side: ["none"] }, description: "Act on this many tabs, the tab and the ones after it." } as const;

define("tab.next", {
  label: "Next tab",
  intent: "Switch to the next tab. It wraps from the last tab to the first. A count prefix repeats it.",
  bridge: true,
  runs_in: "background",
  count: "repeat",
  run: (ctx) => handlers.next(ctx),
});

define("tab.prev", {
  label: "Previous tab",
  intent: "Switch to the previous tab. It wraps from the first tab to the last. A count prefix repeats it.",
  bridge: true,
  runs_in: "background",
  count: "repeat",
  run: (ctx) => handlers.prev(ctx),
});

define("tab.undo_close", {
  label: "Reopen closed tab",
  intent: "Reopen the last closed tab. A count prefix restores that many.",
  bridge: false,
  runs_in: "background",
  count: "repeat",
  run: () => handlers.undo_close(),
});

define("tab.move", {
  label: "Move tab",
  intent: "Move the tab to a place in the strip. Name a place number, where 1 is first and -1 last, or a tab, whose place it takes. --offset moves it along the strip, positive later and negative earlier. With both, the place wins. A move stops at the edge of the pinned tabs, so a pinned tab stays pinned-side and an unpinned tab stays after them. A count prefix repeats it.",
  params: [
    { name: "tab", type: "string", rest: true, main: true, optional: true, values: { from: "tabs" }, description: "Take this place number, or the place of this tab." },
    { name: "offset", type: "int", default: 0, description: "Move this many places, positive later and negative earlier." },
  ],
  bridge: false,
  runs_in: "background",
  count: "repeat",
  run: (ctx, args) => handlers.move(ctx, args as { tab: string; offset: number }),
});

define("tab.duplicate", {
  label: "Duplicate tab",
  intent: "Open a copy of the tab next to it.",
  bridge: false,
  runs_in: "background",
  run: (ctx) => handlers.duplicate(ctx),
});

define("tab.detach", {
  label: "Detach tab",
  intent: "Move the tab into a new window.",
  bridge: false,
  runs_in: "background",
  run: (ctx) => handlers.detach(ctx),
});

define("tab.goto", {
  label: "Go to tab",
  intent: "Switch to a tab by its position. Index 1 is the first tab and -1 the last. Index 0 means the next tab.",
  params: [{ name: "index", type: "int", default: NEXT_TAB_INDEX }],
  bridge: true,
  runs_in: "background",
  count: { param: "index" },
  run: (ctx, args) => handlers.goto(ctx, args as { index: number }),
});

define("tab.alternate", {
  label: "Previous tab in this window",
  intent: "Switch to the previous tab. It ignores a count.",
  bridge: true,
  runs_in: "background",
  run: (ctx) => handlers.alternate(ctx),
});

define("tab.goto_audible", {
  label: "Go to audible tab",
  intent: "Switch to the next tab in this window that is playing sound.",
  bridge: true,
  runs_in: "background",
  run: (ctx) => handlers.goto_audible(ctx),
});

define("tab.pin", {
  label: "Toggle pin",
  intent: "Pin the tab, or unpin it when it is pinned.",
  bridge: false,
  runs_in: "background",
  run: (ctx) => handlers.pin(ctx),
});

define("tab.mute", {
  label: "Toggle mute",
  intent: "Mute the tab, or unmute it when it is muted.",
  bridge: true,
  runs_in: "background",
  run: (ctx) => handlers.mute(ctx),
});

define("tab.close", {
  label: "Close tab",
  intent: "Close the tab, or the tabs around it. Without all_before or all_after, it focuses the next tab, or the previous tab with focus_previous. With all_before or all_after, it keeps this tab and closes every unpinned tab before or after it. With site, it closes this tab and the unpinned tabs of its site in the window, after moving focus to the nearest tab outside the site. A count prefix repeats it.",
  params: [
    {
      name: "side",
      type: "enum",
      values: ["none", "all_before", "all_after", "focus_previous", "site"],
      default: "none",
      short: { all_before: "B", all_after: "A", focus_previous: "P", site: "S" },
      value_labels: { all_before: "for all before it", all_after: "for all after it", focus_previous: "and focus previous", site: "for its whole site" },
      description: {
        all_before: "Close every unpinned tab before this one.",
        all_after: "Close every unpinned tab after this one.",
        focus_previous: "Focus the previous tab instead of the next.",
        site: "Close this tab and the unpinned tabs of its site.",
      },
    },
  ],
  bridge: false,
  runs_in: "background",
  count: "repeat",
  repeat_limit: 20,
  run: (ctx, args) => handlers.close(ctx, args as { side: CloseSide }),
});

define("tab.reopen_in_container", {
  label: "Reopen in container",
  intent: "Reopen the page in a container. It opens in the same place and closes the old tab. The container default means none.",
  params: [{ name: "container", type: "string", rest: true, main: true, values: { from: "containers" } }],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handlers.reopen_in_container(ctx, args as { container: string }),
});

define("tab.switch", {
  name: "tab",
  label: "Switch tab",
  intent: "Switch to an open tab by number, title or address. The number is its place in the tab bar.",
  params: [{ name: "tab", type: "string", rest: true, main: true, values: { from: "tabs" } }],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handlers.switch(ctx, args as { tab: string }),
});

define("tab.unload", {
  label: "Unload tab",
  intent: "Unload the tab to free its memory. It stays in the tab bar and loads again when opened. Audible tabs stay loaded. Without a tab it unloads this one and switches to a loaded tab first. With all_before or all_after it keeps the tab and unloads the unpinned tabs on that side. With site it unloads the tab and the unpinned tabs of its site in the window. A count prefix unloads that many tabs from the tab on. A count prefix over 20 is refused.",
  params: [subject_param, side_param("Unload"), count_param],
  bridge: false,
  runs_in: "background",
  count: { param: "count" },
  repeat_limit: 20,
  run: (ctx, args) => handlers.unload(ctx, args as { tab: string; side: UnloadSide; count: number }),
});

define("tab.load", {
  label: "Load tab",
  intent: "Load an unloaded tab in place, without switching to it. Without a tab it acts on this one. With all_before or all_after it keeps the tab and loads the unpinned tabs on that side. With site it loads the tab and the unpinned tabs of its site in the window. A count prefix loads that many tabs from the tab on.",
  params: [subject_param, side_param("Load"), count_param],
  bridge: false,
  runs_in: "background",
  count: { param: "count" },
  run: (ctx, args) => handlers.load(ctx, args as { tab: string; side: UnloadSide; count: number }),
});

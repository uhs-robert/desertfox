import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { LIST_FORMATS } from "../shared/copy/link_list.ts";
import type { ListFormat } from "../shared/copy/link_list.ts";
import { listed_tabs } from "../shared/completion/tab_rows.ts";
import { browser_group_deps, browser_tab_action_deps, close_tabs, group_tabs, set_muted, set_pinned } from "../background/tab_actions.ts";
import type { GroupDeps, TabActionDeps } from "../background/tab_actions.ts";
import { add_many_bookmarks } from "./bookmark.ts";
import { browser_copy_tabs_deps, copy_listed_tabs } from "./copy_tabs.ts";
import { nearest_tab } from "./tab.ts";
import { attach_many_tabs } from "./window.ts";

// The most tabs `close` takes at once. A bigger range is refused until a way to confirm exists.
export const CLOSE_LIMIT = 10;

export type ActTab = { id: number; index: number; active: boolean; pinned: boolean; muted: boolean; hidden: boolean; group_id: number; url: string; title: string };

export type TabActDeps = Pick<TabActionDeps, "set_muted" | "set_pinned" | "remove"> & {
  // The tabs Firefox shows as selected in the window, in strip order. A window with no selection answers the active tab.
  selected_tabs: (window_id: number) => Promise<ActTab[]>;
  window_tabs: (window_id: number) => Promise<ActTab[]>;
  collapsed_group_ids: (window_id: number) => Promise<ReadonlySet<number>>;
  activate: (tab_id: number) => Promise<void>;
  reload: (tab_id: number) => Promise<void>;
  group: GroupDeps;
  copy: (ctx: CommandContext, tab_ids: number[], format: ListFormat) => Promise<void>;
  attach: (ctx: CommandContext, tab_ids: number[]) => Promise<void>;
  bookmark: (ctx: CommandContext, tabs: ActTab[]) => Promise<void>;
};

export type TabAction = "close" | "pin" | "mute" | "reload" | "copy" | "group" | "attach" | "bookmark";

export function make_tab_act_handler(deps: TabActDeps) {
  // Focus moves to the nearest tab outside the range first, so Firefox does not pick its own. A tab of a collapsed group is a poor target, so it counts only when no other tab is outside, and a hidden tab never takes the focus.
  async function close(window_id: number, tabs: ActTab[], force: boolean): Promise<void> {
    if (!force && tabs.length > CLOSE_LIMIT) throw new RuntimeRefusal(`Refused to close ${tabs.length} tabs at once, the limit is ${CLOSE_LIMIT}, force it with the force flag`);
    const all = await deps.window_tabs(window_id);
    if (tabs.length === all.length) throw new RuntimeRefusal("The range holds every tab in the window, use wc to close the window");
    const inside = new Set(tabs.map((tab) => tab.id));
    const active = tabs.find((tab) => tab.active);
    if (active) {
      const collapsed = await deps.collapsed_group_ids(window_id);
      const outside = (tab: ActTab) => !inside.has(tab.id);
      const target = nearest_tab(all, active.index, (tab) => outside(tab) && !tab.hidden && !collapsed.has(tab.group_id)) ?? nearest_tab(all, active.index, (tab) => outside(tab) && !tab.hidden);
      if (target) await deps.activate(target.id);
    }
    await close_tabs(deps, tabs.map((tab) => tab.id));
  }

  // One tab is a range of one: the keys and the typed command act on the tab itself.
  return async (ctx: CommandContext, args: { action: TabAction; format?: ListFormat; force?: boolean }): Promise<void> => {
    if (ctx.window_id === undefined) throw new RuntimeRefusal("No window");
    const tabs = await deps.selected_tabs(ctx.window_id);
    if (tabs.length === 0) throw new RuntimeRefusal("No tabs selected");
    const ids = tabs.map((tab) => tab.id);
    switch (args.action) {
      case "close":
        return close(ctx.window_id, tabs, args.force ?? false);
      // Any tab off turns the whole range on, else it turns the whole range off, as the tab list does.
      case "pin":
        return set_pinned(deps, ids, tabs.some((tab) => !tab.pinned));
      case "mute":
        return set_muted(deps, ids, tabs.some((tab) => !tab.muted));
      case "reload":
        await Promise.all(ids.map((id) => deps.reload(id)));
        return;
      case "copy":
        return deps.copy(ctx, ids, args.format ?? "markdown");
      case "group":
        await group_tabs(deps.group, ids, {});
        return;
      case "attach":
        return deps.attach(ctx, ids);
      case "bookmark":
        return deps.bookmark(ctx, tabs);
    }
  };
}

const to_act_tab = (tab: browser.tabs.Tab): ActTab => ({
  id: tab.id!,
  index: tab.index,
  active: tab.active,
  pinned: tab.pinned,
  muted: !!tab.mutedInfo?.muted,
  hidden: !!tab.hidden,
  group_id: tab.groupId ?? -1,
  url: tab.url ?? "",
  title: tab.title ?? "",
});

const by_index = (a: ActTab, b: ActTab) => a.index - b.index;

const browser_tab_act_deps: TabActDeps = {
  ...browser_tab_action_deps,
  selected_tabs: async (window_id) => {
    const selected = (await browser.tabs.query({ windowId: window_id, highlighted: true })).map(to_act_tab);
    return (selected.length > 0 ? selected : (await browser.tabs.query({ windowId: window_id, active: true })).map(to_act_tab)).toSorted(by_index);
  },
  window_tabs: async (window_id) => (await browser.tabs.query({ windowId: window_id })).map(to_act_tab).toSorted(by_index),
  collapsed_group_ids: async (window_id) => new Set((await browser.tabGroups.query({ windowId: window_id, collapsed: true })).map((group) => group.id)),
  activate: async (tab_id) => void (await browser.tabs.update(tab_id, { active: true })),
  reload: (tab_id) => browser.tabs.reload(tab_id),
  group: browser_group_deps,
  copy: async (ctx, tab_ids, format) => {
    const is_private = await browser_copy_tabs_deps.is_private(ctx);
    const tabs = await Promise.all(tab_ids.map((id) => browser.tabs.get(id)));
    const listed = listed_tabs(tabs, { window_id: ctx.window_id!, incognito: is_private });
    await copy_listed_tabs(browser_copy_tabs_deps, ctx, listed, format, "", is_private);
  },
  attach: attach_many_tabs,
  bookmark: (ctx, tabs) => add_many_bookmarks(ctx, tabs),
};

const handler = make_tab_act_handler(browser_tab_act_deps);

define("tab.act", {
  label: "Act on the selected tabs",
  intent: `Act on the selected tabs. They are the tab range of tab visual mode, or a selection made with the mouse. With one tab selected it acts on that tab. Close takes at most ${CLOSE_LIMIT} tabs unless force is on, and moves the focus to the nearest tab outside first. Pin and mute turn every tab on when any is off, else every tab off. Reload reloads each tab. Copy writes the web tabs as a list. Group puts the tabs in a new untitled group and refuses a pinned tab. Attach moves the tabs to the window used last, as tab.attach does. Bookmark files each web tab that has no bookmark in the default folder.`,
  params: [
    {
      name: "action",
      type: "enum",
      values: ["close", "pin", "mute", "reload", "copy", "group", "attach", "bookmark"],
      value_labels: { close: "to close", pin: "to toggle the pin", mute: "to toggle the mute", reload: "to reload", copy: "to copy as a list", group: "to put in a new group", attach: "to move to another window", bookmark: "to bookmark" },
      description: { close: "Close the tabs.", pin: "Pin the tabs, or unpin them when all are pinned.", mute: "Mute the tabs, or unmute them when all are muted.", reload: "Reload the tabs.", copy: "Copy the web tabs as a list.", group: "Put the tabs in a new group.", attach: "Move the tabs to the window used last.", bookmark: "Bookmark the web tabs." },
    },
    {
      name: "format",
      type: "enum",
      values: LIST_FORMATS,
      default: "markdown",
      when: { action: ["copy"] },
      short: { plain: "u", org: "o", title: "t" },
      value_labels: { plain: "as plain addresses", org: "as an Org list", title: "as page titles" },
      description: { plain: "Copy the addresses, one per line.", org: "Copy an Org list.", title: "Copy the titles, one per line." },
    },
    { name: "force", type: "bool", default: false, when: { action: ["close"] }, description: `Close more than ${CLOSE_LIMIT} tabs.` },
  ],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  modes: ["normal", "tab_visual"],
  run: (ctx, args) => handler(ctx, args),
});


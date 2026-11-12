import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { find_group } from "../shared/group_name.ts";
import { browser_group_deps, group_tabs, set_group, ungroup_tabs } from "../background/tab_actions.ts";
import type { GroupDeps } from "../background/tab_actions.ts";
import { require_tab_id } from "./open_target.ts";

export type GroupInfo = { id: number; title: string; collapsed: boolean };

export type GroupedTab = { id: number; index: number; group_id: number };

export type TabGroupDeps = GroupDeps & {
  groups_in_window: (window_id: number) => Promise<GroupInfo[]>;
  tabs_in_window: (window_id: number) => Promise<GroupedTab[]>;
  activate: (tab_id: number) => Promise<void>;
};

// The colors Firefox offers for a tab group, as `tabGroups.Color` lists them.
export const GROUP_COLORS = ["blue", "cyan", "grey", "green", "orange", "pink", "purple", "red", "yellow"] as const;

// A group's place is the order of its first tab. A tab in no group sits between the groups before and after it, so `next` from it
// lands on the first group after it and `prev` on the last group before it.
export function pick_group_stop(stops: GroupedTab[], current: GroupedTab, steps: number): GroupedTab | undefined {
  if (stops.length === 0) return undefined;
  const own_rank = stops.findIndex((stop) => stop.group_id === current.group_id);
  const before = stops.filter((stop) => stop.index < current.index).length;
  const target = own_rank >= 0 ? own_rank + steps : steps > 0 ? before + steps - 1 : before + steps;
  return stops[((target % stops.length) + stops.length) % stops.length];
}

// Every command acts on the line's own tab and that tab's group. Marked tabs are not passed to commands, so there is no many-tab form yet.
export function make_tab_group_handlers(deps: TabGroupDeps) {
  async function group_of_current(ctx: CommandContext): Promise<GroupInfo> {
    const [info] = await deps.tab_infos([require_tab_id(ctx)]);
    if (!info) throw new RuntimeRefusal("the active tab is gone");
    const group = (await deps.groups_in_window(info.window_id)).find((candidate) => candidate.id === info.group_id);
    if (!group) throw new RuntimeRefusal("the tab is in no group");
    return group;
  }

  const collapse_to = async (ctx: CommandContext, collapsed: (group: GroupInfo) => boolean) => {
    const group = await group_of_current(ctx);
    await set_group(deps, group.id, { collapsed: collapsed(group) });
  };

  // Collapsed target: expand it first, so focus lands on a tab the strip shows. Firefox leaves the active tab of a collapsed group visible
  // but the rest hidden, and a collapsed group with focus inside reads as a bug.
  async function go_to_group(ctx: CommandContext, direction: 1 | -1, count: number): Promise<void> {
    const [info] = await deps.tab_infos([require_tab_id(ctx)]);
    if (!info) throw new RuntimeRefusal("the active tab is gone");
    const window_tabs = await deps.tabs_in_window(info.window_id);
    const current = window_tabs.find((tab) => tab.id === info.id);
    if (!current) throw new RuntimeRefusal("the active tab is gone");
    const sorted = [...window_tabs].sort((a, b) => a.index - b.index);
    const stops = sorted.filter((tab, at) => tab.group_id !== -1 && sorted.findIndex((other) => other.group_id === tab.group_id) === at);
    const target = pick_group_stop(stops, current, direction * count);
    if (!target) throw new RuntimeRefusal("this window has no tab groups");
    const group = (await deps.groups_in_window(info.window_id)).find((candidate) => candidate.id === target.group_id);
    if (group?.collapsed) await set_group(deps, group.id, { collapsed: false });
    await deps.activate(target.id);
  }

  return {
    add: async (ctx: CommandContext, args: { group: string }) => {
      const tab_id = require_tab_id(ctx);
      const text = args.group.trim();
      if (text === "") {
        await group_tabs(deps, [tab_id]);
        return;
      }
      const [info] = await deps.tab_infos([tab_id]);
      if (!info) throw new RuntimeRefusal("the active tab is gone");
      const match = find_group(await deps.groups_in_window(info.window_id), text);
      if (match.kind === "ambiguous") throw new RuntimeRefusal(`several groups are titled "${text}", name one with its id, for example "${text} #${match.ids[0]}"`);
      if (match.kind === "found") {
        if (info.group_id !== match.id) await group_tabs(deps, [tab_id], { group_id: match.id });
        return;
      }
      await group_tabs(deps, [tab_id], { title: text });
    },
    remove: async (ctx: CommandContext) => {
      await group_of_current(ctx);
      await ungroup_tabs(deps, [require_tab_id(ctx)]);
    },
    name: async (ctx: CommandContext, args: { title: string }) => {
      const group = await group_of_current(ctx);
      await set_group(deps, group.id, { title: args.title.trim() });
    },
    collapse: (ctx: CommandContext) => collapse_to(ctx, () => true),
    expand: (ctx: CommandContext) => collapse_to(ctx, () => false),
    toggle: (ctx: CommandContext) => collapse_to(ctx, (group) => !group.collapsed),
    color: async (ctx: CommandContext, args: { color: (typeof GROUP_COLORS)[number] }) => {
      const group = await group_of_current(ctx);
      await set_group(deps, group.id, { color: args.color });
    },
    next: (ctx: CommandContext, args: { count: number }) => go_to_group(ctx, 1, args.count),
    prev: (ctx: CommandContext, args: { count: number }) => go_to_group(ctx, -1, args.count),
  };
}

export const browser_tab_group_deps: TabGroupDeps = {
  ...browser_group_deps,
  tabs_in_window: async (window_id) => (await browser.tabs.query({ windowId: window_id })).map((tab) => ({ id: tab.id!, index: tab.index, group_id: tab.groupId ?? -1 })),
  activate: async (tab_id) => void (await browser.tabs.update(tab_id, { active: true })),
  groups_in_window: async (window_id) => (await browser.tabGroups.query({ windowId: window_id })).map((group) => ({ id: group.id, title: group.title ?? "", collapsed: group.collapsed })),
};

const handlers = make_tab_group_handlers(browser_tab_group_deps);

define("tabgroup.add", {
  label: "Add tab to group",
  intent: "Put the tab in a tab group. Name an existing group of this window to join it, or a new title to start a group with that title. With no name it starts an untitled group. Pinned tabs cannot join a group. When several groups share a title, name one with its id suffix, as the completion shows.",
  params: [{ name: "group", type: "string", rest: true, main: true, optional: true, values: { from: "groups" }, description: "Join this group, or start a group with this title." }],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handlers.add(ctx, args as { group: string }),
});

define("tabgroup.remove", {
  label: "Remove tab from group",
  intent: "Take the tab out of its tab group. The tab stays where it is.",
  bridge: false,
  runs_in: "background",
  run: (ctx) => handlers.remove(ctx),
});

define("tabgroup.name", {
  label: "Name tab group",
  intent: "Set the title of the tab group that holds the tab. An empty title clears it.",
  params: [{ name: "title", type: "string", rest: true, main: true, optional: true, description: "Set this title." }],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handlers.name(ctx, args as { title: string }),
});

define("tabgroup.collapse", {
  label: "Collapse tab group",
  intent: "Collapse the tab group that holds the tab.",
  bridge: false,
  runs_in: "background",
  run: (ctx) => handlers.collapse(ctx),
});

define("tabgroup.expand", {
  label: "Expand tab group",
  intent: "Expand the tab group that holds the tab.",
  bridge: false,
  runs_in: "background",
  run: (ctx) => handlers.expand(ctx),
});

define("tabgroup.toggle", {
  label: "Toggle tab group",
  intent: "Collapse the tab group, or expand it when collapsed.",
  bridge: false,
  runs_in: "background",
  run: (ctx) => handlers.toggle(ctx),
});

define("tabgroup.color", {
  label: "Color tab group",
  intent: "Set the color of the tab group that holds the tab.",
  params: [{ name: "color", type: "enum", values: [...GROUP_COLORS], description: Object.fromEntries(GROUP_COLORS.map((color) => [color, `Set the color to ${color}.`])) }],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handlers.color(ctx, args as { color: (typeof GROUP_COLORS)[number] }),
});

const group_count_param = { name: "count", type: "int", min: 1, default: 1, description: "Move over this many groups." } as const;

define("tabgroup.next", {
  label: "Next tab group",
  intent: "Switch to the next tab group. It goes to its first tab and wraps from the last group to the first. A collapsed target group expands. A count prefix moves over that many groups.",
  params: [group_count_param],
  bridge: false,
  runs_in: "background",
  count: { param: "count" },
  run: (ctx, args) => handlers.next(ctx, args as { count: number }),
});

define("tabgroup.prev", {
  label: "Previous tab group",
  intent: "Switch to the previous tab group. It goes to its first tab and wraps from the first group to the last. A collapsed target group expands. A count prefix moves over that many groups.",
  params: [group_count_param],
  bridge: false,
  runs_in: "background",
  count: { param: "count" },
  run: (ctx, args) => handlers.prev(ctx, args as { count: number }),
});

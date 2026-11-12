import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { find_group } from "../shared/group_name.ts";
import { browser_group_deps, group_tabs, set_group, ungroup_tabs } from "../background/tab_actions.ts";
import type { GroupDeps } from "../background/tab_actions.ts";
import { require_tab_id } from "./open_target.ts";

export type GroupInfo = { id: number; title: string; collapsed: boolean };

export type TabGroupDeps = GroupDeps & { groups_in_window: (window_id: number) => Promise<GroupInfo[]> };

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
  };
}

export const browser_tab_group_deps: TabGroupDeps = {
  ...browser_group_deps,
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

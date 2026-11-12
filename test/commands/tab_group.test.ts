import assert from "node:assert/strict";
import { test } from "node:test";
import { GROUP_COLORS, group_stops, make_tab_group_handlers, pick_group_stop } from "../../src/commands/tab_group.ts";
import type { GroupInfo, GroupedTab, TabGroupDeps } from "../../src/commands/tab_group.ts";
import type { GroupTabInfo } from "../../src/background/tab_actions.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import type { CommandContext } from "../../src/shared/command.ts";

function make(tab: GroupTabInfo, groups: GroupInfo[], window_tabs: GroupedTab[] = []) {
  const log: string[] = [];
  const deps: TabGroupDeps = {
    tab_infos: async () => [tab],
    group_window: async (id) => (groups.some((group) => group.id === id) ? tab.window_id : undefined),
    group: async (ids, group_id) => {
      log.push(`group ${ids.join(",")} ${group_id ?? "new"}`);
      return group_id ?? 50;
    },
    ungroup: async (ids) => void log.push(`ungroup ${ids.join(",")}`),
    update_group: async (id, props) => void log.push(`update ${id} ${JSON.stringify(props)}`),
    groups_in_window: async () => groups,
    tabs_in_window: async () => window_tabs,
    activate: async (id) => void log.push(`activate ${id}`),
  };
  return { handlers: make_tab_group_handlers(deps), log };
}
const ctx = { tab_id: 1, window_id: 5 } as CommandContext;
const tab = (extra: Partial<GroupTabInfo> = {}): GroupTabInfo => ({ id: 1, window_id: 5, pinned: false, group_id: -1, ...extra });
const refused = (pattern: RegExp) => (error: unknown) => error instanceof RuntimeRefusal && pattern.test(error.message);

test("add with no name starts an untitled group, with a new title starts a titled one", async () => {
  const { handlers, log } = make(tab(), []);
  await handlers.add(ctx, { group: "" });
  await handlers.add(ctx, { group: " Reading " });
  assert.deepEqual(log, ["group 1 new", "group 1 new", 'update 50 {"title":"Reading"}']);
});

test("add joins the group of that title or label, and does nothing for the group the tab is in", async () => {
  const groups = [{ id: 7, title: "Work", collapsed: false }, { id: 8, title: "Play", collapsed: false }, { id: 9, title: "Play", collapsed: false }];
  const one = make(tab(), groups);
  await one.handlers.add(ctx, { group: "Work" });
  await one.handlers.add(ctx, { group: "Play #9" });
  assert.deepEqual(one.log, ["group 1 7", "group 1 9"]);
  const inside = make(tab({ group_id: 7 }), groups);
  await inside.handlers.add(ctx, { group: "Work" });
  assert.deepEqual(inside.log, []);
});

test("add refuses an ambiguous bare title and names the id form", async () => {
  const groups = [{ id: 8, title: "Play", collapsed: false }, { id: 9, title: "Play", collapsed: false }];
  const { handlers, log } = make(tab(), groups);
  await assert.rejects(handlers.add(ctx, { group: "Play" }), refused(/several groups.*Play #8/));
  assert.deepEqual(log, []);
});

test("add refuses a pinned tab", async () => {
  const { handlers } = make(tab({ pinned: true }), []);
  await assert.rejects(handlers.add(ctx, { group: "" }), refused(/pinned/));
});

test("remove, name, collapse, expand and toggle act on the group of the tab", async () => {
  const { handlers, log } = make(tab({ group_id: 7 }), [{ id: 7, title: "Work", collapsed: false }]);
  await handlers.remove(ctx);
  await handlers.name(ctx, { title: " New " });
  await handlers.collapse(ctx);
  await handlers.expand(ctx);
  await handlers.toggle(ctx);
  assert.deepEqual(log, ["ungroup 1", 'update 7 {"title":"New"}', 'update 7 {"collapsed":true}', 'update 7 {"collapsed":false}', 'update 7 {"collapsed":true}']);
});

test("toggle expands a collapsed group", async () => {
  const { handlers, log } = make(tab({ group_id: 7 }), [{ id: 7, title: "", collapsed: true }]);
  await handlers.toggle(ctx);
  assert.deepEqual(log, ['update 7 {"collapsed":false}']);
});

test("a tab in no group refuses remove, name, collapse, expand and toggle", async () => {
  const { handlers, log } = make(tab(), [{ id: 7, title: "Work", collapsed: false }]);
  for (const run of [() => handlers.remove(ctx), () => handlers.name(ctx, { title: "x" }), () => handlers.collapse(ctx), () => handlers.expand(ctx), () => handlers.toggle(ctx)]) {
    await assert.rejects(run(), refused(/no group/));
  }
  assert.deepEqual(log, []);
});

test("the schema accepts a bare call and a free-text name for each command", () => {
  for (const id of ["tabgroup.add", "tabgroup.name"]) {
    const command = registry.get(id)!;
    assert.equal(check_args(command, {}, { search_engines: [], containers: [] }).ok, true, id);
    assert.equal(check_args(command, { [command.params![0]!.name]: "Some title" }, { search_engines: [], containers: [] }).ok, true, id);
  }
  for (const id of ["tabgroup.remove", "tabgroup.collapse", "tabgroup.expand", "tabgroup.toggle"]) assert.equal(check_args(registry.get(id)!, {}, { search_engines: [], containers: [] }).ok, true, id);
});

test("color sets the color of the group of the tab, and a tab in no group refuses", async () => {
  const inside = make(tab({ group_id: 7 }), [{ id: 7, title: "Work", collapsed: false }]);
  await inside.handlers.color(ctx, { color: "red" });
  assert.deepEqual(inside.log, ['update 7 {"color":"red"}']);
  await assert.rejects(make(tab(), []).handlers.color(ctx, { color: "red" }), refused(/no group/));
});

test("the color param holds the Firefox colors, and the validator rejects another", () => {
  const command = registry.get("tabgroup.color")!;
  const sources = { search_engines: [], containers: [] };
  for (const color of GROUP_COLORS) assert.equal(check_args(command, { color }, sources).ok, true, color);
  assert.equal(check_args(command, { color: "mauve" }, sources).ok, false);
  assert.equal(check_args(command, {}, sources).ok, false);
});

// Strip: a(1) a(2) loose(3) b(4) b(5) loose(6) c(7)
const strip: GroupedTab[] = [
  { id: 1, index: 0, group_id: 10 }, { id: 2, index: 1, group_id: 10 }, { id: 3, index: 2, group_id: -1 },
  { id: 4, index: 3, group_id: 20 }, { id: 5, index: 4, group_id: 20 }, { id: 6, index: 5, group_id: -1 }, { id: 7, index: 6, group_id: 30 },
];
const stops = group_stops(strip);
const picked = (current: number, steps: number) => pick_group_stop(stops, strip[current - 1]!, steps)?.id;

test("pick_group_stop moves between groups, wraps, and starts from a tab in no group", () => {
  assert.equal(picked(2, 1), 4);
  assert.equal(picked(5, 2), 1);
  assert.equal(picked(1, -1), 7);
  assert.equal(picked(3, 1), 4);
  assert.equal(picked(3, -1), 1);
  assert.equal(picked(6, 1), 7);
  assert.equal(picked(6, -2), 1);
  assert.equal(pick_group_stop([], strip[0]!, 1), undefined);
});

test("next and prev focus the first tab of the target group, and expand a collapsed one", async () => {
  const groups = [{ id: 10, title: "", collapsed: false }, { id: 20, title: "", collapsed: true }, { id: 30, title: "", collapsed: false }];
  const next = make(tab({ id: 1, group_id: 10 }), groups, strip);
  await next.handlers.next(ctx, { count: 1 });
  assert.deepEqual(next.log, ['update 20 {"collapsed":false}', "activate 4"]);
  const prev = make(tab({ id: 1, group_id: 10 }), groups, strip);
  await prev.handlers.prev(ctx, { count: 1 });
  assert.deepEqual(prev.log, ["activate 7"]);
});

test("next with a count skips groups, and a window with no group refuses", async () => {
  const groups = [{ id: 10, title: "", collapsed: false }, { id: 20, title: "", collapsed: false }, { id: 30, title: "", collapsed: false }];
  const { handlers, log } = make(tab({ group_id: 10 }), groups, strip);
  await handlers.next(ctx, { count: 2 });
  assert.deepEqual(log, ["activate 7"]);
  const none = make(tab(), [], [{ id: 1, index: 0, group_id: -1 }]);
  await assert.rejects(none.handlers.next(ctx, { count: 1 }), refused(/no tab groups/));
  await assert.rejects(none.handlers.prev(ctx, { count: 1 }), refused(/no tab groups/));
});

test("group_stops lists the first tab of each group in strip order, whatever the input order", () => {
  assert.deepEqual(group_stops([...strip].reverse()).map((t) => t.id), [1, 4, 7]);
});

const open_groups = [{ id: 10, title: "", collapsed: false }, { id: 20, title: "", collapsed: false }, { id: 30, title: "", collapsed: false }];

test("next and prev from an ungrouped tab take the group after and the group before it", async () => {
  const next = make(tab({ id: 3 }), open_groups, strip);
  await next.handlers.next(ctx, { count: 1 });
  assert.deepEqual(next.log, ["activate 4"]);
  const prev = make(tab({ id: 3 }), open_groups, strip);
  await prev.handlers.prev(ctx, { count: 1 });
  assert.deepEqual(prev.log, ["activate 1"]);
});

test("a pinned tab sits before the groups, so next takes the first group and prev the last", async () => {
  const pinned_strip: GroupedTab[] = [{ id: 9, index: 0, group_id: -1 }, ...strip.map((t) => ({ ...t, index: t.index + 1 }))];
  const next = make(tab({ id: 9, pinned: true }), open_groups, pinned_strip);
  await next.handlers.next(ctx, { count: 1 });
  const prev = make(tab({ id: 9, pinned: true }), open_groups, pinned_strip);
  await prev.handlers.prev(ctx, { count: 1 });
  assert.deepEqual([next.log, prev.log], [["activate 1"], ["activate 7"]]);
});

test("a count above the group count wraps around", async () => {
  const next = make(tab({ id: 1, group_id: 10 }), open_groups, strip);
  await next.handlers.next(ctx, { count: 4 });
  const prev = make(tab({ id: 1, group_id: 10 }), open_groups, strip);
  await prev.handlers.prev(ctx, { count: 4 });
  assert.deepEqual([next.log, prev.log], [["activate 4"], ["activate 7"]]);
});

test("with one collapsed group that holds the tab, next expands it and focuses its first tab", async () => {
  const only = [{ id: 1, index: 0, group_id: 10 }, { id: 2, index: 1, group_id: 10 }];
  const { handlers, log } = make(tab({ id: 2, group_id: 10 }), [{ id: 10, title: "", collapsed: true }], only);
  await handlers.next(ctx, { count: 1 });
  assert.deepEqual(log, ['update 10 {"collapsed":false}', "activate 1"]);
});

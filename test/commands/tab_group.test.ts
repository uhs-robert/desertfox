import assert from "node:assert/strict";
import { test } from "node:test";
import { make_tab_group_handlers } from "../../src/commands/tab_group.ts";
import type { GroupInfo, TabGroupDeps } from "../../src/commands/tab_group.ts";
import type { GroupTabInfo } from "../../src/background/tab_actions.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import type { CommandContext } from "../../src/shared/command.ts";

function make(tab: GroupTabInfo, groups: GroupInfo[]) {
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

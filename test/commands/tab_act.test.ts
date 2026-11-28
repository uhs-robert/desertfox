import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOSE_LIMIT, make_tab_act_handler } from "../../src/commands/tab_act.ts";
import type { ActTab, TabActDeps } from "../../src/commands/tab_act.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import "../../src/background/command_modules.ts";

const ctx = { tab_id: 3, window_id: 5 } as CommandContext;
const tab = (id: number, over: Partial<ActTab> = {}): ActTab => ({ id, index: id - 1, active: false, pinned: false, muted: false, hidden: false, group_id: -1, url: `https://t${id}.test/`, title: `T${id}`, ...over });

function make(window_tabs: ActTab[], selected_ids: number[], collapsed: number[] = []) {
  const log: string[] = [];
  const deps: TabActDeps = {
    selected_tabs: async () => window_tabs.filter((one) => selected_ids.includes(one.id)),
    window_tabs: async () => window_tabs,
    collapsed_group_ids: async () => new Set(collapsed),
    activate: async (id) => void log.push(`activate ${id}`),
    reload: async (id) => void log.push(`reload ${id}`),
    set_muted: async (ids, muted) => void log.push(`mute ${ids.join(",")} ${muted}`),
    set_pinned: async (ids, pinned) => void log.push(`pin ${ids.join(",")} ${pinned}`),
    remove: async (ids) => void log.push(`remove ${ids.join(",")}`),
    group: {
      tab_infos: async (ids) => ids.map((id) => ({ id, window_id: 5, pinned: window_tabs.find((one) => one.id === id)!.pinned, group_id: -1 })),
      group_window: async () => 5,
      group: async (ids) => (log.push(`group ${ids.join(",")}`), 50),
      ungroup: async () => {},
      update_group: async () => {},
    },
    copy: async (_ctx, ids, format) => void log.push(`copy ${ids.join(",")} ${format}`),
    attach: async (_ctx, ids) => void log.push(`attach ${ids.join(",")}`),
    bookmark: async (_ctx, tabs) => void log.push(`bookmark ${tabs.map((one) => one.id).join(",")}`),
  };
  return { run: make_tab_act_handler(deps), log };
}

const strip = (count: number, active_id = 3) => Array.from({ length: count }, (_, at) => tab(at + 1, { active: at + 1 === active_id }));
const refused = (pattern: RegExp) => (error: unknown) => error instanceof RuntimeRefusal && pattern.test(error.message);

test("pin turns every tab on when any is off, else every tab off", async () => {
  const mixed = make(strip(5).map((one) => (one.id === 2 ? { ...one, pinned: true } : one)), [2, 3]);
  await mixed.run(ctx, { action: "pin" });
  const all_pinned = make(strip(5).map((one) => ({ ...one, pinned: true })), [2, 3]);
  await all_pinned.run(ctx, { action: "pin" });
  assert.deepEqual([...mixed.log, ...all_pinned.log], ["pin 2,3 true", "pin 2,3 false"]);
});

test("mute follows the same any-off rule", async () => {
  const mixed = make(strip(4).map((one) => (one.id === 1 ? { ...one, muted: true } : one)), [1, 2]);
  await mixed.run(ctx, { action: "mute" });
  assert.deepEqual(mixed.log, ["mute 1,2 true"]);
});

test("reload, copy, attach and bookmark take every selected tab, copy in the format asked for", async () => {
  const { run, log } = make(strip(4), [2, 3, 4]);
  for (const action of ["reload", "attach", "bookmark"] as const) await run(ctx, { action });
  await run(ctx, { action: "copy" });
  await run(ctx, { action: "copy", format: "org" });
  assert.deepEqual(log, ["reload 2", "reload 3", "reload 4", "attach 2,3,4", "bookmark 2,3,4", "copy 2,3,4 markdown", "copy 2,3,4 org"]);
});

test("group makes one group of the selection and refuses a pinned tab", async () => {
  const { run, log } = make(strip(4), [2, 3]);
  await run(ctx, { action: "group" });
  assert.deepEqual(log, ["group 2,3"]);
  const pinned = make(strip(4).map((one) => (one.id === 2 ? { ...one, pinned: true } : one)), [2, 3]);
  await assert.rejects(pinned.run(ctx, { action: "group" }), refused(/pinned/));
});

test("one selected tab is acted on as a range of one", async () => {
  const { run, log } = make(strip(4), [3]);
  await run(ctx, { action: "mute" });
  assert.deepEqual(log, ["mute 3 true"]);
});

test("no selected tab refuses", async () => {
  await assert.rejects(make(strip(3), []).run(ctx, { action: "pin" }), refused(/No tabs selected/));
});

test("close moves the focus to the nearest tab outside the range, then closes the range", async () => {
  const { run, log } = make(strip(6), [3, 4, 5]);
  await run(ctx, { action: "close" });
  assert.deepEqual(log, ["activate 2", "remove 3", "remove 4", "remove 5"]);
});

test("the focus skips a hidden tab and a tab of a collapsed group when another tab is outside", async () => {
  const tabs = strip(6).map((one) => (one.id === 2 ? { ...one, hidden: true } : one.id === 6 ? { ...one, group_id: 9 } : one));
  const { run, log } = make(tabs, [3, 4], [9]);
  await run(ctx, { action: "close" });
  assert.deepEqual(log.slice(0, 1), ["activate 5"]);
  const only_collapsed = make(tabs.map((one) => (one.id === 5 ? { ...one, group_id: 9 } : one)).filter((one) => one.id !== 1), [3, 4], [9]);
  await only_collapsed.run(ctx, { action: "close" });
  assert.deepEqual(only_collapsed.log.slice(0, 1), ["activate 5"], "a collapsed tab over a hidden one");
});

test("close takes the limit and refuses one tab more, naming the count", async () => {
  const at_limit = make(strip(CLOSE_LIMIT + 5), Array.from({ length: CLOSE_LIMIT }, (_, at) => at + 1), []);
  await at_limit.run({ ...ctx, tab_id: 1 }, { action: "close" });
  assert.equal(at_limit.log.length, CLOSE_LIMIT + 1);
  const over = make(strip(CLOSE_LIMIT + 5), Array.from({ length: CLOSE_LIMIT + 1 }, (_, at) => at + 1));
  await assert.rejects(over.run(ctx, { action: "close" }), refused(new RegExp(`${CLOSE_LIMIT + 1} tabs`)));
  assert.deepEqual(over.log, []);
  const forced = make(strip(CLOSE_LIMIT + 5), Array.from({ length: CLOSE_LIMIT + 1 }, (_, at) => at + 1));
  await forced.run(ctx, { action: "close", force: true });
  assert.equal(forced.log.length, CLOSE_LIMIT + 2);
});

test("close refuses a range that holds every tab of the window", async () => {
  const { run, log } = make(strip(3), [1, 2, 3]);
  await assert.rejects(run(ctx, { action: "close" }), refused(/every tab/));
  assert.deepEqual(log, []);
});

test("the schema takes each action and a format only with copy", () => {
  const command = registry.get("tab.act")!;
  for (const action of ["close", "pin", "mute", "reload", "copy", "group", "attach", "bookmark"]) assert.equal(check_args(command, { action }).ok, true, action);
  assert.equal(check_args(command, { action: "copy", format: "org" }).ok, true);
  assert.equal(check_args(command, { action: "pin", format: "org" }).ok, false);
  assert.equal(check_args(command, { action: "close", force: true }).ok, true);
  assert.equal(check_args(command, { action: "pin", force: true }).ok, false);
});

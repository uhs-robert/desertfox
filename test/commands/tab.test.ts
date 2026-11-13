import assert from "node:assert/strict";
import { test } from "node:test";
import {
  focus_index_after_close,
  goto_target_index,
  make_tab_handlers,
  pick_tab,
  next_audible_index,
  side_tab_ids,
  wrap_index,
  type TabDeps,
  type TabInfo,
} from "../../src/commands/tab.ts";
import { create_previous_tabs } from "../../src/background/previous_tab.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import type { ListedTab } from "../../src/background/complete_items.ts";
import type { CommandContext } from "../../src/shared/command.ts";

function make_tabs(count: number, overrides: Partial<TabInfo>[] = []): TabInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    id: 100 + index,
    index,
    pinned: false,
    split_id: -1,
    // Every fixture tab counts as active unless a test says otherwise, so the focus rules apply to whichever tab a test closes.
    active: true,
    audible: false,
    muted: false,
    url: `https://site${index}.test/`,
    cookie_store_id: "firefox-default",
    ...overrides[index],
  }));
}

function make_fake(tabs: TabInfo[], containers: Record<string, string> = {}) {
  const log: string[] = [];
  const deps: TabDeps = {
    tabs_in_window: async () => tabs,
    activate: async (id) => void log.push(`activate ${id}`),
    set_pinned: async (id, pinned) => void log.push(`pin ${id} ${pinned}`),
    set_muted: async (id, muted) => void log.push(`mute ${id} ${muted}`),
    move: async (id, index) => void log.push(`move ${id} ${index}`),
    duplicate: async (id) => void log.push(`dup ${id}`),
    remove: async (ids) => void log.push(`remove ${ids.join(",")}`),
    detach_to_new_window: async (id) => void log.push(`detach ${id}`),
    open_tab: async (open) => void log.push(`open ${open.url} ${open.index} ${open.cookie_store_id} ${open.pinned}`),
    restore_last_closed_tab: async () => {
      log.push("restore");
      return true;
    },
    find_container_store_id: async (name) => containers[name],
    listed_tabs: async () => [],
    focus_window: async (id) => void log.push(`focus ${id}`),
    previous_tab_of: async () => undefined,
    discard: {} as TabDeps["discard"],
    toast: async () => {},
  };
  return { handlers: make_tab_handlers(deps), log, deps };
}

const ctx_at = (tab_id: number): CommandContext => ({ tab_id, window_id: 1, frame_id: 0, mode: "normal" });

test("wrap_index wraps both ways", () => {
  assert.equal(wrap_index(-1, 4), 3);
  assert.equal(wrap_index(4, 4), 0);
});

test("goto_target_index counts from 1, negatives from the end, and clamps", () => {
  assert.equal(goto_target_index(1, 5), 0);
  assert.equal(goto_target_index(5, 5), 4);
  assert.equal(goto_target_index(9, 5), 4);
  assert.equal(goto_target_index(-1, 5), 4);
  assert.equal(goto_target_index(-2, 5), 3);
  assert.equal(goto_target_index(-9, 5), 0);
});

test("tab.goto with index 0 goes to the next tab, wrapping", async () => {
  const { handlers, log } = make_fake(make_tabs(3));
  await handlers.goto(ctx_at(102), { index: 0 });
  assert.deepEqual(log, ["activate 100"]);
});

test("tab.goto with an index picks that tab", async () => {
  const { handlers, log } = make_fake(make_tabs(4));
  await handlers.goto(ctx_at(100), { index: -1 });
  assert.deepEqual(log, ["activate 103"]);
});

test("next and prev wrap", async () => {
  const { handlers, log } = make_fake(make_tabs(3));
  await handlers.next(ctx_at(102));
  await handlers.prev(ctx_at(100));
  assert.deepEqual(log, ["activate 100", "activate 102"]);
});

const move_args = (over: Partial<{ tab: string; offset: number }> = {}) => ({ tab: "", offset: 0, ...over });

test("tab.move --offset clamps at both ends", async () => {
  const { handlers, log } = make_fake(make_tabs(4));
  await handlers.move(ctx_at(102), move_args({ offset: 5 }));
  await handlers.move(ctx_at(101), move_args({ offset: -5 }));
  await handlers.move(ctx_at(101), move_args({ offset: 1 }));
  assert.deepEqual(log, ["move 102 3", "move 101 0", "move 101 2"]);
});

test("tab.move with a place number takes that place, negative counts from the end, out of range clamps", async () => {
  const { handlers, log } = make_fake(make_tabs(4));
  await handlers.move(ctx_at(100), move_args({ tab: "3" }));
  await handlers.move(ctx_at(100), move_args({ tab: "-1" }));
  await handlers.move(ctx_at(103), move_args({ tab: "-2" }));
  await handlers.move(ctx_at(100), move_args({ tab: "9" }));
  await handlers.move(ctx_at(103), move_args({ tab: "-9" }));
  assert.deepEqual(log, ["move 100 2", "move 100 3", "move 103 2", "move 100 3", "move 103 0"]);
});

// Six tabs by default, the second and third split: Firefox moves the pair as one unit, so these moves never touch one tab of it.
const split_strip = (count = 6, start = 1) => make_tabs(count, Array.from({ length: count }, (_, index) => (index === start || index === start + 1 ? { split_id: 7 } : {})));

test("tab.move of a split tab moves the pair by its first tab, whichever tab the key came from", async () => {
  const { handlers, log } = make_fake(split_strip());
  await handlers.move(ctx_at(102), move_args({ offset: -1 }));
  await handlers.move(ctx_at(101), move_args({ tab: "4" }));
  assert.deepEqual(log, ["move 101 0", "move 101 3"]);
});

test("tab.move one step right of a split tab moves the tab after the pair over it, because a move onto the partner swaps", async () => {
  const { handlers, log } = make_fake(split_strip());
  await handlers.move(ctx_at(101), move_args({ offset: 1 }));
  assert.deepEqual(log, ["move 103 1"]);
});

test("tab.move one step left of the tab after a pair aims at the pair's second place, which Firefox reads as in front of the pair", async () => {
  const { handlers, log } = make_fake(split_strip());
  await handlers.move(ctx_at(103), move_args({ offset: -1 }));
  assert.deepEqual(log, ["move 103 2"]);
});

test("closing the active second pane gives the focus to the other pane even when a tab follows the pair", async () => {
  const { handlers, log } = make_fake(split_strip());
  await handlers.close(ctx_at(102), { side: "none" });
  await handlers.close(ctx_at(101), { side: "focus_previous" });
  assert.deepEqual(log, ["activate 101", "remove 102", "activate 102", "remove 101"]);
});

test("tab.move of a split tab stops with the whole pair inside the strip and does nothing at its own place", async () => {
  const { handlers, log } = make_fake(split_strip());
  await handlers.move(ctx_at(101), move_args({ offset: 9 }));
  await handlers.move(ctx_at(101), move_args({ offset: 0 }));
  await handlers.move(ctx_at(102), move_args({ offset: -9 }));
  assert.deepEqual(log, ["move 101 4", "move 101 0"]);
  const at_end = make_fake(split_strip(6, 4));
  await at_end.handlers.move(ctx_at(104), move_args({ offset: 1 }));
  assert.deepEqual(at_end.log, []);
});

test("tab.move with a tab name takes the picked tab's place", async () => {
  const { handlers, log, deps } = make_fake(make_tabs(4));
  deps.listed_tabs = async () => [listed(100, 1, "Mail"), listed(101, 2, "GitHub"), listed(103, 4, "Docs")];
  await handlers.move(ctx_at(100), move_args({ tab: "github" }));
  await handlers.move(ctx_at(103), move_args({ tab: "2 GitHub" }));
  await handlers.move(ctx_at(102), move_args({ tab: "docs" }));
  assert.deepEqual(log, ["move 100 1", "move 103 1", "move 102 3"]);
});

test("tab.move keeps each tab on its own side of the pinned boundary", async () => {
  const { handlers, log, deps } = make_fake(make_tabs(5, [{ pinned: true }, { pinned: true }]));
  deps.listed_tabs = async () => [listed(100, 1, "Pinned")];
  await handlers.move(ctx_at(103), move_args({ tab: "1" }));
  await handlers.move(ctx_at(103), move_args({ tab: "pinned" }));
  await handlers.move(ctx_at(103), move_args({ offset: -9 }));
  await handlers.move(ctx_at(100), move_args({ tab: "-1" }));
  await handlers.move(ctx_at(100), move_args({ offset: 9 }));
  assert.deepEqual(log, ["move 103 2", "move 103 2", "move 103 2", "move 100 1", "move 100 1"]);
});

test("tab.move onto the current tab keeps its place", async () => {
  const { handlers, log, deps } = make_fake(make_tabs(3));
  deps.listed_tabs = async () => [listed(101, 2, "GitHub")];
  await handlers.move(ctx_at(101), move_args({ tab: "github" }));
  assert.deepEqual(log, ["move 101 1"]);
});

test("tab.move refuses a picked tab in another window", async () => {
  const { handlers, log, deps } = make_fake(make_tabs(3));
  deps.listed_tabs = async () => [{ ...listed(200, 1, "Elsewhere"), window_id: 2 }];
  await assert.rejects(handlers.move(ctx_at(100), move_args({ tab: "elsewhere" })), /another window/);
  assert.deepEqual(log, []);
});

test("tab.move with a tab and an offset uses the tab", async () => {
  const { handlers, log } = make_fake(make_tabs(4));
  await handlers.move(ctx_at(100), move_args({ tab: "4", offset: 1 }));
  assert.deepEqual(log, ["move 100 3"]);
});

test("focus after close follows the direction and falls back at the edges", () => {
  assert.equal(focus_index_after_close(2, 5, "next"), 3);
  assert.equal(focus_index_after_close(2, 5, "previous"), 1);
  assert.equal(focus_index_after_close(0, 5, "previous"), 1);
  assert.equal(focus_index_after_close(4, 5, "next"), 3);
  assert.equal(focus_index_after_close(0, 1, "previous"), undefined);
});

test("tab.close side=focus_previous activates the previous tab, then closes", async () => {
  const { handlers, log } = make_fake(make_tabs(3));
  await handlers.close(ctx_at(101), { side: "focus_previous" });
  assert.deepEqual(log, ["activate 100", "remove 101"]);
});

test("tab.close on a tab that is no longer active removes it without moving focus", async () => {
  const { handlers, log } = make_fake(make_tabs(3, [{}, { active: false }]));
  await handlers.close(ctx_at(101), { side: "focus_previous" });
  await handlers.close(ctx_at(101), { side: "site" });
  assert.deepEqual(log, ["remove 101", "remove 101"]);
});

test("tab.close on the last tab closes without activating", async () => {
  const { handlers, log } = make_fake(make_tabs(1));
  await handlers.close(ctx_at(100), { side: "none" });
  assert.deepEqual(log, ["remove 100"]);
});

test("tab.close with all_before or all_after keeps this tab and closes the unpinned ones on that side", async () => {
  const { handlers, log } = make_fake(make_tabs(5, [{ pinned: true }]));
  await handlers.close(ctx_at(102), { side: "all_before" });
  await handlers.close(ctx_at(102), { side: "all_after" });
  assert.deepEqual(log, ["remove 101", "remove 103,104"]);
});

test("side_tab_ids skips pinned tabs and the current tab", () => {
  const tabs = make_tabs(5, [{ pinned: true }]);
  assert.deepEqual(side_tab_ids(tabs, 2, "before"), [101]);
  assert.deepEqual(side_tab_ids(tabs, 2, "after"), [103, 104]);
});

test("next_audible_index wraps, and is undefined when nothing plays", () => {
  const tabs = make_tabs(4, [{ audible: true }]);
  assert.equal(next_audible_index(tabs, 2), 0);
  assert.equal(next_audible_index(make_tabs(3), 1), undefined);
});

test("tab.detach refuses for the only tab", async () => {
  const { handlers } = make_fake(make_tabs(1));
  await assert.rejects(handlers.detach(ctx_at(100)), /only tab/);
});

test("pin and mute toggle from the current state", async () => {
  const { handlers, log } = make_fake(make_tabs(2, [{ pinned: true }, { muted: false }]));
  await handlers.pin(ctx_at(100));
  await handlers.mute(ctx_at(101));
  assert.deepEqual(log, ["pin 100 false", "mute 101 true"]);
});

test("reopen_in_container opens at the same index, then closes the old tab", async () => {
  const { handlers, log } = make_fake(make_tabs(3), { Family: "container-1" });
  await handlers.reopen_in_container(ctx_at(101), { container: "Family" });
  assert.deepEqual(log, ["open https://site1.test/ 1 container-1 false", "remove 101"]);
});

test("reopen_in_container default means no container", async () => {
  const { handlers, log } = make_fake(make_tabs(2));
  await handlers.reopen_in_container(ctx_at(100), { container: "default" });
  assert.equal(log[0], "open https://site0.test/ 0 firefox-default false");
});

test("reopen_in_container refuses an unknown container and keeps the tab", async () => {
  const { handlers, log } = make_fake(make_tabs(2));
  await assert.rejects(handlers.reopen_in_container(ctx_at(100), { container: "Nope" }), /Nope/);
  assert.deepEqual(log, []);
});

test("a missing active tab refuses", async () => {
  const { handlers } = make_fake(make_tabs(2));
  await assert.rejects(handlers.next({ tab_id: undefined, window_id: 1, frame_id: 0, mode: "normal" }), /No tab/);
});

const listed = (id: number, number: number, title: string, window_id = 1, url = `https://t${id}.test/`): ListedTab => ({ id, number, title, url, window_id });
const LISTED = [listed(11, 1, "Mail"), listed(12, 2, "GitHub"), listed(13, 3, "GitHub Gist"), listed(14, 4, "Docs")];

test("pick_tab takes the tab at the number in the tab bar", () => {
  assert.equal(pick_tab(LISTED, "3 GitHub Gist", 1).id, 13);
  assert.equal(pick_tab(LISTED, "3", 1).id, 13);
});

test("the number wins when the title changed since the pick", () => {
  assert.equal(pick_tab(LISTED, "4 GitHub", 1).id, 14);
});

test("a number with no tab there falls back to the text", () => {
  assert.equal(pick_tab([listed(1, 1, "2024 plans")], "2024 plans", 1).id, 1);
});

test("a bare number with no tab at that place is refused, not matched against titles and addresses", () => {
  const five = [1, 2, 3, 4, 5].map((number) => listed(number, number, `Page 9 of ${number}`, 1, `https://site9.test/${number}`));
  assert.throws(() => pick_tab(five, "9", 1), /no tab at place 9/);
});

test("pick_tab takes the best match on title and address", () => {
  assert.equal(pick_tab(LISTED, "mail", 1).id, 11);
  assert.equal(pick_tab(LISTED, "t14", 1).id, 14);
});

test("an equal tie is refused with both tabs named, and a number settles it", () => {
  const twins = [listed(1, 1, "News"), listed(2, 5, "News")];
  assert.throws(() => pick_tab(twins, "news", 1), /"1 News" and "5 News" equally, use a number/);
  assert.equal(pick_tab(twins, "5 News", 1).id, 2);
});

test("no match is an error", () => {
  assert.throws(() => pick_tab(LISTED, "zzzz", 1), /no tab matches "zzzz"/);
});

test("with several windows listed the title picks among tabs at one number, else the line's window", () => {
  const windows = [listed(1, 2, "Home", 1), listed(2, 2, "Work", 2), listed(3, 2, "Plans", 3)];
  assert.equal(pick_tab(windows, "2 Work", 1).id, 2);
  assert.equal(pick_tab(windows, "2 gone", 1).id, 1);
  assert.throws(() => pick_tab(windows, "2 gone", 9), /tab 2 exists in several windows: "Home" and "Work" and "Plans"/);
});

test("tab.switch activates the picked tab, and focuses its window only when it is another one", async () => {
  const { handlers, log, set_listed } = make_switch_fake();
  await handlers.switch(ctx_at(11), { tab: "2 GitHub" });
  assert.deepEqual(log, ["activate 12"]);
  log.length = 0;
  set_listed([listed(21, 1, "Elsewhere", 2)]);
  await handlers.switch(ctx_at(11), { tab: "elsewhere" });
  assert.deepEqual(log, ["activate 21", "focus 2"]);
});

test("tab.switch with a tie changes nothing", async () => {
  const { handlers, log, set_listed } = make_switch_fake();
  set_listed([listed(1, 1, "News"), listed(2, 2, "News")]);
  await assert.rejects(handlers.switch(ctx_at(1), { tab: "news" }), /equally/);
  assert.deepEqual(log, []);
});

function make_switch_fake() {
  let tabs = LISTED;
  const fake = make_fake([]);
  const deps: TabDeps = { ...fake.deps, listed_tabs: async () => tabs };
  return { handlers: make_tab_handlers(deps), log: fake.log, set_listed: (next: ListedTab[]) => void (tabs = next) };
}

// The unload and load commands over a fake `set_unloaded`: the log shows which ids reach it and with what option.
function make_unload(tabs: TabInfo[], listed_tabs: ListedTab[] = []) {
  const { deps, log } = make_fake(tabs);
  const toast_tabs: (number | undefined)[] = [];
  const states = new Map(tabs.map((tab) => [tab.id, { discarded: false, active: tab.id === 100 }]));
  deps.listed_tabs = async () => listed_tabs;
  deps.toast = async (ctx, kind, message) => void (log.push(`toast ${kind} ${message}`), toast_tabs.push(ctx.tab_id));
  deps.discard = {
    read_tab: async (id) => {
      const tab = tabs.find((candidate) => candidate.id === id);
      return tab && { id, window_id: 1, index: tab.index, audible: tab.audible, ...states.get(id)! };
    },
    tabs_in_window: async () => tabs.map((tab) => ({ id: tab.id, window_id: 1, index: tab.index, audible: tab.audible, ...states.get(tab.id)! })),
    alternate_of: async () => undefined,
    activate: async (id) => {
      log.push(`activate ${id}`);
      for (const [other, state] of states) state.active = other === id;
    },
    discard: async (id) => {
      log.push(`discard ${id}`);
      if (!states.get(id)!.active) states.get(id)!.discarded = true;
    },
    reload: async (id) => {
      log.push(`reload ${id}`);
      states.get(id)!.discarded = false;
    },
  };
  return { handlers: make_tab_handlers(deps), log, states, toast_tabs, deps };
}
const unload_args = (over: Partial<{ tab: string; side: "none" | "all_before" | "all_after" | "site"; count: number }> = {}) => ({ tab: "", side: "none" as const, count: 1, ...over });

test("tab.unload on the current tab switches to a loaded tab first, then discards, and reports", async () => {
  const { handlers, log } = make_unload(make_tabs(3));
  await handlers.unload(ctx_at(100), unload_args());
  assert.deepEqual(log, ["activate 101", "discard 100", "toast success unloaded 1 tab"]);
});

test("tab.unload by number or title unloads that tab and leaves focus alone", async () => {
  const listed_tabs = [listed(100, 1, "Mail"), listed(101, 2, "GitHub"), listed(102, 3, "Docs")];
  const { handlers, log } = make_unload(make_tabs(3), listed_tabs);
  await handlers.unload(ctx_at(100), unload_args({ tab: "3" }));
  await handlers.unload(ctx_at(100), unload_args({ tab: "github" }));
  assert.deepEqual(log, ["discard 102", "toast success unloaded 1 tab", "discard 101", "toast success unloaded 1 tab"]);
});

test("tab.unload refuses a tied title and refuses when nothing changed", async () => {
  const twins = [listed(100, 1, "News"), listed(101, 2, "News")];
  const { handlers } = make_unload(make_tabs(2), twins);
  await assert.rejects(handlers.unload(ctx_at(100), unload_args({ tab: "news" })), /equally/);
  const { handlers: audible } = make_unload(make_tabs(2, [{}, { audible: true }]), [listed(101, 2, "Music")]);
  await assert.rejects(audible.unload(ctx_at(100), unload_args({ tab: "2" })), /skipped 1 \(audible\)/);
});

test("tab.unload with all_after skips pinned and audible tabs and keeps the subject", async () => {
  const { handlers, log } = make_unload(make_tabs(5, [{}, {}, {}, { pinned: true }, { audible: true }]));
  await handlers.unload(ctx_at(100), unload_args({ side: "all_after" }));
  assert.deepEqual(log, ["discard 101", "discard 102", "toast warning unloaded 2 tabs, skipped 1 (audible)"]);
});

test("tab.unload with all_before from a later tab skips pinned tabs and switches off the current tab when it is in range", async () => {
  const { handlers, log } = make_unload(make_tabs(4, [{}, { pinned: true }, {}, {}]), [listed(103, 4, "Last")]);
  await handlers.unload(ctx_at(100), unload_args({ tab: "4", side: "all_before" }));
  assert.deepEqual(log, ["activate 101", "discard 100", "discard 102", "toast success unloaded 2 tabs"]);
});

test("tab.unload with count 3 unloads the subject and the two after it, skipping a pinned neighbor", async () => {
  const { handlers, log } = make_unload(make_tabs(5, [{}, { pinned: true }, {}, {}, {}]), [listed(100, 1, "A")]);
  await handlers.unload(ctx_at(100), unload_args({ tab: "1", count: 3 }));
  assert.deepEqual(log, ["activate 101", "discard 100", "discard 102", "toast success unloaded 2 tabs"]);
});

test("a named pinned tab unloads", async () => {
  const { handlers, log } = make_unload(make_tabs(3, [{}, { pinned: true }]), [listed(101, 2, "Pinned")]);
  await handlers.unload(ctx_at(100), unload_args({ tab: "2" }));
  assert.deepEqual(log, ["discard 101", "toast success unloaded 1 tab"]);
});

test("a partial result shows as a warning with the reasons", async () => {
  const { handlers, log } = make_unload(make_tabs(4, [{}, {}, { audible: true }, {}]));
  await handlers.unload(ctx_at(100), unload_args({ side: "all_after" }));
  assert.equal(log.at(-1), "toast warning unloaded 2 tabs, skipped 1 (audible)");
});

test("tab.load loads the named tab in place, and on a loaded current tab it refuses", async () => {
  const { handlers, log, states } = make_unload(make_tabs(3), [listed(102, 3, "Docs")]);
  states.get(102)!.discarded = true;
  await handlers.load(ctx_at(100), unload_args({ tab: "3" }));
  assert.deepEqual(log, ["reload 102", "toast success loaded 1 tab"]);
  await assert.rejects(handlers.load(ctx_at(100), unload_args()), /already loaded/);
});

test("tab.load with a side loads the unpinned unloaded tabs on that side and reports the loaded ones as skipped", async () => {
  const { handlers, log, states } = make_unload(make_tabs(4, [{}, {}, {}, { pinned: true }]));
  states.get(101)!.discarded = true;
  states.get(103)!.discarded = true;
  await handlers.load(ctx_at(100), unload_args({ side: "all_after" }));
  assert.deepEqual(log, ["reload 101", "toast warning loaded 1 tab, skipped 1 (already loaded)"]);
});

test("the result toast goes to the tab that is active after the switch, not the unloaded one", async () => {
  const { handlers, toast_tabs } = make_unload(make_tabs(3));
  await handlers.unload(ctx_at(100), unload_args());
  assert.deepEqual(toast_tabs, [101]);
});

test("the schema refuses a count below 1 before any handler runs", () => {
  for (const id of ["tab.unload", "tab.load"]) {
    for (const count of [0, -2]) {
      const result = check_args(registry.get(id)!, { count }, {});
      assert.deepEqual(result, { ok: false, error: `count expects a whole number, 1 or more, got ${count}` });
    }
    assert.equal(check_args(registry.get(id)!, { count: 1 }, {}).ok, true);
  }
});

// Tabs 0 and 1 are on github.com (one with www), 2 is pinned on github.com, 3 is docs.github.com, 4 is elsewhere.
const SITE_TABS = () =>
  make_tabs(5, [
    { url: "https://github.com/a" },
    { url: "https://www.github.com/b" },
    { url: "https://github.com/c", pinned: true },
    { url: "https://docs.github.com/" },
    { url: "https://example.org/" },
  ]);

test("tab.close with site focuses the nearest tab outside the site, then closes the unpinned tabs of the site", async () => {
  const { handlers, log } = make_fake(SITE_TABS());
  await handlers.close(ctx_at(101), { side: "site" });
  assert.deepEqual(log, ["activate 103", "remove 100,101"]);
});

test("tab.close with site on a pinned tab still closes that tab and keeps its pinned neighbors", async () => {
  const { handlers, log } = make_fake(SITE_TABS());
  await handlers.close(ctx_at(102), { side: "site" });
  assert.deepEqual(log, ["activate 103", "remove 100,101,102"]);
});

test("tab.close with site on a lone tab behaves like closing one tab", async () => {
  const { handlers, log } = make_fake(SITE_TABS());
  await handlers.close(ctx_at(104), { side: "site" });
  assert.deepEqual(log, ["activate 103", "remove 104"]);
});

test("tab.unload with site unloads the tab and the unpinned tabs of its site, skipping audible ones", async () => {
  const tabs = SITE_TABS();
  tabs[1] = { ...tabs[1]!, audible: true };
  const { handlers, log } = make_unload(tabs);
  await handlers.unload(ctx_at(100), unload_args({ side: "site" }));
  assert.deepEqual(log, ["activate 101", "discard 100", "toast warning unloaded 1 tab, skipped 1 (audible)"]);
});

test("tab.load with site loads every unloaded tab of the site", async () => {
  const { handlers, log, states } = make_unload(SITE_TABS());
  states.get(100)!.discarded = true;
  states.get(101)!.discarded = true;
  await handlers.load(ctx_at(100), unload_args({ side: "site" }));
  assert.deepEqual(log, ["reload 100", "reload 101", "toast success loaded 2 tabs"]);
});

test("a count is invalid with side=site for tab.unload and tab.load, and site is a valid side everywhere", () => {
  for (const id of ["tab.unload", "tab.load"]) {
    assert.equal(check_args(registry.get(id)!, { side: "site", count: 2 }, {}).ok, false);
    assert.equal(check_args(registry.get(id)!, { side: "site" }, {}).ok, true);
  }
  assert.equal(check_args(registry.get("tab.close")!, { side: "site" }, {}).ok, true);
});

test("tab.unload with site and a named tab in another window selects the site in the line's window", async () => {
  const line_tabs = SITE_TABS();
  const other_tab: TabInfo = { ...make_tabs(1)[0]!, id: 200, url: "https://github.com/z" };
  const listed_tabs = [{ ...listed(200, 9, "Other"), window_id: 2 }];
  const { handlers, log, deps } = make_unload(line_tabs, listed_tabs);
  deps.tabs_in_window = async (window_id) => (window_id === 2 ? [other_tab] : line_tabs);
  const read_tab = deps.discard.read_tab;
  deps.discard.read_tab = async (id) => (id === 200 ? { id, window_id: 2, index: 0, active: false, audible: false, discarded: false } : read_tab(id));
  const discard = deps.discard.discard;
  deps.discard.discard = async (id) => (id === 200 ? void log.push("discard 200") : discard(id));
  await handlers.unload(ctx_at(100), unload_args({ tab: "9", side: "site" }));
  assert.deepEqual(log.filter((entry) => entry.startsWith("discard")).sort(), ["discard 100", "discard 101", "discard 200"].sort());
});

test("tab.alternate activates the previous tab of the window", async () => {
  const { handlers, log, deps } = make_fake(make_tabs(3));
  deps.previous_tab_of = async (window_id) => (window_id === 1 ? 101 : undefined);
  await handlers.alternate(ctx_at(102));
  assert.deepEqual(log, ["activate 101"]);
});

test("tab.alternate refuses with no previous tab, or one that is gone or current", async () => {
  for (const previous of [undefined, 999, 102]) {
    const { handlers, log, deps } = make_fake(make_tabs(3));
    deps.previous_tab_of = async () => previous;
    await assert.rejects(handlers.alternate(ctx_at(102)), /no previous tab/);
    assert.deepEqual(log, []);
  }
});

test("tab.alternate pressed at once after a switch sees that switch", async () => {
  const data = new Map<string, unknown>();
  const slow_storage = {
    get: async (key: string) => (data.has(key) ? { [key]: data.get(key) } : {}),
    set: async (items: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      Object.entries(items).forEach(([key, value]) => data.set(key, value));
    },
    remove: async (key: string) => void data.delete(key),
  };
  const tracker = create_previous_tabs(slow_storage as never);
  const { handlers, log, deps } = make_fake(make_tabs(3));
  deps.previous_tab_of = tracker.previous_of;
  void tracker.activated(1, 101);
  await handlers.alternate(ctx_at(102));
  assert.deepEqual(log, ["activate 101"]);
});

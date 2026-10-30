import assert from "node:assert/strict";
import { test } from "node:test";
import {
  focus_index_after_close,
  goto_target_index,
  make_tab_handlers,
  next_audible_index,
  side_tab_ids,
  wrap_index,
  type TabDeps,
  type TabInfo,
} from "../../src/commands/tab.ts";
import type { CommandContext } from "../../src/shared/command.ts";

function make_tabs(count: number, overrides: Partial<TabInfo>[] = []): TabInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    id: 100 + index,
    index,
    pinned: false,
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
  };
  return { handlers: make_tab_handlers(deps), log };
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

test("tab.move clamps at both ends", async () => {
  const { handlers, log } = make_fake(make_tabs(4));
  await handlers.move(ctx_at(102), { offset: 5 });
  await handlers.move(ctx_at(101), { offset: -5 });
  await handlers.move(ctx_at(101), { offset: 1 });
  assert.deepEqual(log, ["move 102 3", "move 101 0", "move 101 2"]);
});

test("focus after close follows the side and falls back at the edges", () => {
  assert.equal(focus_index_after_close(2, 5, "right"), 3);
  assert.equal(focus_index_after_close(2, 5, "left"), 1);
  assert.equal(focus_index_after_close(0, 5, "left"), 1);
  assert.equal(focus_index_after_close(4, 5, "right"), 3);
  assert.equal(focus_index_after_close(0, 1, "left"), undefined);
});

test("tab.close focus=left activates the left tab, then closes", async () => {
  const { handlers, log } = make_fake(make_tabs(3));
  await handlers.close(ctx_at(101), { focus: "left" });
  assert.deepEqual(log, ["activate 100", "remove 101"]);
});

test("tab.close on the last tab closes without activating", async () => {
  const { handlers, log } = make_fake(make_tabs(1));
  await handlers.close(ctx_at(100), { focus: "right" });
  assert.deepEqual(log, ["remove 100"]);
});

test("side_tab_ids skips pinned tabs and the current tab", () => {
  const tabs = make_tabs(5, [{ pinned: true }]);
  assert.deepEqual(side_tab_ids(tabs, 2, "left"), [101]);
  assert.deepEqual(side_tab_ids(tabs, 2, "right"), [103, 104]);
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
  await handlers.pin_toggle(ctx_at(100));
  await handlers.mute_toggle(ctx_at(101));
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
  await assert.rejects(handlers.next({ tab_id: undefined, window_id: 1, frame_id: 0, mode: "normal" }), /no active tab/);
});

// The many-tab paths `tab.act` reaches: bookmarking a range, moving a range to another window and copying a range.
import assert from "node:assert/strict";
import { test } from "node:test";
import { make_bookmark_handlers } from "../../src/commands/bookmark.ts";
import type { BookmarkDeps } from "../../src/commands/bookmark.ts";
import { make_copy_tabs_handler } from "../../src/commands/copy_tabs.ts";
import type { CopyTabsDeps } from "../../src/commands/copy_tabs.ts";
import { copy_selected_tabs } from "../../src/commands/tab_act.ts";
import { browser_window_deps } from "../../src/commands/window.ts";
import { read_tabs } from "../../src/background/complete_items.ts";
import type { RegisterStore } from "../../src/background/register_store.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import "../../src/background/command_modules.ts";

const ctx = { tab_id: 1, window_id: 5 } as CommandContext;

function bookmark_fake(already: string[] = []) {
  const urls = [...already];
  const toasts: string[] = [];
  const deps = {
    nodes_for_url: async (url: string) => urls.filter((one) => one === url).map((one, at) => ({ id: `${at}`, url: one, type: "bookmark" })),
    create: async (bookmark: { url: string }) => void urls.push(bookmark.url),
    toast: async (_ctx: CommandContext, _kind: string, message: string) => void toasts.push(message),
  } as unknown as BookmarkDeps;
  return { add_many: make_bookmark_handlers(deps).add_many, urls, toasts };
}

test("bookmarking a range skips pages that are not web pages, already have a bookmark, or repeat an address of the range", async () => {
  const { add_many, urls, toasts } = bookmark_fake(["https://old.test/"]);
  const tabs = [
    { url: "https://a.test/", title: "A" },
    { url: "about:blank", title: "" },
    { url: "https://old.test/", title: "Old" },
    { url: "https://a.test/", title: "A again" },
    { url: "https://b.test/", title: "" },
  ];
  await add_many(ctx, tabs);
  assert.deepEqual(urls, ["https://old.test/", "https://a.test/", "https://b.test/"]);
  assert.deepEqual(toasts, ["Bookmarked 2, skipped 3"]);
});

test("bookmarking a range with nothing new refuses and names the skipped count", async () => {
  const { add_many, toasts } = bookmark_fake(["https://old.test/"]);
  await assert.rejects(add_many(ctx, [{ url: "about:blank", title: "" }, { url: "https://old.test/", title: "Old" }]), (error) => error instanceof RuntimeRefusal && error.message === "Nothing to bookmark, 2 skipped");
  assert.deepEqual(toasts, []);
});

test("moving a range to a window puts its pinned tabs after the pinned tabs there and the rest at the end, then shows the first tab", async () => {
  const pinned = new Set([1, 3]);
  const log: string[] = [];
  const saved = (globalThis as { browser?: unknown }).browser;
  (globalThis as { browser?: unknown }).browser = {
    tabs: {
      get: async (id: number) => ({ id, pinned: pinned.has(id) }),
      query: async (query: { windowId: number; pinned: boolean }) => (query.windowId === 9 && query.pinned ? [{ id: 20 }, { id: 21 }] : []),
      move: async (ids: number[], where: { windowId: number; index: number }) => void log.push(`move ${ids.join(",")} to ${where.windowId} at ${where.index}`),
      update: async (id: number, changes: { active: boolean }) => void log.push(`update ${id} ${JSON.stringify(changes)}`),
    },
    windows: { update: async (id: number, changes: { focused: boolean }) => void log.push(`window ${id} ${JSON.stringify(changes)}`) },
  };
  try {
    await browser_window_deps.move_tabs_to_window([1, 2, 3, 4], 9);
    await browser_window_deps.move_tabs_to_window([6], 9);
  } finally {
    (globalThis as { browser?: unknown }).browser = saved;
  }
  assert.deepEqual(log, [
    "move 1,3 to 9 at 2",
    "move 2,4 to 9 at -1",
    'window 9 {"focused":true}',
    'update 1 {"active":true}',
    "move 6 to 9 at -1",
    'window 9 {"focused":true}',
    'update 6 {"active":true}',
  ]);
});

function copy_fake() {
  const written: string[] = [];
  const yanked: string[] = [];
  const raw = [
    { id: 1, windowId: 5, index: 0, incognito: false, url: "https://a.test/?utm_source=x", title: "A" },
    { id: 2, windowId: 5, index: 1, incognito: false, url: "about:blank", title: "" },
    { id: 3, windowId: 5, index: 2, incognito: false, url: "https://b.test/", title: "B" },
    { id: 4, windowId: 5, index: 3, incognito: true, url: "https://private.test/", title: "P" },
  ] as browser.tabs.Tab[];
  const deps: CopyTabsDeps = {
    tabs: (_ctx, all_windows, incognito) => read_tabs(async () => raw, { window_id: 5, incognito }, all_windows),
    is_private: async () => false,
    strip_patterns: async () => () => ["utm_source"],
    write_clipboard: async (text) => void written.push(text),
    store: { yank: async (register: string, _text: string, is_private: boolean) => void yanked.push(`${register === "" ? "unnamed" : register} ${is_private}`) } as unknown as RegisterStore,
    toast: async () => {},
  };
  return { deps, raw, written, yanked };
}

test("copying a range writes the same text as copy.tabs over the same tabs, into the unnamed register, and leaves out tabs of the other privacy", async () => {
  const { deps, raw, written, yanked } = copy_fake();
  await make_copy_tabs_handler(deps)(ctx, { scope: "window", format: "markdown" });
  await copy_selected_tabs(deps, async (id) => raw.find((tab) => tab.id === id)!)(ctx, [1, 2, 3, 4], "markdown");
  assert.equal(written.length, 2);
  assert.equal(written[1], written[0]);
  const text = written[1]!;
  assert.ok(text.includes("b.test") && !text.includes("private.test") && !text.includes("utm_source"), text);
  assert.deepEqual(yanked, ["unnamed false", "unnamed false"]);
});

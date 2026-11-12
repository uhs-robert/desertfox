import assert from "node:assert/strict";
import { test } from "node:test";
import { make_copy_tabs_handler } from "../../src/commands/copy_tabs.ts";
import type { CopyTabsDeps } from "../../src/commands/copy_tabs.ts";
import { format_link_list } from "../../src/content/link_list.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import type { ListedTab } from "../../src/background/complete_items.ts";

const CTX: CommandContext = { tab_id: 1, window_id: 1, frame_id: 0, mode: "normal" };

const tab = (window_id: number, number: number, title: string, url: string): ListedTab => ({ id: window_id * 100 + number, window_id, number, title, url });

function make(tabs: ListedTab[], over: Partial<CopyTabsDeps> = {}) {
  const log = { clipboard: [] as string[], yanks: [] as unknown[], toasts: [] as string[] };
  const deps: CopyTabsDeps = {
    tabs: async (_ctx, all_windows) => (all_windows ? tabs : tabs.filter((row) => row.window_id === 1)),
    is_private: async () => false,
    strip_patterns: async () => () => ["utm_*"],
    write_clipboard: async (text) => void log.clipboard.push(text),
    store: { yank: async (...call: unknown[]) => void log.yanks.push(call) } as never,
    toast: async (_ctx, message) => void log.toasts.push(message),
    ...over,
  };
  return { run: make_copy_tabs_handler(deps), log };
}

const TABS = [tab(1, 1, "A [x]", "https://a.com/?utm_source=z&k=1"), tab(1, 2, "Settings", "about:preferences"), tab(1, 3, "B", "https://b.com/"), tab(2, 1, "C", "https://c.com/")];

test("the window scope copies this window's web tabs as markdown, stripped, and the toast names the skipped one", async () => {
  const { run, log } = make(TABS);
  await run(CTX, { scope: "window", format: "markdown" });
  assert.deepEqual(log.clipboard, ["- [A (x)](https://a.com/?k=1)\n- [B](https://b.com/)"]);
  assert.deepEqual(log.yanks, [["", log.clipboard[0], false]]);
  assert.deepEqual(log.toasts, ["Copied 2 tabs, skipped 1 non-web tab"]);
});

test("each tab strips by its own address: a tab whose site turned the stripping off keeps its parameters", async () => {
  const keeps_a = make(TABS, { strip_patterns: async () => (address) => (address.startsWith("https://a.com/") ? [] : ["utm_*"]) });
  await keeps_a.run(CTX, { scope: "window", format: "plain" });
  assert.equal(keeps_a.log.clipboard[0], "https://a.com/?utm_source=z&k=1\nhttps://b.com/");
  const keeps_all = make(TABS, { strip_patterns: async () => () => [] });
  await keeps_all.run(CTX, { scope: "window", format: "plain" });
  assert.equal(keeps_all.log.clipboard[0], "https://a.com/?utm_source=z&k=1\nhttps://b.com/");
});

test("the all scope puts a blank line between windows, and each other format has its lines", async () => {
  const all = make(TABS);
  await all.run(CTX, { scope: "all", format: "plain" });
  assert.equal(all.log.clipboard[0], "https://a.com/?k=1\nhttps://b.com/\n\nhttps://c.com/");
  const titles = make(TABS);
  await titles.run(CTX, { scope: "all", format: "title" });
  assert.equal(titles.log.clipboard[0], "A [x]\nB\n\nC");
  assert.equal(format_link_list([{ url: "https://a.com/", text: "A" }], "org"), "- [[https://a.com/][A]]");
});

test("no web tab refuses, and a clipboard failure still fills the register then refuses", async () => {
  await assert.rejects(make([tab(1, 1, "S", "about:preferences")]).run(CTX, { scope: "window", format: "markdown" }), /No web tabs/);
  const { run, log } = make(TABS, { write_clipboard: () => Promise.reject(new Error("denied")) });
  await assert.rejects(run(CTX, { scope: "window", format: "markdown", register: "a" }), /Could not copy/);
  assert.equal(log.yanks.length, 1);
  assert.deepEqual(log.toasts, []);
});

test("the black hole copies nothing, and a private window fills the private registers", async () => {
  const hole = make(TABS);
  await hole.run(CTX, { scope: "window", format: "markdown", register: "_" });
  assert.deepEqual([hole.log.clipboard, hole.log.yanks, hole.log.toasts], [[], [], []]);
  const priv = make(TABS, { is_private: async () => true });
  await priv.run(CTX, { scope: "window", format: "markdown" });
  assert.equal((priv.log.yanks[0] as unknown[])[2], true);
});

test("the schema takes the flags and refuses an unknown format", () => {
  const command = registry.get("copy.tabs")!;
  assert.equal(check_args(command, { scope: "all", format: "org" }).ok, true);
  assert.equal(check_args(command, { format: "html" }).ok, false);
});

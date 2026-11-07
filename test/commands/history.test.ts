import assert from "node:assert/strict";
import { test } from "node:test";
import { make_history_handlers } from "../../src/commands/history.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import type { HistoryItem } from "../../src/shared/messages.ts";
import type { Where } from "../../src/commands/open_target.ts";

const ctx: CommandContext = { tab_id: 7, window_id: 2, frame_id: 0, mode: "normal" };
const VISITS: HistoryItem[] = [
  { title: "Arch wiki", url: "https://wiki.archlinux.org/" },
  { title: "Rust book", url: "https://doc.rust-lang.org/book/" },
  { title: "Rust reference", url: "https://doc.rust-lang.org/reference/" },
];

function make(private_tab = false, visits = VISITS) {
  const opened: [string, Where][] = [];
  const handlers = make_history_handlers({
    history: async () => visits,
    is_private: async () => private_tab,
    open: async (_ctx, url, where) => void opened.push([url, where]),
  });
  return { handlers, opened };
}

test("an exact address opens that entry, and a title opens its best match", async () => {
  const { handlers, opened } = make();
  await handlers.open(ctx, { entry: "https://doc.rust-lang.org/reference/", where: "here" });
  await handlers.open(ctx, { entry: "arch", where: "here" });
  assert.deepEqual(opened, [["https://doc.rust-lang.org/reference/", "here"], ["https://wiki.archlinux.org/", "here"]]);
});

test("the where flag reaches the opener", async () => {
  const { handlers, opened } = make();
  await handlers.open(ctx, { entry: "arch", where: "background" });
  assert.deepEqual(opened, [["https://wiki.archlinux.org/", "background"]]);
});

test("an equal tie is refused naming both, and no match is refused", async () => {
  const twins = make(false, [{ title: "Docs", url: "https://a.test/" }, { title: "Docs", url: "https://b.test/" }]);
  await assert.rejects(twins.handlers.open(ctx, { entry: "docs", where: "here" }), /equally, use the address/);
  await assert.rejects(make().handlers.open(ctx, { entry: "zzzz", where: "here" }), /no history entry matches "zzzz"/);
  assert.deepEqual(twins.opened, []);
});

test("a private tab is refused before the history is read", async () => {
  let reads = 0;
  const handlers = make_history_handlers({ history: async () => {
      reads++;
      return [];
    }, is_private: async () => true, open: async () => {} });
  await assert.rejects(handlers.open(ctx, { entry: "arch", where: "here" }), /no history in a private window/);
  assert.equal(reads, 0);
});

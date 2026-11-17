import assert from "node:assert/strict";
import { test } from "node:test";
import { make_history_handlers } from "../../src/commands/history.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import type { HistoryItem } from "../../src/shared/messages.ts";
import type { PickedHistory } from "../../src/background/rank_index.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import type { Where } from "../../src/commands/open_target.ts";
import { rank } from "../../src/shared/score.ts";

const ctx: CommandContext = { tab_id: 7, window_id: 2, frame_id: 0, mode: "normal" };
const VISITS: HistoryItem[] = [
  { title: "Arch wiki", url: "https://wiki.archlinux.org/" },
  { title: "Rust book", url: "https://doc.rust-lang.org/book/" },
  { title: "Rust reference", url: "https://doc.rust-lang.org/reference/" },
];

function make(private_tab = false, visits = VISITS, pick?: (text: string) => Promise<PickedHistory | undefined>) {
  const opened: [string, Where][] = [];
  const handlers = make_history_handlers({
    history: async () => visits,
    ...(pick ? { pick } : {}),
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

test("Enter on a typed word opens the entry the list ranks first, use included", async () => {
  const visits: HistoryItem[] = [
    { title: "Rust book", url: "https://doc.rust-lang.org/book/" },
    { title: "Rust blog", url: "https://blog.rust-lang.org/", boost: 0.4 },
    { title: "Docs", url: "https://a.test/" },
    { title: "Docs", url: "https://b.test/", boost: 0.1 },
  ];
  const listed_first = (word: string) => rank(word, visits.map((visit) => ({ name: visit.title, description: visit.url, ...(visit.boost ? { boost: visit.boost } : {}) })))[0]!.description;
  const { handlers, opened } = make(false, visits);
  await handlers.open(ctx, { entry: "rust", where: "here" });
  await handlers.open(ctx, { entry: "docs", where: "here" });
  assert.deepEqual(opened.map(([url]) => url), [listed_first("rust"), listed_first("docs")]);
  assert.deepEqual(opened.map(([url]) => url), ["https://blog.rust-lang.org/", "https://b.test/"]);
});

test("the Worker's pick opens without the handler reading the rows, and its refusal reaches the caller as a refusal", async () => {
  let reads = 0;
  const opened: string[] = [];
  const handlers = make_history_handlers({
    history: async () => {
      reads++;
      return VISITS;
    },
    pick: async (text) => (text === "tie" ? { refusal: '"tie" matches "A" (a) and "B" (b) equally, use the address' } : { row: { title: "Picked", url: "https://picked.test/" } }),
    is_private: async () => false,
    open: async (_ctx, url) => void opened.push(url),
  });
  await handlers.open(ctx, { entry: "anything", where: "here" });
  await assert.rejects(handlers.open(ctx, { entry: "tie", where: "here" }), (error) => error instanceof RuntimeRefusal && /equally/.test(error.message));
  assert.deepEqual(opened, ["https://picked.test/"]);
  assert.equal(reads, 0);
});

test("with no answer from the Worker the handler picks over the rows it reads, as before", async () => {
  const { handlers, opened } = make(false, VISITS, async () => undefined);
  await handlers.open(ctx, { entry: "arch", where: "here" });
  await assert.rejects(handlers.open(ctx, { entry: "zzzz", where: "here" }), /no history entry matches "zzzz"/);
  assert.deepEqual(opened, [["https://wiki.archlinux.org/", "here"]]);
});

test("a private tab is refused before the Worker is asked", async () => {
  let asked = 0;
  const { handlers } = make(true, VISITS, async () => void asked++);
  await assert.rejects(handlers.open(ctx, { entry: "arch", where: "here" }), /no history in a private window/);
  assert.equal(asked, 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { create_live_source } from "../../src/cmdline/completion/live.ts";
import { create_completer } from "../../src/cmdline/completion/sources.ts";
import { create_session } from "../../src/cmdline/session.ts";
import type { CommandMeta } from "../../src/shared/command.ts";
import type { BookmarkItem, TabItem } from "../../src/shared/messages.ts";
import { parse_command_line } from "../../src/shared/registry/index.ts";
import { create_word_lookup } from "../../src/cmdline/word_lookup.ts";

const COMMANDS: CommandMeta[] = [
  { id: "tab.switch", name: "tab", label: "Switch tab", intent: "Switch tab.", params: [{ name: "tab", type: "string", rest: true, main: true, values: { from: "tabs" } }] },
  {
    id: "bookmark.open",
    name: "bookmark",
    label: "Open bookmark",
    intent: "Open bookmark.",
    params: [
      { name: "bookmark", type: "string", rest: true, main: true, values: { from: "bookmarks" } },
      { name: "where", type: "enum", values: ["here", "tab"], default: "here", short: { tab: "t" }, description: { tab: "Open in a new tab." } },
    ],
  },
];
const SOURCES = { search_engines: [], containers: [] };
const lookup = create_word_lookup(COMMANDS, {});

const TABS: TabItem[] = [
  { number: 1, title: "Mail", url: "https://mail.test/" },
  { number: 2, title: "GitHub", url: "https://github.com/" },
  { number: 3, title: "GitHub Gist", url: "https://gist.github.com/" },
  { number: 4, title: "Bob's \"page\"", url: "https://bob.test/" },
];
const BOOKMARKS: BookmarkItem[] = Array.from({ length: 30 }, (_, index) => ({ title: `Mark ${index}`, url: `https://m${index}.test/` }));

// The background answers when the test says so.
function make() {
  const asks: { kind: string; answer: (items: TabItem[] | BookmarkItem[]) => void }[] = [];
  const live = create_live_source({
    ask: (kind) => new Promise((resolve) => void asks.push({ kind, answer: (items) => resolve({ items }) })),
    on_ready: () => session.source_ready(),
  });
  const session = create_session({
    history: [],
    parse: (text) => parse_command_line(lookup, text, SOURCES),
    complete: create_completer(lookup, COMMANDS, {}, SOURCES, "normal", live),
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { session, live, asks, settle };
}
const tab_key = (session: ReturnType<typeof make>["session"]) => session.run("cmdline.next_completion", undefined);
const names = (session: ReturnType<typeof make>["session"]) => session.get_rows().map((row) => row.name);

test("the note row reads loading, then the result, and the rows rank the text as it is now", async () => {
  const { session, asks, settle } = make();
  session.edit("tab ");
  assert.equal(session.get_hint(), "loading");
  assert.deepEqual(names(session), []);
  session.edit("tab git");
  asks[0]!.answer(TABS);
  await settle();
  assert.deepEqual(names(session), ["2 GitHub", "3 GitHub Gist"]);
  assert.notEqual(session.get_hint(), "loading");
  assert.equal(asks.length, 1);
});

test("a tab pick puts its tab bar number and title in the line, and the number stays while typing", async () => {
  const { session, asks, settle } = make();
  session.edit("tab ");
  asks[0]!.answer(TABS);
  await settle();
  assert.deepEqual(names(session), ["1 Mail", "2 GitHub", "3 GitHub Gist", "4 Bob's \"page\""]);
  session.edit("tab gist");
  assert.deepEqual(names(session), ["3 GitHub Gist"]);
  tab_key(session);
  assert.equal(session.get_text(), "tab 3 GitHub Gist ");
  session.edit("tab 3");
  assert.equal(names(session)[0], "3 GitHub Gist");
});

test("a title with a quote is quoted so the line still parses", async () => {
  const { session, asks, settle } = make();
  session.edit("tab bob");
  asks[0]!.answer(TABS);
  await settle();
  tab_key(session);
  assert.equal(session.get_text(), `tab 4 "Bob's \\"page\\"" `);
  assert.equal(session.run("cmdline.submit", undefined).kind, "submit");
});

test("bookmarks show the 20 newest on an empty word, rank every bookmark for a typed word, and a pick inserts the address", async () => {
  const { session, asks, settle } = make();
  session.edit("bookmark -t ");
  assert.equal(asks.length, 1);
  asks[0]!.answer(BOOKMARKS);
  await settle();
  assert.equal(session.get_rows().length, 20);
  assert.equal(session.get_rows()[0]!.name, "Mark 0");
  session.edit("bookmark -t 27");
  assert.deepEqual(names(session), ["Mark 27"]);
  tab_key(session);
  assert.equal(session.get_text(), "bookmark -t https://m27.test/ ");
});

test("Escape while the fetch is pending closes the line, and the reply that lands after the close changes nothing", async () => {
  const { session, live, asks, settle } = make();
  session.edit("tab ");
  assert.equal(session.run("mode.escape", undefined).kind, "close");
  live.close();
  asks[0]!.answer(TABS);
  await settle();
  assert.deepEqual(names(session), []);
  assert.equal(session.get_text(), "tab ");
});

test("a reply that lands after Escape closed the list does not reopen it, and typing finds the cache", async () => {
  const { session, asks, settle } = make();
  session.edit("tab ");
  asks[0]!.answer(TABS);
  await settle();
  session.run("mode.escape", undefined);
  assert.deepEqual(names(session), []);
  session.source_ready();
  assert.deepEqual(names(session), []);
  assert.equal(session.get_text(), "tab ");
  session.edit("tab mai");
  assert.deepEqual(names(session), ["1 Mail"]);
  assert.equal(asks.length, 1);
});

test("a reply that lands while a row is previewed changes neither the list nor the preview", async () => {
  const { session, asks, settle } = make();
  session.edit("tab ");
  asks[0]!.answer(TABS);
  await settle();
  tab_key(session);
  const before = { text: session.get_text(), selected: session.get_selected(), rows: names(session) };
  // A second kind finishing late calls source_ready too.
  session.source_ready();
  assert.deepEqual({ text: session.get_text(), selected: session.get_selected(), rows: names(session) }, before);
});

test("a reply for a fetch that a newer one replaced is dropped and the list keeps waiting", async () => {
  const { session, asks, settle } = make();
  session.edit("tab ");
  session.edit("bookmark ");
  session.edit("tab ");
  assert.deepEqual(asks.map((ask) => ask.kind), ["tabs", "bookmarks", "tabs"]);
  asks[0]!.answer(TABS);
  await settle();
  assert.equal(session.get_hint(), "loading");
  asks[2]!.answer(TABS);
  await settle();
  assert.equal(names(session).length, 4);
});

test("without a live source the tab subject lists nothing and asks nothing", () => {
  const complete = create_completer(lookup, COMMANDS, {}, SOURCES);
  assert.deepEqual(complete("tab ", 4).rows, []);
});

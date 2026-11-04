import assert from "node:assert/strict";
import { test } from "node:test";
import { create_live_source } from "../../src/cmdline/completion/live.ts";
import { create_completer } from "../../src/cmdline/completion/sources.ts";
import { create_session } from "../../src/cmdline/session.ts";
import type { CommandMeta } from "../../src/shared/command.ts";
import type { BookmarkItem, EngineItem, OpenItems, WindowItem, TabItem } from "../../src/shared/messages.ts";
import { parse_command_line } from "../../src/shared/registry/index.ts";
import { create_word_lookup } from "../../src/cmdline/word_lookup.ts";

const COMMANDS: CommandMeta[] = [
  { id: "tab.attach", label: "Attach tab", intent: "Attach tab.", params: [{ name: "window", type: "string", rest: true, main: true, default: "", values: { from: "windows" } }] },
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
  {
    id: "open.search",
    name: "search",
    label: "Search",
    intent: "Search the web.",
    params: [
      { name: "engine", type: "enum", values: { from: "search_engines" }, default: "duck" },
      { name: "query", type: "string", rest: true, main: true },
    ],
  },
  { id: "engine.show", name: "engine.show", label: "Show engine", intent: "Show an engine.", params: [{ name: "engine", type: "enum", values: { from: "search_engines" } }] },
];
COMMANDS.push({ id: "open.url", name: "open", label: "Open URL", intent: "Open a URL.", params: [{ name: "url", type: "string", main: true, values: { from: "open" } }] });
const ENGINES: EngineItem[] = [
  { name: "duck", label: "DuckDuckGo", available: true },
  { name: "github.repo", label: "GitHub: this repo", available: false },
  { name: "github.repo.issues", label: "GitHub: this repo: issues", available: false },
  { name: "github.repo.fb", label: "GitHub: this repo, with fallback", available: true },
  { name: "youtube.channel", label: "YouTube: this channel", available: false },
];
// The parser reads the full list, hidden engines included.
const SOURCES = { search_engines: ENGINES.map((engine) => engine.name), containers: [] };
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
  const asks: { kind: string; answer: (items: TabItem[] | BookmarkItem[] | EngineItem[] | OpenItems | WindowItem[]) => void }[] = [];
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
  assert.deepEqual(names(session), ["2: GitHub", "3: GitHub Gist"]);
  assert.notEqual(session.get_hint(), "loading");
  assert.equal(asks.length, 1);
});

test("a tab pick puts its tab bar number and title in the line, and the number stays while typing", async () => {
  const { session, asks, settle } = make();
  session.edit("tab ");
  asks[0]!.answer(TABS);
  await settle();
  assert.deepEqual(names(session), ["1: Mail", "2: GitHub", "3: GitHub Gist", "4: Bob's \"page\""]);
  session.edit("tab gist");
  assert.deepEqual(names(session), ["3: GitHub Gist"]);
  tab_key(session);
  assert.equal(session.get_text(), "tab 3 GitHub Gist ");
  session.edit("tab 3");
  assert.equal(names(session)[0], "3: GitHub Gist");
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
  assert.deepEqual(names(session), ["1: Mail"]);
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

test("a kind still in flight is not asked again when the word goes back to it", async () => {
  const { session, asks, settle } = make();
  session.edit("tab ");
  session.edit("bookmark ");
  session.edit("tab ");
  assert.deepEqual(asks.map((ask) => ask.kind), ["tabs", "bookmarks"]);
  asks[0]!.answer(TABS);
  await settle();
  assert.equal(names(session).length, 4);
});

test("without a live source the tab subject lists nothing and asks nothing", () => {
  const complete = create_completer(lookup, COMMANDS, {}, SOURCES);
  assert.deepEqual(complete("tab ", 4).rows, []);
});

test("an empty engine word lists every engine in config order, dims the hidden ones and marks them unavailable", async () => {
  const { session, asks, settle } = make();
  session.edit("search ");
  assert.equal(session.get_hint(), "loading");
  assert.equal(asks[0]!.kind, "engines");
  asks[0]!.answer(ENGINES);
  await settle();
  assert.deepEqual(names(session), ENGINES.map((engine) => engine.name));
  const rows = session.get_rows();
  assert.deepEqual(rows.map((row) => row.unavailable === true), [false, true, true, false, true]);
  assert.deepEqual(rows.map((row) => row.args), ["", "unavailable", "unavailable", "", "unavailable"]);
  assert.equal(rows[1]!.description, "GitHub: this repo");
});

test("a fuzzy word finds an engine through the dot break", async () => {
  const { session, asks, settle } = make();
  session.edit("search gh");
  asks[0]!.answer(ENGINES);
  await settle();
  assert.ok(names(session).includes("github.repo"));
  assert.ok(!names(session).includes("youtube.channel"));
});

test("a word that ends in a dot lists every engine under the prefix, deeper ones included, and a pick keeps the line parsing", async () => {
  const { session, asks, settle } = make();
  session.edit("search github.");
  asks[0]!.answer(ENGINES);
  await settle();
  assert.deepEqual(names(session).sort(), ["github.repo", "github.repo.fb", "github.repo.issues"]);
  assert.deepEqual(session.get_rows().map((row) => row.unavailable === true).sort(), [false, true, true]);
  tab_key(session);
  assert.equal(session.get_text(), "search github.repo ");
});

test("the engine flag value lists engines too", async () => {
  const { session, asks, settle } = make();
  session.edit("search --engine=yo");
  asks[0]!.answer(ENGINES);
  await settle();
  assert.deepEqual(names(session), ["youtube.channel"]);
});

test("engine.show lists every engine and dims none", async () => {
  const { session, asks, settle } = make();
  session.edit("engine.show ");
  asks[0]!.answer(ENGINES);
  await settle();
  assert.equal(names(session).length, 5);
  assert.ok(session.get_rows().every((row) => row.unavailable === undefined && row.args === ""));
});

test("a hidden engine still parses, and a failed fetch lists no engines", async () => {
  const { session, asks, settle } = make();
  session.edit("search github.repo foo");
  assert.equal(session.run("cmdline.submit", undefined).kind, "submit");
  session.edit("search ");
  asks[0]!.answer(undefined as unknown as EngineItem[]);
  await settle();
  assert.deepEqual(names(session), []);
});

test("after `--` or an `--engine=` flag the first word is the query, so no engine rows show", async () => {
  for (const text of ["search -- github.", "search --engine=duck github."]) {
    const { session, asks, settle } = make();
    session.edit(text);
    await settle();
    assert.equal(asks.length, 0, text);
    assert.deepEqual(names(session), [], text);
  }
});

test("a window pick puts its number and title in the line, and the list is fetched once as the windows kind", async () => {
  const { session, asks, settle } = make();
  session.edit("tab.attach ");
  assert.equal(session.get_hint(), "loading");
  assert.deepEqual(asks.map((ask) => ask.kind), ["windows"]);
  asks[0]!.answer([{ number: 2, title: "Mail" }, { number: 3, title: "Docs" }]);
  await settle();
  assert.deepEqual(names(session), ["2 Mail", "3 Docs"]);
  session.edit("tab.attach doc");
  tab_key(session);
  assert.equal(session.get_text(), "tab.attach 3 Docs ");
  assert.equal(asks.length, 1);
});

const OPEN: OpenItems = {
  history_max: 2,
  rows: [
    ...Array.from({ length: 25 }, (_, index) => ({ title: `Mark ${index}`, url: `https://m${index}.test/`, tag: "bm" as const })),
    ...Array.from({ length: 5 }, (_, index) => ({ title: `Visit ${index}`, url: `https://v${index}.test/`, tag: "hist" as const })),
  ],
};

test("open shows 20 bookmarks and the history cap on an empty word, in the order given, with tags", async () => {
  const { session, asks, settle } = make();
  session.edit("open ");
  assert.equal(session.get_hint(), "loading");
  assert.equal(asks[0]!.kind, "open");
  asks[0]!.answer(OPEN);
  await settle();
  const rows = session.get_rows();
  assert.equal(rows.length, 22);
  assert.deepEqual([rows[0]!.tag, rows[19]!.tag, rows[20]!.tag, rows[21]!.name], ["bm", "bm", "hist", "Visit 1"]);
});

test("a typed word ranks every row, keeps the groups in the order given, and a pick inserts the address", async () => {
  const { session, asks, settle } = make();
  session.edit("open git");
  asks[0]!.answer({
    history_max: 1,
    rows: [
      { title: "Notes on a git hook", url: "https://notes.test/", tag: "bm" },
      { title: "git", url: "https://git.test/", tag: "hist" },
      { title: "Unrelated", url: "https://x.test/", tag: "hist" },
    ],
  });
  await settle();
  // The history row scores higher, yet the bookmark group stays first. Rows that do not match drop out, and the cap does not apply to a typed word.
  assert.deepEqual(session.get_rows().map((row) => [row.name, row.tag]), [["Notes on a git hook", "bm"], ["git", "hist"]]);
  tab_key(session);
  assert.equal(session.get_text(), "open https://notes.test/ ");
});

test("a tab row carries its status, flags, favicon and container from the tab item", async () => {
  const container = { color: "#37adff", icon: "resource://usercontext-content/fingerprint.svg" };
  const { session, asks, settle } = make();
  session.edit("tab ");
  asks[0]!.answer([
    { number: 1, title: "Mail", url: "https://m.test/", active: true, pinned: true, favicon: "https://m.test/i.png" },
    { number: 2, title: "Docs", url: "https://d.test/", alternate: true, muted: true, container },
    { number: 3, title: "Old", url: "https://o.test/", discarded: true },
  ]);
  await settle();
  const marks = session.get_rows().map((row) => row.tab);
  assert.deepEqual(marks, [
    { status: "%", flags: ["pinned"], favicon: "https://m.test/i.png" },
    { status: "#", flags: ["muted"], container },
    { status: "", flags: ["discarded"] },
  ]);
});

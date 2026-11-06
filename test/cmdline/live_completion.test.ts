import assert from "node:assert/strict";
import { test } from "node:test";
import { create_live_source } from "../../src/cmdline/completion/live.ts";
import { create_completer } from "../../src/cmdline/completion/sources.ts";
import { create_session } from "../../src/cmdline/session.ts";
import type { CommandMeta } from "../../src/shared/command.ts";
import type { BookmarkItem, EngineItem, HeadingItem, OpenItems, WindowItem, TabItem } from "../../src/shared/messages.ts";
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
COMMANDS.push({ id: "heading.go", name: "heading", label: "Go to heading", intent: "Go to a heading.", params: [{ name: "heading", type: "string", rest: true, main: true, values: { from: "headings" } }] });
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
  { id: 11, number: 1, title: "Mail", url: "https://mail.test/" },
  { id: 12, number: 2, title: "GitHub", url: "https://github.com/" },
  { id: 13, number: 3, title: "GitHub Gist", url: "https://gist.github.com/" },
  { id: 14, number: 4, title: "Bob's \"page\"", url: "https://bob.test/" },
];
const BOOKMARKS: BookmarkItem[] = Array.from({ length: 30 }, (_, index) => ({ title: `Mark ${index}`, url: `https://m${index}.test/` }));

// The background answers when the test says so.
function make() {
  const asks: { kind: string; answer: (items: TabItem[] | BookmarkItem[] | EngineItem[] | OpenItems | WindowItem[] | HeadingItem[]) => void }[] = [];
  // The tab model has no reply to await. The first read is its cue to connect, and `answer` is the snapshot arriving.
  let tab_items: TabItem[] | undefined;
  let tabs_asked = false;
  const live = create_live_source({
    ask: (kind) => new Promise((resolve) => void asks.push({ kind, answer: (items) => resolve({ items }) })),
    tabs: () => {
      if (!tabs_asked) {
        tabs_asked = true;
        asks.push({
          kind: "tabs",
          answer: (items) => {
            tab_items = items as TabItem[];
            session.source_ready();
          },
        });
      }
      return tab_items;
    },
    on_ready: () => session.source_ready(),
  });
  const session = create_session({
    history: [],
    parse: (text) => parse_command_line(lookup, text, SOURCES),
    tabs: () => tab_items,
    complete: create_completer(lookup, COMMANDS, {}, SOURCES, "normal", live),
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { session, live, asks, settle, change_tabs: (items: TabItem[]) => { tab_items = items; session.source_ready(); } };
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
  session.edit("bookmark -t ");
  assert.equal(session.run("mode.escape", undefined).kind, "close");
  live.close();
  asks[0]!.answer(BOOKMARKS);
  await settle();
  assert.deepEqual(names(session), []);
  assert.equal(session.get_text(), "bookmark -t ");
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
    { id: 21, number: 1, title: "Mail", url: "https://m.test/", active: true, pinned: true, favicon: "https://m.test/i.png" },
    { id: 22, number: 2, title: "Docs", url: "https://d.test/", alternate: true, muted: true, container },
    { id: 23, number: 3, title: "Old", url: "https://o.test/", discarded: true },
  ]);
  await settle();
  const marks = session.get_rows().map((row) => row.tab);
  assert.deepEqual(marks, [
    { id: 21, status: "%", flags: ["pinned"], favicon: "https://m.test/i.png" },
    { id: 22, status: "#", flags: ["muted"], container },
    { id: 23, status: "", flags: ["discarded"] },
  ]);
});

test("the window number shows on tab rows only when the list spans more than one window", async () => {
  const one = make();
  one.session.edit("tab ");
  one.asks[0]!.answer([{ ...TABS[0]!, window_number: 1 }, { ...TABS[1]!, window_number: 1 }]);
  await one.settle();
  assert.deepEqual(one.session.get_rows().map((row) => row.tab?.window_number), [undefined, undefined]);
  const two = make();
  two.session.edit("tab ");
  two.asks[0]!.answer([{ ...TABS[0]!, window_number: 1 }, { ...TABS[1]!, window_number: 2 }]);
  await two.settle();
  assert.deepEqual(two.session.get_rows().map((row) => row.tab?.window_number), [1, 2]);
});

type Session = ReturnType<typeof make>["session"];
const unload_key = (session: Session) => session.run("list.act", { action: "unload" });
const act = (session: Session, action: string) => session.run("list.act", { action });
const select_key = (session: Session, action = "toggle") => session.run("list.select", { action });
const marked = (session: Session) => [...session.get_marked()];

test("the row key on a loaded tab row asks to unload it, and on an unloaded row to load it, and the list and selection stay", async () => {
  const { session, live, asks, settle } = make();
  session.edit("tab ");
  asks[0]!.answer([...TABS.slice(0, 2), { id: 23, number: 3, title: "Old", url: "https://o.test/", discarded: true }]);
  await settle();
  session.run("cmdline.next_completion", undefined);
  assert.deepEqual(unload_key(session), { kind: "tab_rows_action", action: "unload", tab_ids: [11] });
  session.run("cmdline.next_completion", undefined);
  session.run("cmdline.next_completion", undefined);
  assert.deepEqual(unload_key(session), { kind: "tab_rows_action", action: "load", tab_ids: [23] });
  assert.equal(session.get_selected(), 2);
  assert.equal(session.get_rows().length, 3);
  assert.equal(live.read("tabs").loading, false);
});

test("a model change under a previewed tab row rebuilds the rows and keeps the preview on the same tab, with its new number in the line", async () => {
  const { session, asks, settle, change_tabs } = make();
  session.edit("tab ");
  asks[0]!.answer(TABS);
  await settle();
  session.run("cmdline.next_completion", undefined);
  session.run("cmdline.next_completion", undefined);
  assert.equal(session.get_text(), "tab 2 GitHub ");
  change_tabs([{ ...TABS[1]!, number: 1, title: "GitHub renamed", discarded: true }, TABS[2]!, TABS[3]!]);
  assert.deepEqual(names(session), ["1: GitHub renamed", "3: GitHub Gist", "4: Bob's \"page\""]);
  assert.equal(session.get_selected(), 0);
  assert.equal(session.get_text(), "tab 1 GitHub renamed ");
  assert.deepEqual(session.get_rows()[0]!.tab?.flags, ["discarded"]);
});

test("a model change that removes the previewed tab clears the preview and puts the typed text back", async () => {
  const { session, asks, settle, change_tabs } = make();
  session.edit("tab ");
  asks[0]!.answer(TABS);
  await settle();
  session.run("cmdline.next_completion", undefined);
  session.run("cmdline.next_completion", undefined);
  change_tabs([TABS[0]!, TABS[2]!, TABS[3]!]);
  assert.equal(session.get_selected(), -1);
  assert.equal(session.get_text(), "tab ");
  assert.equal(names(session).length, 3);
});

test("a tab row accepted by a click or a single-match Tab keeps its tab: a model change renumbers it, and its removal restores the typed text", async () => {
  const gist = { ...TABS[2]!, number: 2 };
  const shifted = [TABS[1]!, gist, TABS[3]!].map((tab, index) => ({ ...tab, number: index + 1 }));
  const clicked = make();
  clicked.session.edit("tab ");
  clicked.asks[0]!.answer(TABS);
  await clicked.settle();
  clicked.session.pick(2);
  assert.equal(clicked.session.get_text(), "tab 3 GitHub Gist ");
  clicked.change_tabs([TABS[1]!, TABS[2]!, TABS[3]!].map((tab, index) => ({ ...tab, number: index + 1 })));
  assert.equal(clicked.session.get_text(), "tab 2 GitHub Gist ");
  clicked.change_tabs([TABS[1]!, TABS[3]!]);
  assert.equal(clicked.session.get_text(), "tab ");

  const single = make();
  single.session.edit("tab gist");
  single.asks[0]!.answer(TABS);
  await single.settle();
  tab_key(single.session);
  assert.equal(single.session.get_text(), "tab 3 GitHub Gist ");
  single.change_tabs(shifted);
  assert.equal(single.session.get_text(), "tab 2 GitHub Gist ");
  single.session.edit("tab 2 GitHub Gist x");
  single.change_tabs([TABS[0]!]);
  assert.equal(single.session.get_text(), "tab 2 GitHub Gist x");
});

test("previewing another row after an accept ends the accept: a model change then follows the new preview", async () => {
  const { session, asks, settle, change_tabs } = make();
  const docs: TabItem[] = [
    { id: 31, number: 1, title: "Doc", url: "https://a.test/" },
    { id: 32, number: 11, title: "Doc", url: "https://b.test/" },
  ];
  session.edit("tab ");
  asks[0]!.answer(docs);
  await settle();
  session.pick(0);
  assert.equal(session.get_text(), "tab 1 Doc ");
  assert.deepEqual(names(session), ["1: Doc", "11: Doc"]);
  tab_key(session);
  tab_key(session);
  assert.equal(session.get_text(), "tab 11 Doc ");
  change_tabs([docs[0]!, { ...docs[1]!, number: 12 }]);
  assert.equal(session.get_text(), "tab 12 Doc ");
});

test("a model change under a previewed row that is no tab row leaves the preview alone", async () => {
  const { session, asks, settle, change_tabs } = make();
  session.edit("bookmark -t ");
  asks[0]!.answer(BOOKMARKS);
  await settle();
  session.run("cmdline.next_completion", undefined);
  const before = session.get_rows();
  change_tabs([]);
  assert.equal(session.get_rows(), before);
});

test("the row key on a command row, an empty selection or a closed list does nothing but show a note", async () => {
  const { session, asks, settle } = make();
  session.edit("ta");
  assert.deepEqual(unload_key(session), { kind: "render" });
  assert.equal(session.get_message(), "select a tab row first");
  session.edit("tab ");
  asks[0]!.answer(TABS);
  await settle();
  assert.deepEqual(unload_key(session), { kind: "render" });
  session.run("cmdline.next_completion", undefined);
  session.run("mode.escape", undefined);
  assert.deepEqual(unload_key(session), { kind: "render" });
});

test("a refusal note is not shown after a later row action succeeds", () => {
  const { session } = make();
  session.set_message("not unloaded: audible");
  session.set_message(undefined);
  assert.equal(session.get_message(), undefined);
});

const HEADINGS: HeadingItem[] = [
  { level: 2, text: "Install" },
  { level: 3, text: "From source" },
  { level: 2, text: "Usage" },
  { level: 3, text: "Install the plugin" },
];

test("headings list in page order with an empty word, indented from the shallowest level, each with a level tag", async () => {
  const { session, asks, settle } = make();
  session.edit("heading ");
  assert.equal(session.get_hint(), "loading");
  assert.deepEqual(asks.map((ask) => ask.kind), ["headings"]);
  asks[0]!.answer(HEADINGS);
  await settle();
  const rows = session.get_rows();
  assert.deepEqual(rows.map((row) => row.name), ["Install", "From source", "Usage", "Install the plugin"]);
  assert.deepEqual(rows.map((row) => row.indent), [0, 1, 0, 1]);
  assert.deepEqual(rows.map((row) => row.description), ["h2", "h3", "h2", "h3"]);
});

test("a page that starts at h3 loses no width to the missing levels", async () => {
  const { session, asks, settle } = make();
  session.edit("heading ");
  asks[0]!.answer([{ level: 3, text: "A" }, { level: 4, text: "B" }]);
  await settle();
  assert.deepEqual(session.get_rows().map((row) => row.indent), [0, 1]);
});

test("typing ranks headings best match first and the highlight positions count the plain text", async () => {
  const { session, asks, settle } = make();
  session.edit("heading ");
  asks[0]!.answer(HEADINGS);
  await settle();
  session.edit("heading plugin");
  const [top] = session.get_rows();
  assert.equal(top!.name, "Install the plugin");
  assert.deepEqual(top!.positions, [12, 13, 14, 15, 16, 17]);
  assert.equal(top!.indent, 1);
});

test("a heading pick puts its place and text in the line, and the list is fetched once", async () => {
  const { session, asks, settle } = make();
  session.edit("heading ");
  asks[0]!.answer(HEADINGS);
  await settle();
  session.edit("heading source");
  tab_key(session);
  assert.equal(session.get_text(), "heading 2 From source ");
  assert.equal(asks.length, 1);
});

test("a page with no headings lists nothing and says no match", async () => {
  const { session, asks, settle } = make();
  session.edit("heading ");
  asks[0]!.answer([]);
  await settle();
  assert.deepEqual(session.get_rows(), []);
  assert.equal(session.get_hint(), "no match");
});

async function listed(tabs: TabItem[] = TABS) {
  const made = make();
  made.session.edit("tab ");
  made.asks[0]!.answer(tabs);
  await made.settle();
  return made;
}

test("select toggles the highlighted tab row and moves the highlight down", async () => {
  const { session } = await listed();
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  assert.deepEqual(marked(session), [11]);
  assert.equal(session.get_selected(), 1);
  select_key(session);
  assert.deepEqual(marked(session), [11, 12]);
  session.run("cmdline.history", { direction: "prev" });
  session.run("cmdline.history", { direction: "prev" });
  select_key(session);
  assert.deepEqual(marked(session), [12]);
});

test("select on the last row marks it and stays there, and with no highlight it marks nothing", async () => {
  const { session } = await listed();
  assert.equal(select_key(session).kind, "render");
  assert.deepEqual(marked(session), []);
  assert.equal(session.get_message(), "select a tab row first");
  session.run("cmdline.prev_completion", undefined);
  select_key(session);
  assert.deepEqual(marked(session), [14]);
  assert.equal(session.get_selected(), 3);
});

test("select on a row that is not a tab marks nothing", () => {
  const { session } = make();
  session.edit("ta");
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  assert.deepEqual(marked(session), []);
  assert.equal(session.get_message(), "select a tab row first");
});

test("the selection survives a filter, and an action takes the hidden marked tabs too", async () => {
  const { session } = await listed();
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  select_key(session);
  session.edit("tab git");
  assert.deepEqual(names(session), ["2: GitHub", "3: GitHub Gist"]);
  assert.deepEqual(marked(session), [11, 12]);
  session.run("cmdline.next_completion", undefined);
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  assert.deepEqual(act(session, "close"), { kind: "tab_rows_action", action: "close", tab_ids: [11, 12, 13] });
});

test("with a selection the actions ignore the highlighted row, and without one they act on it", async () => {
  const { session } = await listed();
  session.run("cmdline.next_completion", undefined);
  assert.deepEqual(act(session, "pin"), { kind: "tab_rows_action", action: "pin", tab_ids: [11] });
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  session.run("cmdline.next_completion", undefined);
  assert.deepEqual(act(session, "pin"), { kind: "tab_rows_action", action: "pin", tab_ids: [12] });
});

test("the ids of an action are fixed at the key press: a model patch after it changes nothing in it", async () => {
  const { session, change_tabs } = await listed();
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  select_key(session);
  const effect = act(session, "close");
  change_tabs([TABS[2]!, TABS[3]!]);
  assert.deepEqual(effect, { kind: "tab_rows_action", action: "close", tab_ids: [11, 12] });
  assert.deepEqual(marked(session), []);
  assert.deepEqual(act(session, "close"), { kind: "tab_rows_action", action: "close", tab_ids: [13] });
});

test("a patch before the key press decides the ids: a marked tab that closed is not in the action", async () => {
  const { session, change_tabs } = await listed();
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  select_key(session);
  select_key(session);
  change_tabs([TABS[0]!, TABS[2]!, TABS[3]!]);
  assert.deepEqual(marked(session), [11, 13]);
  assert.deepEqual(act(session, "mute"), { kind: "tab_rows_action", action: "mute", tab_ids: [11, 13] });
});

test("a marked tab that leaves the model drops out of the selection, also while it is filtered out", async () => {
  const { session, change_tabs } = await listed();
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  select_key(session);
  session.edit("tab gist");
  change_tabs([TABS[0]!, TABS[2]!, TABS[3]!]);
  assert.deepEqual(marked(session), [11]);
});

test("mute and pin turn all on when any is off, else all off, and unload unloads the loaded tabs or loads all", async () => {
  const tabs: TabItem[] = [TABS[0]!, { ...TABS[1]!, muted: true, pinned: true }, { ...TABS[2]!, discarded: true }, { ...TABS[3]!, discarded: true }];
  const { session } = await listed(tabs);
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  select_key(session);
  assert.deepEqual(act(session, "mute"), { kind: "tab_rows_action", action: "mute", tab_ids: [11, 12] });
  assert.deepEqual(act(session, "pin"), { kind: "tab_rows_action", action: "pin", tab_ids: [11, 12] });
  assert.deepEqual(unload_key(session), { kind: "tab_rows_action", action: "unload", tab_ids: [11, 12] });
  select_key(session);
  select_key(session);
  select_key(session, "clear");
  session.edit("tab ");
  session.run("cmdline.next_completion", undefined);
  session.run("cmdline.next_completion", undefined);
  assert.deepEqual(act(session, "mute"), { kind: "tab_rows_action", action: "unmute", tab_ids: [12] });
  assert.deepEqual(act(session, "pin"), { kind: "tab_rows_action", action: "unpin", tab_ids: [12] });
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  select_key(session, "toggle");
  assert.deepEqual(unload_key(session), { kind: "tab_rows_action", action: "load", tab_ids: [13, 14] });
});

test("escape clears a non-empty selection first, and a second escape does what it does without one", async () => {
  const { session } = await listed();
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  assert.equal(session.run("mode.escape", undefined).kind, "render");
  assert.deepEqual(marked(session), []);
  assert.equal(session.get_rows().length, 4);
  session.run("mode.escape", undefined);
  assert.equal(session.get_rows().length, 0);
  assert.equal(session.run("mode.escape", undefined).kind, "close");
});

test("list.select clear drops every mark", async () => {
  const { session } = await listed();
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  select_key(session);
  select_key(session, "clear");
  assert.deepEqual(marked(session), []);
});

test("after a close the highlight goes to the first row below the closed rows, else to the row above", async () => {
  const below = await listed();
  below.session.run("cmdline.next_completion", undefined);
  below.session.run("cmdline.next_completion", undefined);
  select_key(below.session);
  select_key(below.session);
  below.session.run("cmdline.history", { direction: "prev" });
  below.session.run("cmdline.history", { direction: "prev" });
  assert.deepEqual(act(below.session, "close"), { kind: "tab_rows_action", action: "close", tab_ids: [12, 13] });
  below.change_tabs([TABS[0]!, TABS[3]!]);
  assert.equal(below.session.get_rows()[below.session.get_selected()]?.tab?.id, 14);

  const above = await listed();
  above.session.run("cmdline.prev_completion", undefined);
  select_key(above.session);
  assert.equal(above.session.get_selected(), 3);
  assert.deepEqual(act(above.session, "close"), { kind: "tab_rows_action", action: "close", tab_ids: [14] });
  above.change_tabs([TABS[0]!, TABS[1]!, TABS[2]!]);
  assert.equal(above.session.get_rows()[above.session.get_selected()]?.tab?.id, 13);

  const single = await listed();
  single.session.run("cmdline.next_completion", undefined);
  single.session.run("cmdline.next_completion", undefined);
  assert.deepEqual(act(single.session, "close"), { kind: "tab_rows_action", action: "close", tab_ids: [12] });
  single.change_tabs([TABS[0]!, TABS[2]!, TABS[3]!]);
  assert.equal(single.session.get_rows()[single.session.get_selected()]?.tab?.id, 13);
});

test("marks act and clear on a tab list only: another list hides them", async () => {
  const { session } = await listed();
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  session.edit("ta");
  assert.ok(session.get_rows().every((row) => !row.tab));
  session.run("cmdline.next_completion", undefined);
  assert.deepEqual(act(session, "close"), { kind: "render" });
  assert.equal(session.get_message(), "select a tab row first");
  assert.equal(session.run("mode.escape", undefined).kind, "render");
  assert.deepEqual(marked(session), [11]);
  session.edit("tab ");
  assert.equal(act(session, "close").kind, "tab_rows_action");
});

test("unload leaves the active tab out of the loaded count, so it can still load the others", async () => {
  const tabs: TabItem[] = [{ ...TABS[0]!, active: true }, { ...TABS[1]!, discarded: true }, { ...TABS[2]!, discarded: true }, TABS[3]!];
  const { session } = await listed(tabs);
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  select_key(session);
  select_key(session);
  assert.deepEqual(unload_key(session), { kind: "tab_rows_action", action: "load", tab_ids: [11, 12, 13] });
});

test("a close of other tabs leaves no target behind for a later close of the highlighted tab", async () => {
  const { session, change_tabs } = await listed();
  session.run("cmdline.next_completion", undefined);
  select_key(session);
  session.run("cmdline.history", { direction: "next" });
  session.run("cmdline.history", { direction: "next" });
  session.run("cmdline.history", { direction: "next" });
  assert.equal(session.get_rows()[session.get_selected()]?.tab?.id, 14);
  act(session, "close");
  change_tabs([TABS[1]!, TABS[2]!, TABS[3]!]);
  assert.equal(session.get_rows()[session.get_selected()]?.tab?.id, 14);
  change_tabs([TABS[1]!, TABS[2]!]);
  assert.equal(session.get_selected(), -1);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { anything_ranked } from "../../src/cmdline/completion/anything.ts";
import { create_model_client } from "../../src/cmdline/completion/model_client.ts";
import { create_live_source } from "../../src/cmdline/completion/live.ts";
import { create_completer } from "../../src/cmdline/completion/sources.ts";
import { create_session } from "../../src/cmdline/session.ts";
import { decode_ref, FINDER_PARAM } from "../../src/shared/anything_ref.ts";
import type { AnythingRef } from "../../src/shared/anything_ref.ts";
import type { CommandMeta } from "../../src/shared/command.ts";
import type { AnythingItems, CompleteItemsAnswer, EngineItem, TabItem } from "../../src/shared/messages.ts";
import { parse_command_line } from "../../src/shared/registry/index.ts";
import { create_word_lookup } from "../../src/cmdline/word_lookup.ts";
import type { Row } from "../../src/cmdline/completion/sources.ts";

const COMMANDS: CommandMeta[] = [
  {
    id: "open.anything",
    name: "anything",
    label: "Find anything",
    intent: "Find a page.",
    params: [
      { name: "query", type: "string", rest: true, main: true, values: { from: "anything" } },
      { name: "where", type: "enum", values: ["here", "tab", "background", "window"], default: "here", short: { tab: "t", background: "b", window: "w" } },
    ],
  },
  { id: "tab.close", name: "tab.close", label: "Close", intent: "Close." },
];
const lookup = create_word_lookup(COMMANDS, {});
const ENGINES: EngineItem[] = [
  { name: "duck", label: "DuckDuckGo", available: true },
  { name: "github", label: "GitHub", available: true, keyword: "gh" },
  { name: "wiki", label: "Wikipedia", available: false, keyword: "w" },
];

const tab = (id: number, title: string, url: string, extra: Partial<TabItem> = {}): TabItem => ({ id, number: id, title, url, ...extra });
const TABS: TabItem[] = [tab(1, "Current page", "https://current.test/", { active: true }), tab(2, "Alpha notes", "https://alpha.test/"), tab(3, "Beta notes", "https://beta.test/")];
const ITEMS: AnythingItems = {
  tab_used: { 1: 900, 2: 100, 3: 500 },
  quickmarks: [
    { key: "a", url: "https://alpha.test/" },
    { key: "n", url: "https://notes.test/" },
  ],
  bookmarks: [
    { title: "Notes bookmark", url: "https://notes.test/" },
    { title: "Other notes", url: "https://other.test/" },
  ],
  history: [
    { title: "History notes", url: "https://history.test/" },
    { title: "Other notes", url: "https://other.test/" },
    { title: "Current page", url: "https://current.test/" },
  ],
  closed: [{ session_id: "s9", title: "Closed notes", url: "https://closed.test/" }],
  history_max: 1,
};

function make(items: AnythingItems = ITEMS) {
  const live = create_live_source({
    ask: async (kind): Promise<CompleteItemsAnswer | undefined> => ({ items: (kind === "engines" ? ENGINES : items) as CompleteItemsAnswer["items"] }),
    tabs: () => TABS,
    all_tabs: () => TABS,
    on_ready: () => {},
  });
  const session = create_session({
    history: [],
    parse: (text) => parse_command_line(lookup, text, { search_engines: [], containers: [] }),
    complete: create_completer(lookup, COMMANDS, {}, { search_engines: [], containers: [] }, "normal", live),
    has_param: (command_id, name) => lookup.find(command_id)?.params?.some((param) => param.name === name) === true,
    tabs: () => TABS,
    precheck: () => undefined,
  });
  session.open("anything ");
  const type = async (text: string) => {
    session.edit(`anything ${text}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.source_ready();
  };
  return { session, type };
}

const names = (rows: readonly Row[]) => rows.map((row) => `${row.tag ?? "tab"}:${row.name}`);
const ref_of = (row: Row | undefined): AnythingRef | undefined => (row?.ref === undefined ? undefined : decode_ref(row.ref));

test("empty query: quickmarks, tabs by last use without the current one, history, closed tabs; no bookmarks or search rows", async () => {
  const { session, type } = make();
  await type("");
  // The history row of an address that is a tab or a quickmark is gone. The history cap is 1.
  assert.deepEqual(names(session.get_rows()), ["qm:n", "tab:3: Beta notes", "tab:2: Alpha notes", "hist:History notes", "closed:Closed notes"]);
  // The alpha quickmark shows as the tab, so no `a` quickmark row.
  assert.equal(session.get_selected(), -1);
});

test("typed query: groups keep their order and an address shows once, as the first group that holds it", async () => {
  const { session, type } = make();
  await type("notes");
  assert.deepEqual(names(session.get_rows()), [
    "tab:3: Beta notes",
    "tab:2: Alpha notes",
    "qm:n",
    "bm:Other notes",
    "hist:History notes",
    "closed:Closed notes",
    "search:Search: notes",
  ]);
});

test("the first row is highlighted as the user types and the last row searches the default engine", async () => {
  const { session, type } = make();
  await type("notes");
  assert.equal(session.get_selected(), 0);
  assert.deepEqual(ref_of(session.get_rows().at(-1)), { kind: "web", query: "notes" });
});

test("Enter submits the highlighted row's reference, and a preview moves it", async () => {
  const { session, type } = make();
  await type("notes");
  let effect = session.run("cmdline.submit", undefined);
  assert.equal(effect.kind, "submit");
  assert.deepEqual(decode_ref((effect as { invocation: { args: Record<string, string> } }).invocation.args[FINDER_PARAM] as string), { kind: "tab", id: 3 });
  session.run("cmdline.history", { direction: "next" });
  assert.equal(session.get_selected(), 1);
  effect = session.run("cmdline.submit", undefined);
  assert.deepEqual(decode_ref((effect as { invocation: { args: Record<string, string> } }).invocation.args[FINDER_PARAM] as string), { kind: "tab", id: 2 });
});

test("Shift+Enter sets where on a command that has it, and Enter keeps the typed one", async () => {
  const { session, type } = make();
  await type("notes");
  const shifted = session.run("cmdline.submit", { where: "tab" });
  assert.equal((shifted as { invocation: { args: Record<string, string> } }).invocation.args.where, "tab");
  // The compiled keymap gives plain Enter an empty where.
  const empty = session.run("cmdline.submit", { where: "" });
  assert.equal((empty as { invocation: { args: Record<string, string> } }).invocation.args.where, undefined);
  const plain = session.run("cmdline.submit", undefined);
  assert.equal((plain as { invocation: { args: Record<string, string> } }).invocation.args.where, undefined);
  session.edit("tab.close");
  const without = session.run("cmdline.submit", { where: "tab" });
  assert.equal((without as { invocation: { args?: Record<string, string> } }).invocation.args?.where, undefined);
});

test("with no query nothing is highlighted and Enter has no row to open", async () => {
  const { session, type } = make();
  await type("");
  const effect = session.run("cmdline.submit", undefined);
  assert.equal((effect as { invocation: { args?: Record<string, string> } }).invocation.args?.[FINDER_PARAM], undefined);
});

test("row keys act on the highlighted tab row", async () => {
  const { session, type } = make();
  await type("alpha");
  assert.equal(session.get_rows()[0]?.tab?.id, 2);
  const effect = session.run("list.act", { action: "close" });
  assert.deepEqual(effect, { kind: "tab_rows_action", action: "close", tab_ids: [2] });
});

test("an engine keyword with a space and more text puts that engine's row before the default row", () => {
  const input = { usage: "", tabs: [], items: { ...ITEMS, quickmarks: [], bookmarks: [], history: [], closed: [] }, engines: ENGINES };
  const rows = (word: string) => anything_ranked({ ...input, word });
  assert.deepEqual(rows("gh some repo").map(ref_of), [
    { kind: "engine", engine: "github", query: "some repo" },
    { kind: "web", query: "gh some repo" },
  ]);
  // Case-sensitive, no text after it, no space, and an engine the page cannot fill give the default row only.
  for (const word of ["GH repo", "gh ", "gh", "w repo"]) assert.deepEqual(rows(word).map(ref_of), [{ kind: "web", query: word.trim() }], word);
  assert.deepEqual(rows(""), []);
});

test("a reference round trips and a plain query is not one", () => {
  const ref: AnythingRef = { kind: "engine", engine: "github", query: "a b" };
  assert.deepEqual(decode_ref(JSON.stringify(ref)), undefined);
  assert.equal(decode_ref("plain text"), undefined);
  assert.equal(decode_ref("\u0001{\"kind\":\"tab\",\"id\":\"x\"}"), undefined);
  assert.equal(decode_ref("\u0001nope"), undefined);
});

test("speed: ranking 1000 history rows, 3000 bookmarks and 300 tabs per key", async () => {
  const many: AnythingItems = {
    ...ITEMS,
    history: Array.from({ length: 1000 }, (_, index) => ({ title: `History page ${index} about topic ${index % 17}`, url: `https://h${index}.example.test/path/${index}` })),
    bookmarks: Array.from({ length: 3000 }, (_, index) => ({ title: `Bookmark ${index} on subject ${index % 23}`, url: `https://b${index}.example.test/read/${index}` })),
  };
  const tabs = Array.from({ length: 300 }, (_, index) => tab(index + 10, `Tab ${index} reading`, `https://t${index}.example.test/`));
  const live = create_live_source({ ask: async (kind) => ({ items: (kind === "engines" ? ENGINES : many) as CompleteItemsAnswer["items"] }), tabs: () => tabs, all_tabs: () => tabs, on_ready: () => {} });
  const complete = create_completer(lookup, COMMANDS, {}, { search_engines: [], containers: [] }, "normal", live);
  complete("anything x", 10);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const text = "anything read topic";
  const runs = 20;
  const started = performance.now();
  for (let run = 0; run < runs; run++) complete(text.slice(0, 10 + (run % 9)), 10 + (run % 9));
  const per_key = (performance.now() - started) / runs;
  console.log(`finder per-key rank time: ${per_key.toFixed(2)} ms`);
  assert.ok(per_key < 100, `${per_key} ms per key`);
});

test("empty query: only the line's own tab is left out, not the active tab of another window", async () => {
  const base = { favicon_url: "", site: "", pinned: false, muted: false, audible: false, discarded: false, previous: false, container: "", container_name: "", container_color: "", container_icon: "" };
  const row = (id: number, window_id: number, active: boolean) => ({ ...base, id, window_id, index: 0, title: `Tab ${id}`, url: `https://t${id}.test/`, active, window_number: window_id === 10 ? 1 : 2 });
  const client = create_model_client({ line_window_id: 10, all_windows: false, request_resync: () => {}, on_change: () => {} });
  client.receive({ type: "snapshot", rev: 0, tabs: [row(1, 10, true), row(2, 11, true), row(3, 11, false)] });
  const live = create_live_source({
    ask: async (kind): Promise<CompleteItemsAnswer | undefined> => ({ items: (kind === "engines" ? [] : { ...ITEMS, quickmarks: [], bookmarks: [], history: [], closed: [] }) as CompleteItemsAnswer["items"] }),
    tabs: () => client.items(),
    all_tabs: () => client.all_items(),
    on_ready: () => {},
  });
  const complete = create_completer(lookup, COMMANDS, {}, { search_engines: [], containers: [] }, "normal", live);
  complete("anything ", 9);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(complete("anything ", 9).rows.map((found) => found.tab?.id).sort(), [2, 3]);
});

test("a closed tab wins over the history row of its address, in the empty list and with a query", () => {
  const items: AnythingItems = {
    ...ITEMS,
    quickmarks: [],
    bookmarks: [],
    history: [
      { title: "Closed notes", url: "https://closed.test/" },
      { title: "Other history", url: "https://other-history.test/" },
    ],
    history_max: 5,
  };
  for (const word of ["", "notes"]) {
    const rows = anything_ranked({ word, usage: "", tabs: [], items, engines: [] });
    const closed = rows.filter((row) => row.tag === "closed");
    assert.equal(closed.length, 1, word);
    assert.deepEqual(ref_of(closed[0]), { kind: "closed", session_id: "s9" });
    assert.equal(rows.filter((row) => row.tag === "hist" && row.description === "https://closed.test/").length, 0, word);
  }
});

test("a keyword query puts the engine row first and highlighted, ahead of a tab and a bookmark that also match", async () => {
  const items: AnythingItems = { ...ITEMS, bookmarks: [{ title: "gh rust bookmark", url: "https://rust-mark.test/" }] };
  const live_tabs = [...TABS, tab(4, "gh rust tab", "https://rust-tab.test/")];
  const live = create_live_source({
    ask: async (kind): Promise<CompleteItemsAnswer | undefined> => ({ items: (kind === "engines" ? ENGINES : items) as CompleteItemsAnswer["items"] }),
    tabs: () => live_tabs,
    all_tabs: () => live_tabs,
    on_ready: () => {},
  });
  const session = create_session({
    history: [],
    parse: (text) => parse_command_line(lookup, text, { search_engines: [], containers: [] }),
    complete: create_completer(lookup, COMMANDS, {}, { search_engines: [], containers: [] }, "normal", live),
    has_param: () => true,
    precheck: () => undefined,
  });
  session.open("anything ");
  session.edit("anything gh rust");
  await new Promise((resolve) => setTimeout(resolve, 0));
  session.source_ready();
  const rows = session.get_rows();
  assert.ok(rows.some((row) => row.tab?.id === 4) && rows.some((row) => row.tag === "bm"), "the tab and the bookmark also match");
  assert.deepEqual(ref_of(rows[0]), { kind: "engine", engine: "github", query: "rust" });
  assert.equal(session.get_selected(), 0);
  const effect = session.run("cmdline.submit", undefined) as { invocation: { args: Record<string, string> } };
  assert.deepEqual(decode_ref(effect.invocation.args[FINDER_PARAM] as string), { kind: "engine", engine: "github", query: "rust" });
  assert.deepEqual(ref_of(rows.at(-1)), { kind: "web", query: "gh rust" });
});

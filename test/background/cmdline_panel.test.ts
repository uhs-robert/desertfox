import assert from "node:assert/strict";
import { test } from "node:test";
import { create_cmdline_panel, PANEL_FRAME_ID } from "../../src/background/cmdline_panel.ts";
import type { CmdlinePanelDeps, PanelTab } from "../../src/background/cmdline_panel.ts";
import { CMDLINE_PANEL_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import type { CmdlineOpened } from "../../src/shared/messages/content.ts";

const ID = "desertfox@test";
const PAGE = "moz-extension://me/cmdline.html";
const KEY = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER_KEY = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PANEL = { id: ID, url: `${PAGE}?panel=${KEY}` };
const LOCKED_TAB: PanelTab = { tab_id: 7, window_id: 2, incognito: false, url: "about:preferences", index: 1 };
type Answer = { ok: true; value?: string } | { ok: false; error: string };
const opened_with = (key: string, typed = ""): Answer => ({ ok: true, value: JSON.stringify({ key, typed }) });

function make(options: { answers?: (Answer | Promise<Answer>)[]; tabs?: PanelTab[] } = {}) {
  const store = new Map<string, unknown>();
  const calls: unknown[] = [];
  const lines: unknown[] = [];
  const tabs = options.tabs ?? [LOCKED_TAB];
  // Each call takes the next answer. A test can hold one back to overlap two opens.
  const answers = options.answers ?? [];
  const deps: CmdlinePanelDeps = {
    session: {
      get: async (key) => (typeof key === "string" && store.has(key) ? { [key]: structuredClone(store.get(key)) } : {}),
      set: async (items) => void Object.entries(items).forEach(([key, value]) => store.set(key, structuredClone(value))),
      remove: async (keys) => void [keys].flat().forEach((key) => store.delete(key)),
    } as CmdlinePanelDeps["session"],
    extension_id: ID,
    page_url: PAGE,
    get_tab: async (tab_id) => tabs.find((tab) => tab.tab_id === tab_id),
    call: async (kind, args) => (calls.push([kind, args]), answers.shift() ?? opened_with(KEY)),
    open_line: async (tab, frame_id, mode) => (lines.push([tab.tab_id, frame_id, mode]), { history: ["tab.next"], window_id: tab.window_id } as unknown as CmdlineOpened),
  };
  return { panel: create_cmdline_panel(deps), store, calls, lines, tabs };
}

test("open asks the module with the tab id only, then records the panel at its page's address with the keys typed meanwhile", async () => {
  const { panel, store, calls } = make({ answers: [opened_with(KEY, "u\u0007x")] });
  assert.equal(await panel.open(7, "open "), true);
  assert.deepEqual(calls, [["cmdline_panel.open", { tab_id: 7 }]]);
  assert.deepEqual(store.get(CMDLINE_PANEL_STORAGE_KEY), { tab_id: 7, window_id: 2, incognito: false, mode: "normal", text: "open ux", url: PANEL.url, opened: false });
  const long = make({ answers: [opened_with(KEY, "y".repeat(500))] });
  await long.panel.open(7, "");
  assert.equal((long.store.get(CMDLINE_PANEL_STORAGE_KEY) as { text: string }).text.length, 64);
});

test("a refusal, a module with no handler or a bad answer records nothing and keeps the record before it, so the caller falls back to the address bar", async () => {
  const { panel, store } = make({ answers: [opened_with(KEY), { ok: false, error: "The command line is already open" }, { ok: true }, opened_with("../popup.html"), { ok: true, value: "not json" }] });
  await panel.open(7, "first");
  const before = store.get(CMDLINE_PANEL_STORAGE_KEY);
  for (let attempt = 0; attempt < 4; attempt++) assert.equal(await panel.open(7, ""), false, String(attempt));
  assert.deepEqual(store.get(CMDLINE_PANEL_STORAGE_KEY), before);
  assert.equal(await make().panel.open(99, ""), false, "a tab that is gone");
});

test("overlapping opens wait their turn, so a failed one never removes the newer record", async () => {
  let answer_first: (answer: Answer) => void = () => undefined;
  const { panel, store, calls } = make({ answers: [new Promise<Answer>((resolve) => (answer_first = resolve)), opened_with(OTHER_KEY)] });
  const older = panel.open(7, "older");
  const newer = panel.open(7, "newer");
  const page = panel.opened({ id: ID, url: `${PAGE}?panel=${OTHER_KEY}` });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1, "the second open asked the module while the first waited");
  answer_first({ ok: false, error: "The tab that asked is no longer selected" });
  assert.equal(await older, false);
  assert.equal(await newer, true);
  assert.equal((store.get(CMDLINE_PANEL_STORAGE_KEY) as { text: string }).text, "newer");
  assert.ok(await page, "the newer panel's page, which asked while the opens were under way, gets its line");
});

test("only the extension's own cmdline.html with no tab, at the panel's address, gets the panel line, once", async () => {
  const { panel, lines } = make();
  assert.equal(await panel.opened(PANEL), undefined, "no record yet");
  await panel.open(7, "tab.move ");
  const refused = [
    { ...PANEL, tab: { id: 7, windowId: 2 } },
    { ...PANEL, url: PAGE },
    { ...PANEL, url: `${PAGE}?panel=${OTHER_KEY}` },
    { ...PANEL, url: "moz-extension://me/popup.html" },
    { ...PANEL, id: "other@test" },
  ];
  for (const sender of refused) assert.equal(await panel.opened(sender), undefined, JSON.stringify(sender));
  const opened = await panel.opened(PANEL);
  assert.equal(opened?.text, "tab.move ");
  assert.equal(opened?.mode, "normal");
  assert.deepEqual(opened?.history, ["tab.next"]);
  assert.deepEqual(lines, [[7, PANEL_FRAME_ID, "normal"]]);
  assert.equal(await panel.opened(PANEL), undefined, "a second page at the same address");
});

test("two pages at once: only one takes the panel", async () => {
  const { panel } = make();
  await panel.open(7, "");
  const answers = await Promise.all([panel.opened(PANEL), panel.opened(PANEL)]);
  assert.equal(answers.filter((answer) => answer !== undefined).length, 1);
});

test("a tab that moved to another window or closed gets no line", async () => {
  const { panel, tabs } = make();
  await panel.open(7, "");
  tabs[0] = { ...LOCKED_TAB, window_id: 5 };
  assert.equal(await panel.opened(PANEL), undefined);
});

test("asker_of: a frame of a tab as before, the opened panel for its tab, and nobody else", async () => {
  const { panel } = make({ tabs: [{ ...LOCKED_TAB, incognito: true }] });
  assert.deepEqual(await panel.asker_of({ id: ID, url: "https://example.com/", frameId: 2, tab: { id: 4, windowId: 1, incognito: false } }), { tab_id: 4, frame_id: 2, window_id: 1, incognito: false });
  assert.equal(await panel.asker_of({ tab: { id: 4, windowId: 1 } }), undefined, "a tab sender with no frame");
  assert.equal(await panel.asker_of(PANEL), undefined, "no record");
  await panel.open(7, "");
  assert.equal(await panel.asker_of(PANEL), undefined, "recorded but not opened yet");
  await panel.opened(PANEL);
  assert.deepEqual(await panel.asker_of(PANEL), { tab_id: 7, frame_id: PANEL_FRAME_ID, window_id: 2, incognito: true });
  // Another copy of the page with no tab, in another extension's frame or a sidebar, has no key or another one.
  for (const url of [PAGE, `${PAGE}?panel=${OTHER_KEY}`, "moz-extension://me/popup.html"]) assert.equal(await panel.asker_of({ id: ID, url }), undefined, url);
});

test("the record goes when the line ends, its tab closes or loads, another tab of its window comes up or another window takes the focus", async () => {
  const ends: [string, (panel: ReturnType<typeof make>["panel"]) => Promise<void>][] = [
    ["Enter or Escape", (panel) => panel.closed(PANEL)],
    ["its tab closed or loaded", (panel) => panel.forget(7)],
    ["a tab switch in its window", (panel) => panel.left(2)],
    ["another window took the focus", (panel) => panel.focused(3)],
    ["the focus left Firefox", (panel) => panel.focused(-1)],
  ];
  for (const [what, end] of ends) {
    const { panel, store } = make();
    await panel.open(7, "");
    await panel.opened(PANEL);
    await end(panel);
    assert.equal(store.has(CMDLINE_PANEL_STORAGE_KEY), false, what);
    assert.equal(await panel.asker_of(PANEL), undefined, what);
  }
  const stays: [string, (panel: ReturnType<typeof make>["panel"]) => Promise<void>][] = [
    ["another page closed", (panel) => panel.closed({ id: ID, url: `${PAGE}?panel=${OTHER_KEY}` })],
    ["another tab closed", (panel) => panel.forget(8)],
    ["a tab switch in another window", (panel) => panel.left(3)],
    ["its own window took the focus", (panel) => panel.focused(2)],
  ];
  for (const [what, end] of stays) {
    const { panel } = make();
    await panel.open(7, "");
    await panel.opened(PANEL);
    await end(panel);
    assert.ok(await panel.asker_of(PANEL), what);
  }
});

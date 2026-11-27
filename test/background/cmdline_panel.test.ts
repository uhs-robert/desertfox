import assert from "node:assert/strict";
import { test } from "node:test";
import { create_cmdline_panel, PANEL_FRAME_ID } from "../../src/background/cmdline_panel.ts";
import type { CmdlinePanelDeps, PanelTab } from "../../src/background/cmdline_panel.ts";
import { CMDLINE_PANEL_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import type { CmdlineOpened } from "../../src/shared/messages/content.ts";

const ID = "desertfox@test";
const PAGE = "moz-extension://me/cmdline.html";
const PANEL = { id: ID, url: PAGE };
const LOCKED_TAB: PanelTab = { tab_id: 7, window_id: 2, incognito: false, url: "about:preferences", index: 1 };

function make(options: { answer?: { ok: true } | { ok: false; error: string }; tabs?: PanelTab[] } = {}) {
  const store = new Map<string, unknown>();
  const calls: unknown[] = [];
  const lines: unknown[] = [];
  const tabs = options.tabs ?? [LOCKED_TAB];
  const deps: CmdlinePanelDeps = {
    session: {
      get: async (key) => (typeof key === "string" && store.has(key) ? { [key]: structuredClone(store.get(key)) } : {}),
      set: async (items) => void Object.entries(items).forEach(([key, value]) => store.set(key, structuredClone(value))),
      remove: async (keys) => void [keys].flat().forEach((key) => store.delete(key)),
    } as CmdlinePanelDeps["session"],
    extension_id: ID,
    page_url: PAGE,
    get_tab: async (tab_id) => tabs.find((tab) => tab.tab_id === tab_id),
    call: async (kind, args) => (calls.push([kind, args]), options.answer ?? { ok: true }),
    open_line: async (tab, frame_id, mode) => (lines.push([tab.tab_id, frame_id, mode]), { history: ["tab.next"], window_id: tab.window_id } as unknown as CmdlineOpened),
  };
  return { panel: create_cmdline_panel(deps), store, calls, lines, tabs };
}

test("open records the panel before it asks the module, with the tab id only", async () => {
  const { panel, store, calls } = make();
  assert.equal(await panel.open(7, "open "), true);
  assert.deepEqual(calls, [["cmdline_panel.open", { tab_id: 7 }]]);
  assert.deepEqual(store.get(CMDLINE_PANEL_STORAGE_KEY), { tab_id: 7, window_id: 2, incognito: false, mode: "normal", text: "open ", opened: false });
});

test("a refusal or a module with no handler leaves no record, so the caller falls back to the address bar", async () => {
  const { panel, store } = make({ answer: { ok: false, error: "no handler for this kind" } });
  assert.equal(await panel.open(7, ""), false);
  assert.equal(store.has(CMDLINE_PANEL_STORAGE_KEY), false);
  assert.equal(await panel.open(99, ""), false, "a tab that is gone");
});

test("only the extension's own top-level cmdline.html with no tab gets the panel line, once", async () => {
  const { panel, lines } = make();
  assert.equal(await panel.opened(PANEL), undefined, "no record yet");
  await panel.open(7, "tab.move ");
  const refused = [
    { ...PANEL, tab: { id: 7, windowId: 2 } },
    { ...PANEL, url: "moz-extension://me/popup.html" },
    { ...PANEL, url: `${PAGE}?x` },
    { ...PANEL, id: "other@test" },
    { ...PANEL, frameId: 3 },
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
  assert.equal(await panel.asker_of({ id: ID, url: "moz-extension://me/popup.html" }), undefined, "the toolbar popup");
  await panel.forget(8);
  assert.ok(await panel.asker_of(PANEL), "another tab closed");
  await panel.forget(7);
  assert.equal(await panel.asker_of(PANEL), undefined, "its tab closed");
});

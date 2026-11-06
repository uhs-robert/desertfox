import assert from "node:assert/strict";
import { test } from "node:test";
import { create_open_help, help_name_choices, help_name_url, plan_help_tab } from "../../src/background/open_help.ts";

// The line's frame in each opener tab.
const LINE_FRAME = 3;

function make(openers: number[] = [7]) {
  const opened: unknown[] = [];
  const open_help = create_open_help({
    is_opener: async (tab_id, frame_id) => openers.includes(tab_id) && frame_id === LINE_FRAME,
    is_command: (id) => id === "tab.next" || id === "my snippet",
    help_page_url: "moz-extension://x/help.html",
    open_tab: async (tab) => void opened.push(tab),
  });
  return { open_help, opened };
}

test("a known command opens its card in the foreground next to the asking tab", async () => {
  const { open_help, opened } = make();
  await open_help.open("my snippet", 7, LINE_FRAME);
  assert.deepEqual(opened, [{ url: "moz-extension://x/help.html#command=my%20snippet", openerTabId: 7, active: true }]);
});

test("an unknown id opens the Commands page at its top", async () => {
  const { open_help, opened } = make();
  await open_help.open("nope", 7, LINE_FRAME);
  assert.deepEqual(opened, [{ url: "moz-extension://x/help.html#/commands", openerTabId: 7, active: true }]);
});

test("a sender with no ticket, no tab, another frame or a non-string id gets nothing", async () => {
  const { open_help, opened } = make();
  await open_help.open("tab.next", 7, 5);
  await open_help.open("tab.next", 7, undefined);
  await open_help.open("tab.next", 8, LINE_FRAME);
  await open_help.open("tab.next", undefined, LINE_FRAME);
  await open_help.open({}, 7, LINE_FRAME);
  assert.deepEqual(opened, []);
});

const ids = new Set(["scroll.top", "my snippet"]);
const base = "moz-extension://x/help.html";

test("help_name_url maps a command id to its card and a page name to its page", () => {
  assert.equal(help_name_url(base, "scroll.top", ids), `${base}#command=scroll.top`);
  assert.equal(help_name_url(base, "quick_start", ids), `${base}#/quick-start`);
  assert.equal(help_name_url(base, "search_engines", ids), `${base}#/search-engines`);
  assert.equal(help_name_url(base, "", ids), `${base}#/`);
  assert.equal(help_name_url(base, "nope", ids), undefined);
});

test("help_name_choices lists the pages, then the commands, and no Quick Start section", () => {
  assert.deepEqual(help_name_choices(["scroll.top"]), ["home", "quick_start", "commands", "search_engines", "styling", "scroll.top"]);
});

const HELP = "moz-extension://x/help.html";

test("the help tab asking for a target updates itself", () => {
  const plan = plan_help_tab(HELP, HELP + "#command=tab.next", { id: 3, window_id: 1, url: HELP + "#/commands" });
  assert.deepEqual(plan, { kind: "update", tab_id: 3, url: HELP + "#command=tab.next" });
});

test("any other tab opens a new tab beside it", () => {
  const plan = plan_help_tab(HELP, HELP + "#/", { id: 3, window_id: 1, url: "https://example.com/" });
  assert.deepEqual(plan, { kind: "create", url: HELP + "#/", opener: { openerTabId: 3, windowId: 1 } });
});

test("a page whose address only starts like the help page opens a new tab", () => {
  assert.equal(plan_help_tab(HELP, HELP, { id: 3, window_id: 1, url: HELP + "x.html" }).kind, "create");
});

test("no asking tab opens a plain new tab", () => {
  assert.deepEqual(plan_help_tab(HELP, HELP, { id: undefined, window_id: undefined, url: undefined }), { kind: "create", url: HELP });
});

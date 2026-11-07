import assert from "node:assert/strict";
import { test } from "node:test";
import { add_to_history, create_cmdline_service, HISTORY_LIMIT } from "../../src/background/cmdline_service.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
// The frame id of the line's own iframe.
const LINE_FRAME = 3;

// `slow_set` makes every write take a timer turn, as a real storage write does.
// `stuck_ticket` is a ticket whose lookup never finishes, as a flood of guesses can hold up storage.
function make({ slow_set = false, stuck_ticket = "" } = {}) {
  const data: Record<string, unknown> = {};
  const storage = {
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => {
      if (slow_set) await tick();
      Object.assign(data, items);
    },
  } as unknown as Parameters<typeof create_cmdline_service>[0]["storage"];
  const session_data: Record<string, unknown> = {};
  const tickets = {
    get: (key: string) =>
      key.endsWith(stuck_ticket) && stuck_ticket !== "" ? new Promise(() => {}) : Promise.resolve(key in session_data ? { [key]: session_data[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(session_data, items),
    remove: async (keys: string | string[]) => void [keys].flat().forEach((key) => delete session_data[key]),
  } as unknown as Parameters<typeof create_cmdline_service>[0]["tickets"];
  let issued = 0;
  const service = create_cmdline_service({
    storage,
    tickets,
    new_ticket: () => `ticket-${++issued}`,
    sources: async () => ({ search_engines: ["arch"], containers: [] }),
    container_stores: async () => [{ name: "default", cookie_store_id: "firefox-default" }],
    page_config: async () => ({ commands: [{ id: "my.snippet", label: "Mine", intent: "page" }], help_ids: ["tab.next"], command_aliases: { g: "open.search" }, prompt: ">> ", all_windows: false, statusbar_widgets: ["url", "tabs"] }),
    tab_count: async (window_id) => (window_id === 10 ? 4 : 0),
  });
  // Opens the line the way the host and the page do: a ticket for tab 7, redeemed from the line's frame in tab 7.
  const open = async () => (await service.open(await service.issue_ticket(7), 7, LINE_FRAME, 10))!;
  return { service, open, session_data };
}

test("the status is the tab's address and place in its window, and the widgets come from the settings", async () => {
  const { service } = make();
  const opened = await service.open(await service.issue_ticket(7), 7, LINE_FRAME, 10, { url: "https://example.org/a", index: 2 });
  assert.deepEqual(opened?.status, { url: "https://example.org/a", tab_index: 2, tab_count: 4 });
  assert.deepEqual(opened?.statusbar_widgets, ["url", "tabs"]);
});

test("history keeps order, oldest first", async () => {
  const { service, open } = make();
  for (const text of ["a", "b", "c"]) await service.record(text, false);
  assert.deepEqual((await open()).history, ["a", "b", "c"]);
});

test("a line offers the containers, and a private line offers none", async () => {
  const { service } = make();
  assert.deepEqual((await service.open(await service.issue_ticket(7), 7, LINE_FRAME, 10))?.container_stores, [{ name: "default", cookie_store_id: "firefox-default" }]);
  assert.deepEqual((await service.open(await service.issue_ticket(7), 7, LINE_FRAME, 10, true))?.container_stores, []);
});

test("history keeps the last 100 and drops the oldest", async () => {
  const { service, open } = make();
  for (let index = 0; index < HISTORY_LIMIT + 5; index++) await service.record(`cmd ${index}`, false);
  const { history } = await open();
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(history[0], "cmd 5");
  assert.equal(history.at(-1), `cmd ${HISTORY_LIMIT + 4}`);
});

test("nothing from a private window is stored", async () => {
  const { service, open } = make();
  await service.record("secret", true);
  await service.record("open", false);
  assert.deepEqual((await open()).history, ["open"]);
});

test("a repeated command moves to the newest place", () => {
  assert.deepEqual(add_to_history(["a", "b", "c"], "a"), ["b", "c", "a"]);
});

test("records sent without waiting all land, in order", async () => {
  const { service, open } = make();
  await Promise.all(["a", "b", "c", "d"].map((text) => service.record(text, false)));
  assert.deepEqual((await open()).history, ["a", "b", "c", "d"]);
});

test("opening returns the lists that bare words read from", async () => {
  const { service, open } = make();
  assert.deepEqual((await open()).sources, { search_engines: ["arch"], containers: [] });
});

test("a line reopened before the last record is written still shows it", async () => {
  const { service, open } = make({ slow_set: true });
  void service.record("scroll down", false);
  assert.deepEqual((await open()).history, ["scroll down"]);
});

test("opening returns the runtime commands, the configured aliases and the user CSS", async () => {
  const { service, open } = make();
  const opened = await open();
  assert.deepEqual([opened.commands.map((command) => command.id), opened.command_aliases, opened.prompt], [["my.snippet"], { g: "open.search" }, ">> "]);
});

test("the page learns its tab's window and the all-windows setting", async () => {
  const { service } = make();
  const opened = await service.open(await service.issue_ticket(7), 7, LINE_FRAME, 10);
  assert.deepEqual([opened?.window_id, opened?.all_windows], [10, false]);
  assert.equal(await service.open(await service.issue_ticket(7), 7, LINE_FRAME, undefined), undefined);
});

test("a copy of the page that the host did not open gets nothing", async () => {
  const { service } = make();
  await service.record("open https://private.example", false);
  // A site that embeds its own copy picks the frame name, so the page sends whatever ticket the site chose.
  assert.equal(await service.open("ticket-1", 7, LINE_FRAME, 10), undefined);
  assert.equal(await service.open("", 7, LINE_FRAME, 10), undefined);
  assert.equal(await service.open(undefined, 7, LINE_FRAME, 10), undefined);
});

test("a ticket opens the line once, and only from the tab it was issued for", async () => {
  const { service } = make();
  const ticket = await service.issue_ticket(7);
  assert.equal(await service.open(ticket, 8, LINE_FRAME, 10), undefined);
  const other = await service.issue_ticket(7);
  assert.ok(await service.open(other, 7, LINE_FRAME, 10));
  assert.equal(await service.open(other, 7, LINE_FRAME, 10), undefined);
  assert.equal(await service.issue_ticket(undefined), undefined);
});

test("two redemptions of one ticket at once give the data only once", async () => {
  const { service } = make();
  const ticket = await service.issue_ticket(7);
  const answers = await Promise.all([service.open(ticket, 7, LINE_FRAME, 10), service.open(ticket, 7, LINE_FRAME, 10)]);
  assert.equal(answers.filter((answer) => answer !== undefined).length, 1);
});

test("a guessed ticket that is slow to look up does not hold up the real one", async () => {
  const { service } = make({ stuck_ticket: "guess" });
  const ticket = await service.issue_ticket(7);
  void service.open("guess", 7, LINE_FRAME, 10);
  const answer = await Promise.race([service.open(ticket, 7, LINE_FRAME, 10), new Promise((resolve) => setTimeout(() => resolve("held up"), 200))]);
  assert.notEqual(answer, "held up");
  assert.ok(answer);
});

test("a redeemed ticket marks its tab as an opener, and a refused one does not", async () => {
  const { service, open, session_data } = make();
  assert.equal(await service.is_opener(7, LINE_FRAME), false);
  const ticket = await service.issue_ticket(7);
  assert.equal(await service.open(ticket, 8, LINE_FRAME, 10), undefined);
  assert.equal(await service.open("guess", 7, LINE_FRAME, 10), undefined);
  assert.equal(await service.is_opener(7, LINE_FRAME), false);
  assert.equal(await service.is_opener(8, LINE_FRAME), false);
  await open();
  assert.equal(await service.is_opener(7, LINE_FRAME), true);
  assert.equal(await service.is_opener(undefined, LINE_FRAME), false);
  assert.equal(Object.keys(session_data).filter((key) => key.includes("opener")).length, 1);
});

test("only the frame that redeemed the ticket is an opener, and the next line replaces it", async () => {
  const { service } = make();
  assert.equal(await service.open(await service.issue_ticket(7), 7, undefined, 10), undefined);
  assert.ok(await service.open(await service.issue_ticket(7), 7, 3, 10));
  assert.deepEqual([await service.is_opener(7, 3), await service.is_opener(7, 5), await service.is_opener(7, 0), await service.is_opener(7, undefined)], [true, false, false, false]);
  // Each line mounts a new frame, so after the next line the old frame (closed, or a copy that kept its id) is no opener.
  assert.ok(await service.open(await service.issue_ticket(7), 7, 9, 10));
  assert.deepEqual([await service.is_opener(7, 3), await service.is_opener(7, 9)], [false, true]);
});

test("an older line whose redemption lands late does not take the mark from the newer line", async () => {
  const { service } = make();
  const old_ticket = await service.issue_ticket(7);
  const new_ticket = await service.issue_ticket(7);
  assert.ok(await service.open(new_ticket, 7, 4, 10));
  assert.equal(await service.open(old_ticket, 7, 3, 10), undefined);
  assert.deepEqual([await service.is_opener(7, 4), await service.is_opener(7, 3)], [true, false]);
});

test("closing the tab removes the opener marker", async () => {
  const { service, open } = make();
  await open();
  await service.forget_opener(7);
  assert.equal(await service.is_opener(7, LINE_FRAME), false);
});

test("a new page in the tab removes the marker, a finished load or a title change does not", async () => {
  const { service, open } = make();
  await open();
  await service.forget_opener_on_navigation(7, { status: "complete" });
  await service.forget_opener_on_navigation(7, {});
  assert.equal(await service.is_opener(7, LINE_FRAME), true);
  await service.forget_opener_on_navigation(8, { status: "loading" });
  assert.equal(await service.is_opener(7, LINE_FRAME), true);
  await service.forget_opener_on_navigation(7, { status: "loading" });
  assert.equal(await service.is_opener(7, LINE_FRAME), false);
});

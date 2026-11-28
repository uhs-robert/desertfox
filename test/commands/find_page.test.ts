import assert from "node:assert/strict";
import { test } from "node:test";
import { FIND_TEXT_PATTERN, find_reply_of, find_toast_of, make_find_page_handlers, FIND_NEEDS_NEWER_MODULE, FIND_PRIVATE_REFUSAL } from "../../src/commands/find.ts";
import { cleaned_find_text } from "../../src/shared/find_line.ts";
import type { FindPageDeps } from "../../src/commands/find.ts";
import type { CommandContext } from "../../src/shared/command.ts";

const CTX: CommandContext = { tab_id: 7, window_id: 1, frame_id: 0, mode: "normal" };
const reply = (result: number, current: number, total: number, limit = 1000) => JSON.stringify({ result, current, total, limit });

function make(over: Partial<FindPageDeps> = {}) {
  const log = { calls: [] as [string, unknown][], lines: [] as string[], toasts: [] as string[] };
  const deps: FindPageDeps = {
    is_private: async () => false,
    open_find_line: async (_tab, direction) => (log.lines.push(direction), true),
    call: async (kind, args) => (log.calls.push([kind, args]), { ok: true, value: reply(0, 3, 12) }),
    read_selection: async () => "chosen",
    toast: async (_ctx, message, kind) => void log.toasts.push(`${kind}: ${message}`),
    ...over,
  };
  return { handlers: make_find_page_handlers(deps), log };
}

test("the toast shows the place among the matches, a wrap, a capped count and a miss", () => {
  assert.deepEqual(find_toast_of({ result: 0, current: 3, total: 12, limit: 1000 }, "x"), { message: "3/12", kind: "info" });
  assert.equal(find_toast_of({ result: 2, current: 1, total: 12, limit: 1000 }, "x").message, "1/12 (wrapped)");
  assert.equal(find_toast_of({ result: 0, current: 5, total: -1, limit: 1000 }, "x").message, "5/1000+");
  assert.equal(find_toast_of({ result: 0, current: 5, total: 1000, limit: 1000 }, "x").message, "5/1000+");
  assert.equal(find_toast_of({ result: 0, current: -1, total: -1, limit: -1 }, "x").message, "Found");
  assert.deepEqual(find_toast_of({ result: 1, current: 0, total: 0, limit: 1000 }, "needle"), { message: 'No match for "needle"', kind: "warning" });
  assert.equal(find_toast_of({ result: 1, current: 0, total: 0, limit: 1000 }, "").message, "No match");
  assert.ok(find_toast_of({ result: 1, current: 0, total: 0, limit: 1000 }, "y".repeat(500)).message.length < 100, "a long text is cut in the toast");
});

test("the module's reply is read as foreign input: whole numbers only", () => {
  assert.deepEqual(find_reply_of(reply(0, 1, 2)), { result: 0, current: 1, total: 2, limit: 1000 });
  for (const bad of [undefined, "", "nope", "[]", "{}", JSON.stringify({ result: "0", current: 1, total: 2, limit: 3 }), JSON.stringify({ result: 0, current: 1.5, total: 2, limit: 3 }), JSON.stringify({ result: 0, current: 1, total: 2 })]) assert.equal(find_reply_of(bad), undefined, String(bad));
});

test("/ and ? open the find line the way they search, and nothing is searched yet", async () => {
  const { handlers, log } = make();
  await handlers.open(CTX, { direction: "forward", source: "typed" });
  await handlers.open(CTX, { direction: "backward", source: "typed" });
  assert.deepEqual(log.lines, ["forward", "backward"]);
  assert.deepEqual(log.calls, []);
});

test("a find line that cannot open says so", async () => {
  const { handlers } = make({ open_find_line: async () => false });
  await assert.rejects(handlers.open(CTX, { direction: "forward", source: "typed" }), /needs the browser module's command line panel/);
});

test("Enter in the line searches the text as typed and toasts the place", async () => {
  const { handlers, log } = make();
  await handlers.text(CTX, { text: "a.*b", direction: "backward" });
  assert.deepEqual(log.calls, [["find.search", { tab_id: 7, text: "a.*b", backwards: 1 }]]);
  assert.deepEqual(log.toasts, ["info: 3/12"]);
});

test("* and # search the selected text, cleaned of runs of white space", async () => {
  const { handlers, log } = make({ read_selection: async () => "  two\n words " });
  await handlers.open(CTX, { direction: "backward", source: "word" });
  assert.deepEqual(log.calls, [["find.search", { tab_id: 7, text: "two words", backwards: 1 }]]);
});

test("* with no selection, or on a page the module cannot read, is refused with no search", async () => {
  const empty = make({ read_selection: async () => "" });
  await assert.rejects(empty.handlers.open(CTX, { direction: "forward", source: "word" }), /Select a word first/);
  const unreadable = make({ read_selection: async () => undefined });
  await assert.rejects(unreadable.handlers.open(CTX, { direction: "forward", source: "word" }), /Only about: pages the browser module can read/);
  assert.deepEqual([...empty.log.calls, ...unreadable.log.calls], []);
});

test("a long selection is cut to the search limit", async () => {
  const { handlers, log } = make({ read_selection: async () => "w".repeat(400) });
  await handlers.open(CTX, { direction: "forward", source: "word" });
  assert.equal(((log.calls[0]![1] as { text: string }).text).length, 256);
});

test("a private tab is refused before the line opens or the module is asked", async () => {
  const { handlers, log } = make({ is_private: async () => true });
  for (const run of [() => handlers.open(CTX, { direction: "forward", source: "typed" }), () => handlers.open(CTX, { direction: "forward", source: "word" }), () => handlers.text(CTX, { text: "x", direction: "forward" }), () => handlers.again(CTX, false)]) await assert.rejects(run(), new RegExp(FIND_PRIVATE_REFUSAL));
  assert.deepEqual([...log.calls, ...log.lines], []);
});

test("n and N ask the module to repeat, the same way or the other", async () => {
  const { handlers, log } = make();
  await handlers.again(CTX, false);
  await handlers.again(CTX, true);
  assert.deepEqual(log.calls, [["find.again", { tab_id: 7, reverse: 0 }], ["find.again", { tab_id: 7, reverse: 1 }]]);
});

test("the module's refusals come back as the refusal text, an older module's as an install hint", async () => {
  const refused = (error: string) => make({ call: async () => ({ ok: false, error }) }).handlers.text(CTX, { text: "x", direction: "forward" });
  await assert.rejects(refused("Find is off in private tabs"), /Find is off in private tabs/);
  await assert.rejects(refused("Needs the browser module"), /Find on this page needs the browser module/);
  await assert.rejects(refused("the kind is not on the allow list"), new RegExp(FIND_NEEDS_NEWER_MODULE));
  await assert.rejects(refused("find.search backwards has the wrong shape"), new RegExp(FIND_NEEDS_NEWER_MODULE));
});

test("a reply that is not whole numbers is refused and toasts nothing", async () => {
  const { handlers, log } = make({ call: async () => ({ ok: true, value: "{\"result\":\"x\"}" }) });
  await assert.rejects(handlers.text(CTX, { text: "x", direction: "forward" }), /gave no answer/);
  assert.deepEqual(log.toasts, []);
});

test("a command with no tab is refused", async () => {
  const { handlers } = make();
  await assert.rejects(handlers.text({ ...CTX, tab_id: undefined }, { text: "x", direction: "forward" }), /No page to search/);
});

test("the schema counts code points and lets through what the cleaning keeps", () => {
  const schema = new RegExp(FIND_TEXT_PATTERN);
  assert.ok(schema.test("\u{1F600}".repeat(256)), "256 emoji are 256 characters");
  assert.equal(schema.test("\u{1F600}".repeat(257)), false);
  assert.ok(schema.test(`a\u2028b\u2029c`), "U+2028 and U+2029 pass, as the cleaning allows");
  for (const bad of ["", "a\tb", "a\u200db", "a\ud800b"]) assert.equal(schema.test(bad), false, JSON.stringify(bad));
  const cleaned = cleaned_find_text(`a\u2028b${"\u{1F600}".repeat(300)}`);
  assert.ok(schema.test(cleaned) && [...cleaned].length === 256, "whatever the cleaning gives passes the schema");
});

test("a core with no find handler gets the install hint", async () => {
  const { handlers } = make({ call: async () => ({ ok: false, error: "no handler for this kind" }) });
  await assert.rejects(handlers.text(CTX, { text: "x", direction: "forward" }), new RegExp(FIND_NEEDS_NEWER_MODULE));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { create_chrome_hints, key_step, label_parts, reading_order, target_rows, text_rows, token_of_key } from "../../src/background/chrome_hints.ts";
import type { ChromeHintDeps, LabelRow, TargetRow } from "../../src/background/chrome_hints.ts";
import { CHROME_HINT_MAX_PARTS, CHROME_HINT_PART_BYTES, CHROME_HINT_TEXT_CHARS, MAX_CHROME_HINT_TEXT_PARTS, EXTENSION_TO_MODULE_KINDS, MODULE_TO_EXTENSION_KINDS, json_bytes, validate_message } from "../../src/shared/browser_module_protocol.ts";
import { CHROME_HINTS_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { DEFAULT_HINT_LETTERS, make_labels } from "../../src/shared/hints/labels.ts";

type Sent = { kind: string; args: Record<string, number | string> };

const page_action_of: ChromeHintDeps["page_action"] = async (keys) => (keys === "f" ? { ok: true, action: "follow" } : keys === "; y l" ? { ok: true, action: "yank" } : { ok: false, problem: "This hint does not run on this page" });

function make({ collect = { ok: true } as { ok: true } | { ok: false; error: string }, pick = { ok: true } as { ok: true } | { ok: false; error: string }, colors = async () => "", page_action = page_action_of, key_line = false } = {}) {
  const bucket = new Map<string, unknown>();
  const pushed: Sent[] = [];
  const called: Sent[] = [];
  const notes: string[] = [];
  let next = 100;
  const deps: ChromeHintDeps = {
    storage: {
      get: async (key) => (bucket.has(key as string) ? { [key as string]: structuredClone(bucket.get(key as string)) } : {}),
      set: async (items) => void Object.entries(items).forEach(([key, value]) => bucket.set(key, structuredClone(value))),
      remove: async (key) => void bucket.delete(key as string),
    },
    push: async (kind, args) => {
      assert.ok(validate_message({ v: 1, id: "p1", kind, args }, EXTENSION_TO_MODULE_KINDS).ok, `${kind} does not pass the protocol's check`);
      pushed.push({ kind, args: args as Sent["args"] });
      return { ok: true };
    },
    call: async (kind, args) => {
      called.push({ kind, args: args as Sent["args"] });
      return kind === "chrome_hints.collect" || kind === "chrome_hints.collect_here" || kind === "devtools_hints.collect" || kind === "page_hints.collect" ? collect : pick;
    },
    letters: async () => [...DEFAULT_HINT_LETTERS],
    colors,
    notify: async (_window_id, message) => void notes.push(message),
    new_session: () => next++,
    page_action,
    key_line: async () => key_line,
  };
  const hints = create_chrome_hints(deps);
  const session = () => bucket.get(CHROME_HINTS_STORAGE_KEY) as { session: number; labels?: LabelRow[]; tokens: string[] } | undefined;
  const draws = () => pushed.filter((sent) => sent.kind === "chrome_hints.draw");
  const shown = (gen: number) => draws().filter((draw) => draw.args.gen === gen).flatMap((draw) => JSON.parse(draw.args.labels as string) as LabelRow[]);
  return { hints, deps, bucket, pushed, called, notes, session, draws, shown };
}

const row = (id: number, left: number, top: number): TargetRow => [id, left, top, 24, 24];
const targets = (session: number, rows: TargetRow[], part = 0, parts = 1) => ({ session, part, parts, targets: JSON.stringify(rows) });
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("the extension's messages fit the protocol's kinds, and the part size stays under the kind's limit", () => {
  assert.equal(EXTENSION_TO_MODULE_KINDS["chrome_hints.draw"]!.max_bytes, CHROME_HINT_PART_BYTES);
  assert.equal(MODULE_TO_EXTENSION_KINDS["chrome_hints.targets"]!.max_bytes, CHROME_HINT_PART_BYTES);
  assert.equal(MODULE_TO_EXTENSION_KINDS["chrome_hints.key"]!.reply, false);
  const rows: LabelRow[] = make_labels(400, [...DEFAULT_HINT_LETTERS]).map((label, index) => [100000 + index, label]);
  const parts = label_parts(rows);
  assert.ok(parts.length > 1, "400 labels fit one part, so the split is not tested");
  assert.deepEqual(parts.flat(), rows);
  for (const part of parts) assert.ok(json_bytes({ v: 1, id: "x".repeat(32), kind: "chrome_hints.draw", sent_at: Date.now(), args: { session: 2 ** 31, gen: 999, part: 31, parts: 32, typed: "abcdefgh", labels: JSON.stringify(part) } })! <= CHROME_HINT_PART_BYTES);
});

test("the module's targets are foreign input: a part with any row that is not five whole numbers is dropped", () => {
  assert.deepEqual(target_rows("[[1,2,3,4,5]]"), [[1, 2, 3, 4, 5]]);
  for (const bad of ["", "{}", "[[1,2,3,4]]", "[[0,2,3,4,5]]", '[[1,2,3,4,"5"]]', "[[1,2,3,4,5.5]]", "[[1,2,3,4,5,6]]", JSON.stringify(Array.from({ length: 401 }, (_, id) => [id + 1, 0, 0, 1, 1]))]) assert.equal(target_rows(bad), undefined, bad);
});

test("labels go in reading order: by row, then left to right", () => {
  assert.deepEqual(reading_order([row(1, 300, 40), row(2, 10, 80), row(3, 10, 42), row(4, 100, 0)]).map(([id]) => id), [4, 3, 1, 2]);
});

test("a key narrows, drops a letter that continues no label, takes one back on Backspace and picks on the last letter", () => {
  const labels: LabelRow[] = [[11, "a"], [12, "sa"], [13, "ss"]];
  const none: undefined[] = [];
  assert.deepEqual(key_step(labels, none, [], "s"), { view: { typed: "s", ids: [12, 13] }, tokens: ["s"] });
  assert.deepEqual(key_step(labels, none, [], "S"), { view: { typed: "s", ids: [12, 13] }, tokens: ["S"] });
  assert.deepEqual(key_step(labels, none, ["s"], "s"), { pick: 13 });
  assert.deepEqual(key_step(labels, none, [], "a"), { pick: 11 });
  assert.equal(key_step(labels, none, ["s"], "q"), undefined);
  assert.deepEqual(key_step(labels, none, ["s"], "<Backspace>"), { view: { typed: "", ids: [11, 12, 13] }, tokens: ["s", "<Backspace>"] });
  for (const token of ["<Backspace>", "<Enter>", "<Space>", "<Tab>", "<S-Tab>"]) assert.equal(key_step(labels, none, [], token), undefined, token);
  assert.equal(key_step(labels, none, [], "/"), undefined, "text mode opened with no text to type against");
});

test("a long run of Tab in text mode never fills the kept keys, so Enter, Backspace and typing still work after it", () => {
  // 70 targets whose texts all match the empty text, so Tab walks them in page order.
  const labels: LabelRow[] = Array.from({ length: 70 }, (_, index) => [index + 1, `l${index}`]);
  const texts = labels.map(([id]) => `item ${id}`);
  const press = (tokens: string[], ...keys: string[]) => {
    for (const key of keys) {
      const step = key_step(labels, texts, tokens, key);
      assert.ok(step && "view" in step, `${key} after ${tokens.length} kept keys changed nothing`);
      tokens = step.tokens;
    }
    return tokens;
  };
  const tabbed = press(["/"], ...Array<string>(100).fill("<Tab>"));
  assert.ok(tabbed.length <= 36, `the kept keys grew to ${tabbed.length}`);
  assert.deepEqual(key_step(labels, texts, tabbed, "<Enter>"), { pick: 31 }, "Enter did not pick the 101st match counted round the 70");
  const back = press(tabbed, ...Array<string>(5).fill("<S-Tab>"));
  assert.deepEqual(key_step(labels, texts, back, "<Enter>"), { pick: 26 });
  assert.ok(key_step(labels, texts, tabbed, "<Backspace>"), "Backspace was dropped");
  const typed = press(tabbed, "1");
  assert.deepEqual(typed, ["/", "1"], "Tabs that typing reset stayed kept");
});

test("a start sends one collect, and the labels go out once every part of the targets is in, in any order", async () => {
  const { hints, called, session, draws, shown } = make();
  assert.deepEqual(await hints.start(7), { ok: true });
  assert.equal(called[0]!.kind, "chrome_hints.collect");
  const number = session()!.session;
  assert.deepEqual(called[0]!.args, { session: number, window_id: 7, colors: "" });
  await hints.handlers["chrome_hints.targets"](targets(number, [row(5, 0, 0)], 1, 2));
  assert.equal(draws().length, 0, "labels went out with a part missing");
  await hints.handlers["chrome_hints.targets"](targets(number, [row(4, 50, 0)], 0, 2));
  assert.deepEqual(shown(1), [[5, "a"], [4, "s"]]);
  assert.equal(draws()[0]!.args.typed, "");
});

test("a part read twice, a part of another session and a part that disagrees on the count change nothing", async () => {
  const { hints, session, draws } = make();
  await hints.start(7);
  const number = session()!.session;
  await hints.handlers["chrome_hints.targets"](targets(number + 1, [row(1, 0, 0)]));
  await hints.handlers["chrome_hints.targets"](targets(number, [row(1, 0, 0)], 0, 3));
  await hints.handlers["chrome_hints.targets"](targets(number, [row(2, 0, 0)], 1, 2));
  await hints.handlers["chrome_hints.targets"](targets(number, [row(1, 0, 0)], 0, 3));
  assert.equal(draws().length, 0);
  await hints.handlers["chrome_hints.targets"](targets(number, [row(3, 0, 0)], 2, 3));
  await hints.handlers["chrome_hints.targets"](targets(number, [row(3, 0, 0)], 2, 3));
  assert.equal(draws().length, 0, "a part read twice counted as another part");
  await hints.handlers["chrome_hints.targets"](targets(number, [row(9, 0, 0)], 1, 3));
  assert.equal(draws().length, 1);
  await hints.handlers["chrome_hints.targets"](targets(number, [row(9, 0, 0)], 1, 3));
  assert.equal(draws().length, 1, "a part after the labels went out drew again");
});

test("keys narrow in order once, a key read twice or out of order is skipped, and the last letter picks and ends the session", async () => {
  const { hints, session, shown, called } = make();
  await hints.start(7);
  const number = session()!.session;
  // Ten targets with nine letters: the first label splits into two-letter labels.
  await hints.handlers["chrome_hints.targets"](targets(number, Array.from({ length: 10 }, (_, index) => row(index + 1, index * 30, 0))));
  const labels = session()!.labels!;
  const long = labels.find(([, label]) => label.length === 2)!;
  await hints.handlers["chrome_hints.key"]({ session: number, seq: 1, key: long[1][0]! });
  assert.deepEqual(session()!.tokens, [long[1][0]]);
  assert.ok(shown(2).every(([, label]) => label.startsWith(long[1][0]!)) && shown(2).length === 2);
  await hints.handlers["chrome_hints.key"]({ session: number, seq: 1, key: "Backspace" });
  await hints.handlers["chrome_hints.key"]({ session: number + 1, seq: 2, key: "Backspace" });
  assert.deepEqual(session()!.tokens, [long[1][0]], "a key read twice or of another session ran");
  await hints.handlers["chrome_hints.key"]({ session: number, seq: 2, key: long[1][1]! });
  await flush();
  assert.equal(session(), undefined, "the session outlived its pick");
  assert.deepEqual(called.at(-1), { kind: "chrome_hints.pick", args: { session: number, id: long[0] } });
  await hints.handlers["chrome_hints.key"]({ session: number, seq: 3, key: "a" });
  assert.equal(called.filter((call) => call.kind === "chrome_hints.pick").length, 1, "a key after the pick picked again");
});

test("a refused pick tells the user, a refused collect drops the session, and an end from the module drops it too", async () => {
  const refused = make({ collect: { ok: false, error: "Nothing to hint here" } });
  assert.deepEqual(await refused.hints.start(7), { ok: false, error: "Nothing to hint here" });
  assert.equal(refused.session(), undefined);
  // The collect's reply can be lost after the module started a session, which would then hold the keys.
  assert.deepEqual(refused.pushed, [{ kind: "chrome_hints.clear", args: { session: 100 } }], "a failed collect left the module's session alone");

  const { hints, session, notes } = make({ pick: { ok: false, error: "The hint's target moved" } });
  await hints.start(7);
  const number = session()!.session;
  await hints.handlers["chrome_hints.targets"](targets(number, [row(1, 0, 0)]));
  await hints.handlers["chrome_hints.key"]({ session: number, seq: 1, key: "a" });
  await flush();
  assert.deepEqual(notes, ["The hint's target moved"]);

  await hints.start(7);
  const next = session()!.session;
  await hints.handlers["chrome_hints.end"]({ session: number });
  assert.equal(session()?.session, next, "an older session's end dropped the newer one");
  await hints.handlers["chrome_hints.end"]({ session: next });
  assert.equal(session(), undefined);
});

test("a second start replaces the first, so the first session's targets and keys find nothing", async () => {
  const { hints, session, draws } = make();
  await hints.start(7);
  const first = session()!.session;
  await hints.start(8);
  const second = session()!.session;
  assert.notEqual(first, second);
  await hints.handlers["chrome_hints.targets"](targets(first, [row(1, 0, 0)]));
  assert.equal(draws().length, 0);
  await hints.handlers["chrome_hints.targets"](targets(second, [row(2, 0, 0)]));
  assert.equal(draws()[0]!.args.session, second);
});

test("a part count above the protocol's limit and a part index outside the count are dropped before anything is stored", async () => {
  const { hints, session, draws } = make();
  await hints.start(7);
  const number = session()!.session;
  for (const [part, parts] of [[0, 2 ** 40], [0, CHROME_HINT_MAX_PARTS + 1], [0, 0], [-1, 2], [2, 2], [5, 2]]) {
    await hints.handlers["chrome_hints.targets"](targets(number, [row(1, 0, 0)], part, parts));
  }
  assert.deepEqual(session(), { session: number, window_id: 7, targets: {}, tokens: [], seq: 0, gen: 0 });
  await hints.handlers["chrome_hints.targets"](targets(number, [row(1, 0, 0)], 0, 1));
  assert.equal(draws().length, 1, "a bad part blocked a good one");
});

test("a second start whose collect is refused clears the first session in chrome too, so its labels do not hold the keys", async () => {
  // The first collect starts a session, and the second is refused because the focus moved into a field.
  const collect: { ok: true } | { ok: false; error: string } = { ok: true };
  const { hints, session, pushed } = make({ collect });
  await hints.start(7);
  const first = session()!.session;
  Object.assign(collect, { ok: false, error: "Leave the field first" });
  await hints.start(7);
  const cleared = pushed.filter((sent) => sent.kind === "chrome_hints.clear").map((sent) => sent.args.session);
  assert.ok(cleared.includes(first), "the first session was left in chrome");
  assert.equal(session(), undefined);
});

test("a start the module asks for from chrome focus hands its token back in a collect_here that names no window, and a refusal tells the user", async () => {
  const { hints, called, session, notes } = make();
  assert.equal(MODULE_TO_EXTENSION_KINDS["chrome_hints.want"]!.reply, true, "a start read twice would run twice");
  await hints.handlers["chrome_hints.want"]({ start: 4242 });
  assert.deepEqual(called.map((sent) => sent.kind), ["chrome_hints.collect_here"]);
  assert.deepEqual(called[0]!.args, { session: session()!.session, start: 4242, colors: "" });
  assert.ok(validate_message({ v: 1, id: "c1", kind: "chrome_hints.collect_here", args: called[0]!.args }, EXTENSION_TO_MODULE_KINDS).ok);
  assert.equal("window_id" in session()!, false);

  const refused = make({ collect: { ok: false, error: "The window is not in front" } });
  refused.hints.handlers["chrome_hints.want"]({ start: 1 });
  await flush();
  await refused.hints.handlers["chrome_hints.want"]({ start: 2 });
  assert.equal(refused.session(), undefined);
  assert.deepEqual(refused.notes, ["The window is not in front", "The window is not in front"]);
  assert.deepEqual(notes, []);
});

test("a start the user cancelled or let expire before the extension answered ends silently, and another refusal still tells the user", async () => {
  const stale = make({ collect: { ok: false, error: "The hint key is stale" } });
  await stale.hints.handlers["chrome_hints.want"]({ start: 1 });
  assert.deepEqual(stale.notes, []);
  assert.equal(stale.session(), undefined);
  const nothing = make({ collect: { ok: false, error: "Nothing to hint here" } });
  await nothing.hints.handlers["chrome_hints.want"]({ start: 1 });
  assert.deepEqual(nothing.notes, ["Nothing to hint here"]);
});

test("a start whose colors read outlasts a newer start sends no collect, so the module keeps the newer session", async () => {
  let release_first: (colors: string) => void = () => undefined;
  let reads = 0;
  const colors = () => (reads++ === 0 ? new Promise<string>((resolve) => (release_first = resolve)) : Promise.resolve(""));
  const { hints, called, session, notes } = make({ colors });
  const first = hints.start(7);
  await flush();
  const first_session = session()!.session;
  await hints.start(8);
  const second_session = session()!.session;
  release_first("");
  assert.deepEqual(await first, { ok: true });
  const collected = called.filter((sent) => sent.kind === "chrome_hints.collect").map((sent) => sent.args.session);
  assert.deepEqual(collected, [second_session], `the older start ${first_session} collected after the newer one`);
  assert.equal(session()!.session, second_session);
  assert.deepEqual(notes, []);
});

test("a DevTools ask starts a session on the DevTools kinds: the collect hands the ask back, and draw, pick and clear go to the DevTools file", async () => {
  const { hints, called, pushed, session, notes } = make();
  await hints.handlers["devtools_hints.ask"]({ ask: 77 });
  const number = session()!.session;
  assert.deepEqual(called, [{ kind: "devtools_hints.collect", args: { session: number, ask: 77, colors: "" } }]);
  assert.ok(validate_message({ v: 1, id: "c1", kind: "devtools_hints.collect", args: called[0]!.args }, EXTENSION_TO_MODULE_KINDS).ok);
  assert.equal("window_id" in session()!, false);
  await hints.handlers["chrome_hints.targets"](targets(number, [row(1, 0, 0), row(2, 40, 0)]));
  assert.deepEqual(pushed.map((sent) => sent.kind), ["devtools_hints.draw"]);
  const first_label = (JSON.parse(pushed[0]!.args.labels as string) as LabelRow[])[0]![1];
  for (const [seq, key] of [...first_label].entries()) await hints.handlers["chrome_hints.key"]({ session: number, seq: seq + 1, key });
  await flush();
  assert.deepEqual(called.at(-1), { kind: "devtools_hints.pick", args: { session: number, id: 1 } });
  // A chrome start replaces the DevTools session, which the DevTools file clears.
  await hints.handlers["devtools_hints.ask"]({ ask: 78 });
  const second = session()!.session;
  await hints.start(7);
  assert.ok(pushed.some((sent) => sent.kind === "devtools_hints.clear" && sent.args.session === second), "the DevTools session was left showing");
  assert.equal(pushed.some((sent) => sent.kind.startsWith("chrome_hints.")), false);
  assert.deepEqual(notes, []);
  assert.equal(MODULE_TO_EXTENSION_KINDS["devtools_hints.ask"]!.reply, true, "an ask read twice would clear the session it started");
});

test("a refused DevTools collect clears the DevTools session, tells the user why, and a stale ask ends silently", async () => {
  const refused = make({ collect: { ok: false, error: "Nothing to hint here" } });
  await refused.hints.handlers["devtools_hints.ask"]({ ask: 5 });
  assert.deepEqual(refused.pushed, [{ kind: "devtools_hints.clear", args: { session: 100 } }]);
  assert.deepEqual(refused.notes, ["Nothing to hint here"]);
  assert.equal(refused.session(), undefined);
  const stale = make({ collect: { ok: false, error: "The hint key is stale" } });
  await stale.hints.handlers["devtools_hints.ask"]({ ask: 5 });
  assert.deepEqual(stale.notes, []);
  const junk = make();
  await junk.hints.handlers["devtools_hints.ask"]({ ask: "5" });
  assert.deepEqual(junk.called, []);
});

test("a hint key on one of Firefox's own pages hands the token back with the action of its binding, and a hint that cannot run there tells the user and fails the reply", async () => {
  const { hints, called, session, notes } = make();
  assert.equal(MODULE_TO_EXTENSION_KINDS["page_hints.want"]!.reply, true, "a start read twice would run twice");
  await hints.handlers["page_hints.want"]({ start: 77, keys: "; y l", count: 0 });
  assert.deepEqual(called.map((sent) => sent.kind), ["page_hints.collect"]);
  assert.deepEqual(called[0]!.args, { session: session()!.session, start: 77, action: "yank", colors: "" });
  assert.ok(validate_message({ v: 1, id: "c1", kind: "page_hints.collect", args: called[0]!.args }, EXTENSION_TO_MODULE_KINDS).ok);
  assert.deepEqual(notes, []);

  const other = make();
  // The throw is the error reply, which ends the module's start at once.
  await assert.rejects(other.hints.handlers["page_hints.want"]({ start: 78, keys: "; v", count: 0 }));
  assert.deepEqual(other.called, [], "a refused hint still asked the module to collect");
  assert.deepEqual(other.notes, ["This hint does not run on this page"]);
  assert.equal(other.session(), undefined);

  const stale = make({ collect: { ok: false, error: "The hint key is stale" } });
  await stale.hints.handlers["page_hints.want"]({ start: 79, keys: "f", count: 0 });
  assert.deepEqual(stale.notes, []);
});

test("a page start whose action loads after a newer start began sends nothing, so the newer session stays", async () => {
  let release = () => {};
  const slow = make({ page_action: (keys) => (keys === "f" ? new Promise((resolve) => (release = () => resolve({ ok: true, action: "follow" }))) : page_action_of(keys)) });
  const older = slow.hints.handlers["page_hints.want"]({ start: 80, keys: "f", count: 0 });
  await flush();
  await slow.hints.handlers["page_hints.want"]({ start: 81, keys: "; y l", count: 0 });
  const newer = slow.session()!.session;
  release();
  await assert.rejects(older);
  assert.deepEqual(slow.called.map((sent) => sent.args.start), [81], "the older start still asked the module to collect");
  assert.equal(slow.session()?.session, newer, "the older start replaced the newer session");
  assert.deepEqual(slow.pushed.filter((sent) => sent.kind === "chrome_hints.clear"), [], "the older start cleared the newer session");
});

// ---- Text mode: `/`, Tab, Shift-Tab, Enter and Backspace, run by the page's picker over the texts the module sent.

const texts = (session: number, rows: [number, string][], part = 0, parts = 1) => ({ session, part, parts, texts: JSON.stringify(rows) });

// A started session of four targets in a row with their texts in, keyed in order from `seq` 1 on.
async function text_session(options: Parameters<typeof make>[0] = {}) {
  const run = make(options);
  await run.hints.start(7);
  const number = run.session()!.session;
  await run.hints.handlers["chrome_hints.targets"](targets(number, [row(1, 0, 0), row(2, 40, 0), row(3, 80, 0), row(4, 120, 0)]));
  await run.hints.handlers["chrome_hints.texts"](texts(number, [[1, "Reload"], [2, "Settings"], [3, "Search settings"], [4, "Bookmarks"]]));
  let seq = 0;
  const key = (token: string, key = token) => run.hints.handlers["chrome_hints.key"]({ session: number, seq: ++seq, key, token });
  const last = () => run.draws().at(-1)!.args;
  const last_ids = () => (JSON.parse(last().labels as string) as LabelRow[]).map(([id]) => id);
  const picks = () => run.called.filter((call) => call.kind === "chrome_hints.pick").map((call) => call.args.id);
  return { ...run, number, key, last, last_ids, picks };
}

test("a key's token comes from the module, or from an older module's key, and only a key the picker takes has one", () => {
  assert.equal(token_of_key({ key: "Tab", token: "<S-Tab>" }), "<S-Tab>");
  for (const [key, token] of [["Tab", "<Tab>"], ["Enter", "<Enter>"], ["Backspace", "<Backspace>"], [" ", "<Space>"], ["/", "/"], ["A", "A"]] as const) assert.equal(token_of_key({ key }), token, key);
  for (const token of ["<C-c>", "<F1>", "<Escape>", "ab", "\u0007", "\u202e"]) assert.equal(token_of_key({ key: "x", token }), undefined, token);
  assert.equal(token_of_key({ key: "ArrowDown" }), undefined);
});

test("the module's texts are foreign input: a part with any row that is not an id and a short plain text is dropped whole", () => {
  assert.deepEqual(text_rows('[[1,"Reload"]]'), [[1, "Reload"]]);
  for (const bad of ["", "{}", '[[0,"a"]]', '[[1,""]]', "[[1,2]]", '[[1,"a","b"]]', JSON.stringify([[1, "x".repeat(CHROME_HINT_TEXT_CHARS + 1)]]), JSON.stringify([[1, "a\u0000b"]]), JSON.stringify([[1, "a\u202eb"]])]) assert.equal(text_rows(bad), undefined, bad);
});

test("/ shows every target with a text, typed text narrows and ranks them, and Tab and Shift-Tab move the active one, which Enter picks", async () => {
  const run = await text_session();
  await run.key("/");
  assert.deepEqual(run.last_ids(), [1, 2, 3, 4]);
  assert.equal(run.last().query, "");
  assert.equal(run.last().active, 1);
  assert.equal(run.last().typed, "");
  for (const char of "se") await run.key(char);
  assert.equal(run.last().query, "se");
  assert.deepEqual(run.last_ids(), [2, 3], "the ranking does not put the whole first word first");
  assert.equal(run.last().active, 2);
  await run.key("<Tab>", "Tab");
  assert.equal(run.last().active, 3);
  await run.key("<S-Tab>", "Tab");
  await run.key("<S-Tab>", "Tab");
  assert.equal(run.last().active, 3, "Shift-Tab did not go back round");
  const drawn = run.draws().length;
  await run.key("q");
  assert.equal(run.draws().length, drawn, "a key that matches nothing drew again");
  await run.key("<Enter>", "Enter");
  await flush();
  assert.deepEqual(run.picks(), [3]);
  assert.equal(run.session(), undefined);
});

test("text that leaves one match picks it at once, and Backspace on empty text goes back to the labels", async () => {
  const run = await text_session();
  await run.key("/");
  await run.key("<Backspace>", "Backspace");
  assert.equal(run.last().query, undefined);
  assert.deepEqual(run.last_ids(), [1, 2, 3, 4]);
  await run.key("<Tab>", "Tab");
  await run.key("<Space>", " ");
  assert.equal(run.last().query, undefined, "Tab or Space in label mode drew");
  await run.key("/");
  for (const char of "boo") await run.key(char);
  await flush();
  assert.deepEqual(run.picks(), [4]);
});

test("a background that restarts in text mode replays the kept keys and goes on where it was", async () => {
  const run = await text_session();
  await run.key("/");
  await run.key("s");
  await run.key("<Tab>", "Tab");
  const restarted = create_chrome_hints(run.deps);
  await restarted.handlers["chrome_hints.key"]({ session: run.number, seq: 10, key: "Enter", token: "<Enter>" });
  await flush();
  assert.deepEqual(run.picks(), [3]);
});

test("texts come in parts in any order, a bad part or one past the cap is dropped, and with no texts / stays a dropped key", async () => {
  const run = make();
  await run.hints.start(7);
  const number = run.session()!.session;
  await run.hints.handlers["chrome_hints.targets"](targets(number, [row(1, 0, 0), row(2, 40, 0)]));
  await run.hints.handlers["chrome_hints.texts"](texts(number, [[2, "Two"]], 1, 2));
  await run.hints.handlers["chrome_hints.texts"](texts(number, [[1, "bad\u0000"]], 0, 2));
  await run.hints.handlers["chrome_hints.texts"](texts(number, [[1, "One"]], 0, MAX_CHROME_HINT_TEXT_PARTS + 1));
  await run.hints.handlers["chrome_hints.key"]({ session: number, seq: 1, key: "/", token: "/" });
  assert.equal(run.draws().length, 1, "text mode opened before every part of the texts came");
  await run.hints.handlers["chrome_hints.texts"](texts(number, [[1, "One"]], 0, 2));
  await run.hints.handlers["chrome_hints.key"]({ session: number, seq: 2, key: "/", token: "/" });
  assert.equal(run.draws().at(-1)!.args.query, "");
  await run.hints.handlers["chrome_hints.key"]({ session: number, seq: 3, key: "t" });
  await flush();
  assert.deepEqual(run.called.at(-1), { kind: "chrome_hints.pick", args: { session: number, id: 2 } }, "an older module's key did not type text");
});

test("the draws carry the key line while the setting is on, and a DevTools draw carries no text mode field", async () => {
  const on = await text_session({ key_line: true });
  assert.ok(on.draws().every((draw) => draw.args.key_line === 1));
  const off = await text_session();
  assert.ok(off.draws().every((draw) => draw.args.key_line === undefined));
  const devtools = make({ key_line: true });
  await devtools.hints.handlers["devtools_hints.ask"]({ ask: 5 });
  const number = devtools.session()!.session;
  await devtools.hints.handlers["chrome_hints.targets"](targets(number, [row(1, 0, 0), row(2, 40, 0)]));
  const [draw] = devtools.pushed.filter((sent) => sent.kind === "devtools_hints.draw");
  assert.deepEqual(Object.keys(draw!.args).sort(), ["gen", "labels", "part", "parts", "session", "typed"]);
});

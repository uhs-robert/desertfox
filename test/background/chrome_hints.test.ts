import assert from "node:assert/strict";
import { test } from "node:test";
import { create_chrome_hints, key_step, label_parts, reading_order, target_rows } from "../../src/background/chrome_hints.ts";
import type { ChromeHintDeps, LabelRow, TargetRow } from "../../src/background/chrome_hints.ts";
import { CHROME_HINT_PART_BYTES, EXTENSION_TO_MODULE_KINDS, MODULE_TO_EXTENSION_KINDS, json_bytes, validate_message } from "../../src/shared/browser_module_protocol.ts";
import { CHROME_HINTS_STORAGE_KEY } from "../../src/shared/config/storage_keys.ts";
import { DEFAULT_HINT_LETTERS, make_labels } from "../../src/shared/hints/labels.ts";

type Sent = { kind: string; args: Record<string, number | string> };

function make({ collect = { ok: true } as { ok: true } | { ok: false; error: string }, pick = { ok: true } as { ok: true } | { ok: false; error: string } } = {}) {
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
      return kind === "chrome_hints.collect" ? collect : pick;
    },
    letters: async () => [...DEFAULT_HINT_LETTERS],
    colors: async () => "",
    notify: async (_window_id, message) => void notes.push(message),
    new_session: () => next++,
  };
  const hints = create_chrome_hints(deps);
  const session = () => bucket.get(CHROME_HINTS_STORAGE_KEY) as { session: number; labels?: LabelRow[]; typed: string } | undefined;
  const draws = () => pushed.filter((sent) => sent.kind === "chrome_hints.draw");
  const shown = (gen: number) => draws().filter((draw) => draw.args.gen === gen).flatMap((draw) => JSON.parse(draw.args.labels as string) as LabelRow[]);
  return { hints, bucket, pushed, called, notes, session, draws, shown };
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
  assert.deepEqual(key_step(labels, "", "s"), { typed: "s" });
  assert.deepEqual(key_step(labels, "", "S"), { typed: "s" });
  assert.deepEqual(key_step(labels, "s", "s"), { pick: 13 });
  assert.deepEqual(key_step(labels, "", "a"), { pick: 11 });
  assert.equal(key_step(labels, "s", "q"), undefined);
  assert.deepEqual(key_step(labels, "s", "Backspace"), { typed: "" });
  assert.equal(key_step(labels, "", "Backspace"), undefined);
  assert.equal(key_step(labels, "", "Enter"), undefined);
  assert.equal(key_step(labels, "", " "), undefined);
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
  assert.equal(session()!.typed, long[1][0]);
  assert.ok(shown(2).every(([, label]) => label.startsWith(long[1][0]!)) && shown(2).length === 2);
  await hints.handlers["chrome_hints.key"]({ session: number, seq: 1, key: "Backspace" });
  await hints.handlers["chrome_hints.key"]({ session: number + 1, seq: 2, key: "Backspace" });
  assert.equal(session()!.typed, long[1][0], "a key read twice or of another session ran");
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

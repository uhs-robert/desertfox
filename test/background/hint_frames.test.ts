import assert from "node:assert/strict";
import { test } from "node:test";
import { assign_labels, create_hint_frames, HINT_FRAMES_WAIT_MS, type HintFrames, type HintFramesDeps, type HintFramesMessage } from "../../src/background/hint_frames.ts";
import { make_labels } from "../../src/content/hints/labels.ts";
import { HINT_FRAMES_STORAGE_PREFIX } from "../../src/background/storage_keys.ts";

const TAB = 7;
const KEY = HINT_FRAMES_STORAGE_PREFIX + TAB;
const LETTERS = "asdfghjkl";

// A fake frame. `count` is what it reports to a collect, `silent` never reports, `gone` rejects every message (removed or navigated with no script), and `pick` answers a pick.
type FakeFrame = { count: number; silent?: boolean; gone?: boolean; pick?: (label: string) => unknown };
type Sent = { frame_id: number | undefined; message: HintFramesMessage };

const flush = () => new Promise((resume) => setImmediate(resume));

// One storage object stands for `storage.session`, so a second `create_hint_frames` on it is a restarted background.
function harness(frames: Record<number, FakeFrame>, options: { inject?: () => Promise<number> } = {}) {
  const data: Record<string, unknown> = {};
  const timers = new Map<number, () => void>();
  let next_timer = 1;
  let next_session = 0;
  const clock = { now: 1_000 };
  const sent: Sent[] = [];
  let current: HintFrames;
  const deps: HintFramesDeps = {
    storage: {
      get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
      set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
      remove: async (key: string) => void delete data[key],
    } as never,
    inject_all: options.inject ?? (async () => Object.keys(frames).length),
    send: async (tab_id, message, frame_id) => {
      assert.equal(tab_id, TAB);
      sent.push({ frame_id, message });
      if (frame_id !== undefined && frames[frame_id]?.gone) throw new Error("Could not establish connection. Receiving end does not exist.");
      if (message.type === "hint_frames_collect") {
        for (const [id, frame] of Object.entries(frames)) if (!frame.silent && !frame.gone) void current.report(TAB, Number(id), message.session_id, frame.count);
      }
      if (message.type === "hint_frames_pick") return frames[frame_id!]?.pick?.(message.label);
      return undefined;
    },
    new_session_id: () => `s${++next_session}`,
    set_timer: (callback) => (timers.set(next_timer, callback), next_timer++),
    clear_timer: (handle) => void timers.delete(handle as number),
    now: () => clock.now,
    wait_ms: HINT_FRAMES_WAIT_MS,
  };
  current = create_hint_frames(deps);
  return {
    data,
    sent,
    clock,
    timers,
    get hints() {
      return current;
    },
    restart: () => (current = create_hint_frames(deps)),
    fire_timers: () => [...timers.values()].forEach((fire) => fire()),
    of_type: (type: HintFramesMessage["type"]) => sent.filter((entry) => entry.message.type === type),
  };
}

const START = { letters: LETTERS, args: { action: "here", filter: "clickable" } };

test("one prefix-free label set covers every frame, the top frame first, and the wait ends once all reported", async () => {
  const fake = harness({ 0: { count: 5 }, 3: { count: 4 }, 9: { count: 2 } });
  const answer = await fake.hints.start(TAB, 0, START);
  const all = make_labels(11, [...LETTERS]);
  assert.deepEqual(answer, { ok: true, session_id: "s1", labels: all, own_labels: all.slice(0, 5) });
  assert.deepEqual(fake.of_type("hint_frames_collect"), [{ frame_id: undefined, message: { type: "hint_frames_collect", session_id: "s1", args: START.args } }]);
  assert.deepEqual(fake.of_type("hint_frames_labels"), [
    { frame_id: 3, message: { type: "hint_frames_labels", session_id: "s1", labels: all.slice(5, 9) } },
    { frame_id: 9, message: { type: "hint_frames_labels", session_id: "s1", labels: all.slice(9) } },
  ]);
  assert.equal(fake.timers.size, 0);
});

test("assign_labels keeps the set prefix-free and skips frames with nothing to label", () => {
  const shares = assign_labels({ 12: 30, 0: 40, 4: 0 }, [...LETTERS]);
  assert.deepEqual(Object.keys(shares), ["0", "12"]);
  assert.equal(shares["0"]!.length, 40);
  const labels = Object.values(shares).flat();
  for (const label of labels) assert.equal(labels.filter((other) => other.startsWith(label)).length, 1, label);
});

test("a frame that never answers holds the labels only until the wait runs out, and gets none", async () => {
  const fake = harness({ 0: { count: 2 }, 4: { count: 3, silent: true }, 6: { count: 1 } });
  const pending = fake.hints.start(TAB, 0, START);
  await flush();
  assert.equal(fake.timers.size, 1);
  fake.fire_timers();
  const answer = await pending;
  assert.equal(answer.ok && answer.labels.length, 3);
  assert.deepEqual(fake.of_type("hint_frames_labels").map((entry) => entry.frame_id), [6]);
});

test("a frame that reports after the wait gets no labels and changes none, and the end still reaches it", async () => {
  const fake = harness({ 0: { count: 2 }, 5: { count: 3, silent: true } });
  const pending = fake.hints.start(TAB, 0, START);
  await flush();
  fake.fire_timers();
  const answer = await pending;
  assert.ok(answer.ok);
  const labeled = structuredClone(fake.data[KEY]);
  fake.clock.now += HINT_FRAMES_WAIT_MS + 50;
  await fake.hints.report(TAB, 5, "s1", 3);
  assert.deepEqual(fake.data[KEY], labeled);
  assert.deepEqual(fake.of_type("hint_frames_labels"), []);
  await fake.hints.end(TAB, 0, "s1");
  assert.deepEqual(fake.of_type("hint_frames_end"), [{ frame_id: undefined, message: { type: "hint_frames_end", session_id: "s1" } }]);
  assert.equal(fake.data[KEY], undefined);
});

test("a frame that refuses scripts leaves the count unknown, so the wait runs out and the others still get labels", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 1 } }, { inject: () => Promise.reject(new Error("Missing host permission for the tab or frames")) });
  const pending = fake.hints.start(TAB, 0, START);
  await flush();
  assert.equal(fake.timers.size, 1);
  fake.fire_timers();
  const answer = await pending;
  assert.deepEqual(answer.ok && answer.labels, ["a", "s"]);
});

test("a frame that navigated away loses its pick, and the typed prefix still reaches the others", async () => {
  const frames: Record<number, { count: number; gone?: boolean; pick?: (label: string) => unknown }> = { 0: { count: 1 }, 2: { count: 1, pick: () => ({ ok: true }) }, 4: { count: 1 } };
  const fake = harness(frames);
  const answer = await fake.hints.start(TAB, 0, START);
  assert.deepEqual(answer.ok && answer.labels, ["a", "s", "d"]);
  frames[4]!.gone = true;
  await fake.hints.typed(TAB, 0, "s1", "d");
  assert.deepEqual(fake.of_type("hint_frames_typed").map((entry) => entry.frame_id), [2, 4]);
  assert.deepEqual(await fake.hints.pick(TAB, 0, "s1", "d"), { ok: false, message: "The frame of that hint is gone" });
  assert.deepEqual(await fake.hints.pick(TAB, 0, "s1", "s"), { ok: true });
  assert.deepEqual(fake.of_type("hint_frames_pick").at(-1), { frame_id: 2, message: { type: "hint_frames_pick", session_id: "s1", label: "s" } });
});

test("a frame id reused by a new page answers no outcome to a pick, which reads as a gone frame", async () => {
  // The new page has the frame's id but not the session, so its bundle answers nothing to the old session id.
  const fake = harness({ 0: { count: 1 }, 3: { count: 1, pick: () => undefined } });
  await fake.hints.start(TAB, 0, START);
  assert.deepEqual(await fake.hints.pick(TAB, 0, "s1", "s"), { ok: false, message: "The frame of that hint is gone" });
  assert.deepEqual(fake.of_type("hint_frames_pick")[0]!.message, { type: "hint_frames_pick", session_id: "s1", label: "s" });
});

test("a second run in the tab ends the first one at once, and the first one's late reports and keys do nothing", async () => {
  const frames: Record<number, { count: number; silent?: boolean }> = { 0: { count: 2, silent: true }, 1: { count: 2, silent: true } };
  const fake = harness(frames);
  const first = fake.hints.start(TAB, 0, START);
  await flush();
  frames[0]!.silent = false;
  frames[1]!.silent = false;
  const second = fake.hints.start(TAB, 0, { ...START, letters: "jk" });
  assert.deepEqual(await first, { ok: false, reason: "ended" });
  const answer = await second;
  assert.deepEqual(answer, { ok: true, session_id: "s2", labels: ["jj", "jk", "kj", "kk"], own_labels: ["jj", "jk"] });
  assert.deepEqual(fake.of_type("hint_frames_end"), [{ frame_id: undefined, message: { type: "hint_frames_end", session_id: "s1" } }]);
  await fake.hints.report(TAB, 1, "s1", 9);
  await fake.hints.typed(TAB, 0, "s1", "a");
  assert.deepEqual(await fake.hints.pick(TAB, 0, "s1", "a"), { ok: false, message: "The hints of the other frames have ended" });
  await fake.hints.end(TAB, 0, "s1");
  assert.equal((fake.data[KEY] as { session_id: string }).session_id, "s2");
  assert.deepEqual(fake.of_type("hint_frames_typed"), []);
  assert.equal(fake.of_type("hint_frames_end").length, 1);
});

test("two runs started in the same turn leave exactly one session, the newer one", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 1 } });
  const [first, second] = await Promise.all([fake.hints.start(TAB, 0, START), fake.hints.start(TAB, 0, START)]);
  assert.deepEqual(first, { ok: false, reason: "ended" });
  assert.equal(second.ok && second.session_id, "s2");
  assert.equal((fake.data[KEY] as { session_id: string }).session_id, "s2");
  assert.deepEqual(fake.of_type("hint_frames_labels").map((entry) => entry.message.session_id), ["s2"]);
});

test("a message after the session ended finds nothing: no relay, no pick, no stored report", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 1, pick: () => ({ ok: true }) } });
  await fake.hints.start(TAB, 0, START);
  await fake.hints.end(TAB, 0, "s1");
  await fake.hints.report(TAB, 2, "s1", 1);
  await fake.hints.typed(TAB, 0, "s1", "s");
  assert.deepEqual(await fake.hints.pick(TAB, 0, "s1", "s"), { ok: false, message: "The hints of the other frames have ended" });
  assert.equal(fake.data[KEY], undefined);
  assert.deepEqual(fake.of_type("hint_frames_typed"), []);
  assert.deepEqual(fake.of_type("hint_frames_pick"), []);
});

test("only the frame that started the session types, picks and ends it", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 1, pick: () => ({ ok: true }) } });
  await fake.hints.start(TAB, 0, START);
  await fake.hints.typed(TAB, 2, "s1", "s");
  assert.equal((await fake.hints.pick(TAB, 2, "s1", "s")).ok, false);
  await fake.hints.end(TAB, 2, "s1");
  assert.deepEqual(fake.of_type("hint_frames_typed"), []);
  assert.notEqual(fake.data[KEY], undefined);
});

test("a restarted background routes keys and picks from storage.session", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 1, pick: (label) => ({ ok: true, label }) } });
  await fake.hints.start(TAB, 0, START);
  fake.restart();
  await fake.hints.typed(TAB, 0, "s1", "s");
  assert.deepEqual(fake.of_type("hint_frames_typed"), [{ frame_id: 2, message: { type: "hint_frames_typed", session_id: "s1", typed: "s" } }]);
  assert.deepEqual(await fake.hints.pick(TAB, 0, "s1", "s"), { ok: true, label: "s" });
  await fake.hints.end(TAB, 0, "s1");
  assert.equal(fake.data[KEY], undefined);
});

test("a restart during the wait drops the session's late reports, and the next run replaces it", async () => {
  const fake = harness({ 0: { count: 1, silent: true }, 2: { count: 1, silent: true } });
  void fake.hints.start(TAB, 0, START);
  await flush();
  // The old wait and its start request die with the background, and its timer never fires.
  fake.timers.clear();
  fake.restart();
  fake.clock.now += HINT_FRAMES_WAIT_MS + 1;
  await fake.hints.report(TAB, 2, "s1", 1);
  assert.deepEqual((fake.data[KEY] as { reports: object }).reports, {});
  const answer = fake.hints.start(TAB, 0, START);
  await flush();
  fake.fire_timers();
  assert.deepEqual(await answer, { ok: true, session_id: "s2", labels: [], own_labels: [] });
  assert.equal(fake.of_type("hint_frames_end").at(-1)!.message.session_id, "s1");
});

test("a closed tab ends the wait at once and leaves nothing stored", async () => {
  const fake = harness({ 0: { count: 1, silent: true } });
  const pending = fake.hints.start(TAB, 0, START);
  await flush();
  await fake.hints.forget(TAB);
  assert.deepEqual(await pending, { ok: false, reason: "ended" });
  assert.equal(fake.data[KEY], undefined);
  assert.equal(fake.timers.size, 0);
});

test("a page load ends the session, and an address change the page makes keeps it", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 1 } });
  await fake.hints.start(TAB, 0, START);
  await fake.hints.navigated(TAB, { url: "https://example.org/#next" });
  await fake.hints.navigated(TAB, { status: "loading", url: "https://example.org/?q=1" });
  assert.notEqual(fake.data[KEY], undefined);
  await fake.hints.navigated(TAB, { status: "loading" });
  assert.equal(fake.data[KEY], undefined);
});

test("a report with a count that is not a whole number is dropped", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 1, silent: true } });
  const pending = fake.hints.start(TAB, 0, START);
  await flush();
  await fake.hints.report(TAB, 2, "s1", -1);
  await fake.hints.report(TAB, 2, "s1", "3");
  fake.fire_timers();
  const answer = await pending;
  assert.deepEqual(answer.ok && answer.labels, ["a"]);
});

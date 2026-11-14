import assert from "node:assert/strict";
import { test } from "node:test";
import { assign_labels, create_hint_frames, HINT_FRAMES_PICK_MS, HINT_FRAMES_WAIT_MS, type HintFrames, type HintFramesDeps, type HintFramesMessage } from "../../src/background/hint_frames.ts";
import { make_labels } from "../../src/content/hints/labels.ts";
import { HINT_FRAMES_STORAGE_PREFIX } from "../../src/background/storage_keys.ts";

const TAB = 7;
const KEY = HINT_FRAMES_STORAGE_PREFIX + TAB;
const LETTERS = "asdfghjkl";

// A fake frame. `count` is what it reports to a collect, `silent` never reports, `gone` rejects every message (removed or navigated with no script), and `pick` answers a pick.
type FakeFrame = { late?: boolean; count: number; texts?: string[]; silent?: boolean; gone?: boolean; pick?: (label: string, keys?: string[]) => unknown };
type StartRequest = { letters: string; args: Record<string, unknown>; count?: number; texts?: string[] };
type Sent = { frame_id: number | undefined; message: HintFramesMessage & { session_id?: string } };

const flush = () => new Promise((resume) => setImmediate(resume));

// One storage object stands for `storage.session`, so a second `create_hint_frames` on it is a restarted background.
// `parked` is the frame the tab's record names as parked. `unparked` lists the frames the code ended the record of.
function harness(frames: Record<number, FakeFrame>, options: { inject?: (frame_id?: number) => Promise<number>; parked?: number } = {}) {
  const data: Record<string, unknown> = {};
  const timers = new Map<number, () => void>();
  let next_timer = 1;
  let next_session = 0;
  // The keyboard frame sends its count with the start and ignores the collect.
  let keyboard_frame: number | undefined;
  // Every send from then on stays unanswered, as one to a navigating frame can.
  let sends_hang = false;
  const sent: Sent[] = [];
  const unparked: number[] = [];
  const entries: number[] = [];
  const injected: (number | undefined)[] = [];
  let parked = options.parked;
  let current: HintFrames;
  const deps: HintFramesDeps = {
    storage: {
      get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
      set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
      remove: async (key: string) => void delete data[key],
    } as never,
    inject_all: async (_tab_id, frame_id) => {
      injected.push(frame_id);
      if (options.inject) return options.inject(frame_id);
      if (frame_id !== undefined && (frames[frame_id] === undefined || frames[frame_id]!.gone)) throw new Error("No matching message handler");
      return frame_id === undefined ? Object.keys(frames).length : 1;
    },
    parked_frame: async () => parked,
    expect_entry: async (_tab_id, frame_id) => void entries.push(frame_id),
    unpark: async (_tab_id, frame_id) => void (parked === frame_id && ((parked = undefined), unparked.push(frame_id))),
    send: async (tab_id, message, frame_id) => {
      assert.equal(tab_id, TAB);
      sent.push({ frame_id, message });
      if (sends_hang) return new Promise(() => {});
      if (frame_id !== undefined && frames[frame_id]?.gone) throw new Error("Could not establish connection. Receiving end does not exist.");
      if (message.type === "hint_frames_collect") {
        for (const [id, frame] of Object.entries(frames)) if ((frame_id === undefined || Number(id) === frame_id) && !frame.silent && !frame.gone && Number(id) !== keyboard_frame) void (frame.late ? flush() : Promise.resolve()).then(() => current.report(TAB, Number(id), message.session_id, frame.count, frame.texts ?? Array.from({ length: frame.count }, (_, index) => `${id}:${index}`)));
      }
      if (message.type === "hint_frames_pick") return frames[frame_id!]?.pick?.(message.label, message.keys);
      return undefined;
    },
    new_session_id: () => `s${++next_session}`,
    set_timer: (callback) => (timers.set(next_timer, callback), next_timer++),
    clear_timer: (handle) => void timers.delete(handle as number),
    wait_ms: HINT_FRAMES_WAIT_MS,
    pick_ms: HINT_FRAMES_PICK_MS,
  };
  current = create_hint_frames(deps);
  return {
    data,
    sent,
    timers,
    unparked,
    injected,
    entries,
    get hints() {
      return {
        ...current,
        start: (tab_id: number, frame_id: number, request: StartRequest) => {
          keyboard_frame = frame_id;
          const count = request.count ?? frames[frame_id]?.count ?? 0;
          return current.start(tab_id, frame_id, { ...request, count, texts: request.texts ?? frames[frame_id]?.texts ?? Array.from({ length: count }, (_, index) => `${frame_id}:${index}`) });
        },
      };
    },
    restart: () => (current = create_hint_frames(deps)),
    hang_sends: () => void (sends_hang = true),
    fire_timers: () => [...timers.values()].forEach((fire) => fire()),
    of_type: (type: HintFramesMessage["type"]) => sent.filter((entry) => entry.message.type === type),
  };
}

const texts_of = (frame_id: number, count: number) => Array.from({ length: count }, (_, index) => `${frame_id}:${index}`);

// The harness adds the keyboard frame's own count.
const START: StartRequest = { letters: LETTERS, args: { action: "here", filter: "clickable", frames: "all_frames" } };

test("one prefix-free label set covers every frame, the top frame first, and the wait ends once all reported", async () => {
  const fake = harness({ 0: { count: 5 }, 3: { count: 4 }, 9: { count: 2 } });
  const answer = await fake.hints.start(TAB, 0, START);
  const all = make_labels(11, [...LETTERS]);
  assert.deepEqual(answer, { ok: true, session_id: "s1", labels: all, own_labels: all.slice(0, 5), texts: [...texts_of(0, 5), ...texts_of(3, 4), ...texts_of(9, 2)] });
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

test("a pick the owner frame never answers ends at its deadline as a gone frame", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 1, pick: () => ({ ok: true }) } });
  const started = fake.hints.start(TAB, 0, START);
  fake.fire_timers();
  await started;
  fake.hang_sends();
  const picked = fake.hints.pick(TAB, 0, "s1", "s");
  await flush();
  assert.equal(fake.timers.size, 1);
  fake.fire_timers();
  assert.deepEqual(await picked, { ok: false, message: "The frame of that hint is gone" });
});

test("a pick that is answered clears its deadline", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 1, pick: () => ({ ok: true }) } });
  const started = fake.hints.start(TAB, 0, START);
  fake.fire_timers();
  await started;
  assert.deepEqual(await fake.hints.pick(TAB, 0, "s1", "s"), { ok: true });
  assert.equal(fake.timers.size, 0);
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
  assert.deepEqual(answer, { ok: true, session_id: "s2", labels: ["jj", "jk", "kj", "kk"], own_labels: ["jj", "jk"], texts: ["0:0", "0:1", "1:0", "1:1"] });
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
  await fake.hints.report(TAB, 2, "s1", 1);
  assert.deepEqual((fake.data[KEY] as { reports: object }).reports, { 0: 1 });
  const answer = fake.hints.start(TAB, 0, START);
  await flush();
  fake.fire_timers();
  assert.deepEqual(await answer, { ok: true, session_id: "s2", labels: ["a"], own_labels: ["a"], texts: ["0:0"] });
  assert.equal(fake.of_type("hint_frames_end").at(-1)!.message.session_id, "s1");
});

test("a closed tab ends the wait at once and leaves nothing stored", async () => {
  const fake = harness({ 0: { count: 1 }, 3: { count: 1, silent: true } });
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

test("an injection that never answers still ends the wait at the deadline", async () => {
  // Firefox can leave an injection into a navigating frame unanswered.
  const fake = harness({ 0: { count: 2 } }, { inject: () => new Promise<number>(() => {}) });
  const pending = fake.hints.start(TAB, 0, START);
  await flush();
  fake.fire_timers();
  const settled = await Promise.race([pending, new Promise((resume) => setTimeout(() => resume("pending"), 50))]);
  assert.notEqual(settled, "pending");
  assert.equal(fake.timers.size, 0);
});

test("a run whose injection answers after a newer run's sends no collect for its dead session", async () => {
  const injections: Array<(count: number) => void> = [];
  const fake = harness({ 0: { count: 1 }, 2: { count: 1 } }, { inject: () => new Promise<number>((resolve) => injections.push(resolve)) });
  const first = fake.hints.start(TAB, 0, START);
  await flush();
  const second = fake.hints.start(TAB, 0, START);
  await flush();
  injections[1]!(2);
  await second;
  injections[0]!(2);
  await first;
  await flush();
  assert.deepEqual(fake.of_type("hint_frames_collect").map((entry) => entry.message.session_id), ["s2"]);
});

test("the keyboard frame's own count is in before the wait, so a slow top page keeps its labels", async () => {
  // Its collect report would come too late. The count in the start does not race the deadline.
  const fake = harness({ 0: { count: 2, silent: true }, 4: { count: 1 }, 5: { count: 1, silent: true } });
  const pending = fake.hints.start(TAB, 0, START);
  await flush();
  fake.fire_timers();
  assert.deepEqual(await pending, { ok: true, session_id: "s1", labels: ["a", "s", "d"], own_labels: ["a", "s"], texts: ["0:0", "0:1", "4:0"] });
});

test("an injection that answers after the deadline sends no collect, because the labels are out", async () => {
  let injected!: (count: number) => void;
  const fake = harness({ 0: { count: 1 }, 2: { count: 1 } }, { inject: () => new Promise<number>((resolve) => (injected = resolve)) });
  const pending = fake.hints.start(TAB, 0, START);
  await flush();
  fake.fire_timers();
  assert.deepEqual(await pending, { ok: true, session_id: "s1", labels: ["a"], own_labels: ["a"], texts: ["0:0"] });
  injected(2);
  await flush();
  assert.deepEqual(fake.of_type("hint_frames_collect"), []);
});

test("sends that never settle hold neither the start answer nor a typed relay", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 1 } });
  const answer = await fake.hints.start(TAB, 0, START);
  assert.equal(answer.ok, true);
  fake.hang_sends();
  const second = fake.hints.start(TAB, 0, START);
  await flush();
  fake.fire_timers();
  const settled = await Promise.race([second, new Promise((resume) => setTimeout(() => resume("pending"), 50))]);
  assert.deepEqual(settled, { ok: true, session_id: "s2", labels: ["a"], own_labels: ["a"], texts: ["0:0"] });
  const typed = await Promise.race([fake.hints.typed(TAB, 0, "s2", "a").then(() => "done"), new Promise((resume) => setTimeout(() => resume("pending"), 50))]);
  assert.equal(typed, "done");
  await fake.hints.end(TAB, 0, "s2");
});

test("the start answer carries every frame's texts in label order, and a frame with too few texts gets blanks", async () => {
  const fake = harness({ 0: { count: 2 }, 3: { count: 3, texts: ["x", "y"] }, 9: { count: 1, texts: ["z"] } });
  const answer = await fake.hints.start(TAB, 0, START);
  assert.deepEqual(answer.ok && answer.texts, ["0:0", "0:1", "x", "y", "", "z"]);
});

test("a frame with no candidates adds no text, and the others stay aligned with their labels", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 0 }, 4: { count: 2 } });
  const answer = await fake.hints.start(TAB, 0, START);
  assert.deepEqual(answer.ok && [answer.labels.length, answer.texts], [3, ["0:0", "4:0", "4:1"]]);
});

test("the texts live in the wait only: none in storage, and a report after the wait adds none", async () => {
  const fake = harness({ 0: { count: 1 }, 5: { count: 1, silent: true } });
  const answer_promise = fake.hints.start(TAB, 0, START);
  await flush();
  fake.fire_timers();
  const answer = await answer_promise;
  await fake.hints.report(TAB, 5, "s1", 1, ["late"]);
  assert.deepEqual(answer.ok && answer.texts, ["0:0"]);
  assert.equal(JSON.stringify(fake.data).includes("0:0"), false);
  assert.equal(JSON.stringify(fake.data).includes("late"), false);
});

test("the typed relay passes the text mode matches and the active label to the other frames, and a plain prefix carries none", async () => {
  const fake = harness({ 0: { count: 2 }, 3: { count: 2 } });
  await fake.hints.start(TAB, 0, START);
  await fake.hints.typed(TAB, 0, "s1", "/", { matches: ["d"], active: "d" });
  await fake.hints.typed(TAB, 0, "s1", "a");
  assert.deepEqual(fake.of_type("hint_frames_typed").map((entry) => [entry.frame_id, entry.message]), [
    [3, { type: "hint_frames_typed", session_id: "s1", typed: "/", matches: ["d"], active: "d" }],
    [3, { type: "hint_frames_typed", session_id: "s1", typed: "a" }],
  ]);
});

test("the owner's text answer to a pick reaches the keyboard frame unchanged", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 1, pick: () => ({ ok: true, text: "https://other.test/x", what: "selector" }) } });
  await fake.hints.start(TAB, 0, START);
  assert.deepEqual(await fake.hints.pick(TAB, 0, "s1", "s"), { ok: true, text: "https://other.test/x", what: "selector" });
});

test("a pick carries the keys typed ahead to the owner, and the owner's leftovers come back unchanged", async () => {
  const seen: unknown[] = [];
  const fake = harness({ 0: { count: 1 }, 2: { count: 1, pick: (_label, keys) => (seen.push(keys), { ok: true, left: ["x"] }) } });
  await fake.hints.start(TAB, 0, START);
  assert.deepEqual(await fake.hints.pick(TAB, 0, "s1", "s", ["a", "x"]), { ok: true, left: ["x"] });
  assert.deepEqual(seen, [["a", "x"]]);
  await fake.hints.pick(TAB, 0, "s1", "s");
  assert.equal(seen[1], undefined);
});

test("an end that races a pick in flight still delivers the owner's answer, and drops the session", async () => {
  let answer!: (reply: unknown) => void;
  const fake = harness({ 0: { count: 1 }, 2: { count: 1, pick: () => new Promise((resolve) => (answer = resolve)) } });
  await fake.hints.start(TAB, 0, START);
  const picked = fake.hints.pick(TAB, 0, "s1", "s");
  await flush();
  await fake.hints.end(TAB, 0, "s1");
  assert.equal(fake.data[KEY], undefined);
  assert.equal(fake.of_type("hint_frames_end").length, 1);
  answer({ ok: true, left: [] });
  assert.deepEqual(await picked, { ok: true, left: [] });
  assert.deepEqual(await fake.hints.pick(TAB, 0, "s1", "s"), { ok: false, message: "The hints of the other frames have ended" });
});

test("a frame that navigates while its pick is in flight answers gone, with no leftovers for the keyboard frame to lose", async () => {
  let fail!: (error: Error) => void;
  const fake = harness({ 0: { count: 1 }, 2: { count: 1, pick: () => new Promise((_resolve, reject) => (fail = reject)) } });
  await fake.hints.start(TAB, 0, START);
  const picked = fake.hints.pick(TAB, 0, "s1", "s", ["a"]);
  await flush();
  fail(new Error("Could not establish connection. Receiving end does not exist."));
  assert.deepEqual(await picked, { ok: false, message: "The frame of that hint is gone" });
});

test("an unhover goes to every frame of the tab and needs no session", async () => {
  const fake = harness({ 0: { count: 1 }, 2: { count: 1 } });
  await fake.hints.unhover(TAB, "s1");
  assert.deepEqual(fake.of_type("hint_frames_unhover"), [{ frame_id: undefined, message: { type: "hint_frames_unhover", session_id: "s1" } }]);
});

// A tab with a parked frame: a hint with the default frames setting labels the top page and that frame only.
const PARKED_START: StartRequest = { letters: LETTERS, args: { action: "here", filter: "clickable", frames: "same_origin" } };

test("a parked frame is injected and asked alone, and its targets join the top page's labels", async () => {
  const fake = harness({ 0: { count: 2 }, 3: { count: 2 }, 5: { count: 9 } }, { parked: 3 });
  const answer = await fake.hints.start(TAB, 0, PARKED_START);
  assert.deepEqual(fake.injected, [3]);
  assert.deepEqual(fake.of_type("hint_frames_collect").map((entry) => entry.frame_id), [3]);
  assert.ok(answer.ok);
  assert.equal(answer.ok && answer.labels.length, 4);
  assert.deepEqual(fake.unparked, []);
});

test("a parked frame that reports after the keyboard frame still gets its labels: the wait covers it", async () => {
  const fake = harness({ 0: { count: 2 }, 3: { count: 2, late: true } }, { parked: 3 });
  const answer = await fake.hints.start(TAB, 0, PARKED_START);
  assert.equal(answer.ok && answer.labels.length, 4);
});

test("with no parked frame and the default frames setting no other frame is injected or asked, and the labels come out at once", async () => {
  const fake = harness({ 0: { count: 2 }, 5: { count: 9 } });
  const answer = await fake.hints.start(TAB, 0, PARKED_START);
  assert.deepEqual(fake.injected, []);
  assert.deepEqual(fake.of_type("hint_frames_collect"), []);
  assert.equal(answer.ok && answer.labels.length, 2);
  assert.equal(fake.timers.size, 0);
});

test("a parked frame that is gone ends the wait at once, is dropped from the record and adds no label", async () => {
  const fake = harness({ 0: { count: 2 }, 3: { count: 2, gone: true } }, { parked: 3 });
  const answer = await fake.hints.start(TAB, 0, PARKED_START);
  assert.equal(answer.ok && answer.labels.length, 2);
  assert.deepEqual(fake.unparked, [3]);
  assert.equal(fake.timers.size, 0, "the 500 ms wait must not run for a frame that is gone");
  const again = await fake.hints.start(TAB, 0, PARKED_START);
  assert.equal(again.ok && again.labels.length, 2);
  assert.deepEqual(fake.injected, [3], "the second run asks nobody");
});

test("all_frames ignores the park and asks every frame", async () => {
  const fake = harness({ 0: { count: 1 }, 3: { count: 1 }, 5: { count: 1 } }, { parked: 3 });
  await fake.hints.start(TAB, 0, START);
  assert.deepEqual(fake.injected, [undefined]);
});

test("a collect aimed at the parked frame is answered by that frame only: a silent parked frame is not stood in for by another frame", async () => {
  const fake = harness({ 0: { count: 2 }, 3: { count: 2, silent: true }, 5: { count: 9 } }, { parked: 3 });
  const started = fake.hints.start(TAB, 0, PARKED_START);
  await flush();
  fake.fire_timers();
  const answer = await started;
  assert.deepEqual(fake.of_type("hint_frames_collect").map((entry) => entry.frame_id), [3]);
  assert.equal(answer.ok && answer.labels.length, 2, "only the top page's labels: frame 5 added none");
});

test("a pick into another frame marks that frame's entry by its id before the pick goes out, and a pick of the keyboard frame's own label marks nothing", async () => {
  const fake = harness({ 0: { count: 1, pick: () => ({ ok: true }) }, 3: { count: 1, pick: () => ({ ok: true }) } });
  const answer = await fake.hints.start(TAB, 0, START);
  assert.ok(answer.ok);
  await fake.hints.pick(TAB, 0, "s1", answer.labels[0]!);
  assert.deepEqual(fake.entries, []);
  await fake.hints.pick(TAB, 0, "s1", answer.labels[1]!);
  assert.deepEqual(fake.entries, [3]);
});

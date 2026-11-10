// The background side of a macro replay: the loop, the holds it sends, the end it answers, the page-ready waits, Escape, nesting and the wait of runs from other tabs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { create_macro_replay, MAX_MACRO_DEPTH } from "../../src/background/macro_replay.ts";
import type { MacroReplayDeps, ReplayStart, StepPlace } from "../../src/background/macro_replay.ts";
import type { PageReady, PageWatch } from "../../src/background/page_ready.ts";
import type { BoundInvocation } from "../../src/shared/invocation.ts";
import type { RunResponse } from "../../src/shared/messages.ts";
import { create_macro_recorder } from "../../src/background/macro_recorder.ts";

type FakeWatch = PageWatch & { tab_id: number; stopped: boolean; navigate: () => void; answer: (ready: PageReady) => void };

const settle = () => new Promise((resolve) => setImmediate(resolve));

function make(macros: Record<string, BoundInvocation[]>) {
  const log: string[] = [];
  const watches: FakeWatch[] = [];
  let active = 1;
  const loading = new Set<number>();
  // What each step does when it runs: by default it is done at once.
  const effects: Record<string, (place: StepPlace) => RunResponse | Promise<RunResponse> | void> = {};
  const deps: MacroReplayDeps = {
    read_macro: async (register) => macros[register],
    run_step: async (step, place) => {
      log.push(`run ${step.id} in ${place.tab_id}:${place.frame_id}`);
      return (await effects[step.id]?.(place)) ?? { ok: true };
    },
    active_tab_id: async () => active,
    is_loading: async (tab_id) => loading.has(tab_id),
    watch: (tab_id) => {
      let navigated = false;
      let answer!: (ready: PageReady) => void;
      const done = new Promise<PageReady>((resolve) => (answer = resolve));
      const watch: FakeWatch = {
        tab_id,
        stopped: false,
        navigated: () => navigated,
        done: () => (log.push(`wait ${tab_id}`), done),
        stop: () => {
          watch.stopped = true;
          answer("gone");
        },
        navigate: () => (navigated = true),
        answer: (ready) => answer(ready),
      };
      watches.push(watch);
      return watch;
    },
    hold_keys: async (tab_id) => void log.push(`hold ${tab_id}`),
    show_refusal: async (tab_id, message) => void log.push(`refuse ${tab_id} ${message}`),
  };
  const replay = create_macro_replay(deps);
  const start: ReplayStart = { register: "a", tab_id: 1, frame_id: 3, mode: "normal", is_private: false };
  return { replay, log, watches, effects, start, loading, switch_to: (tab_id: number) => (active = tab_id) };
}

test("a replay holds keys in its tab, runs each step in the sender frame, and its end answers ok", async () => {
  const { replay, log, start } = make({ a: [{ id: "scroll.lines" }, { id: "tab.next" }] });
  const played = replay.play(start);
  assert.equal(replay.is_playing(), true);
  const ended = replay.ended();
  assert.equal(await played, true);
  assert.deepEqual(await ended, { ok: true });
  assert.deepEqual(log, ["hold 1", "run scroll.lines in 1:3", "run tab.next in 1:3"]);
  assert.equal(replay.is_playing(), false);
  assert.deepEqual(await replay.ended(), { ok: true });
});

test("the end waits for the whole replay: a page that asks mid-replay gets its answer only after the last step", async () => {
  const { replay, effects, start } = make({ a: [{ id: "hint.run" }, { id: "scroll.lines" }] });
  let pick_done!: (response: RunResponse) => void;
  effects["hint.run"] = () => new Promise((resolve) => (pick_done = resolve));
  const played = replay.play(start);
  await settle();
  let answered: { ok: boolean } | undefined;
  void replay.ended().then((answer) => (answered = answer));
  await settle();
  assert.equal(answered, undefined);
  pick_done({ ok: true });
  await played;
  await settle();
  assert.deepEqual(answered, { ok: true });
});

test("a failed step, a cancelled pick and the depth refusal each end the replay with not ok and run nothing after", async () => {
  const cases: [string, Record<string, BoundInvocation[]>, (effects: ReturnType<typeof make>["effects"]) => void, string[]][] = [
    ["failed", { a: [{ id: "bad" }, { id: "after" }] }, (effects) => (effects.bad = () => ({ ok: false, refusal: { id: "bad", message: "no" } })), ["hold 1", "run bad in 1:3"]],
    ["cancelled", { a: [{ id: "hint.run" }, { id: "after" }] }, (effects) => (effects["hint.run"] = () => ({ ok: true, cancelled: true })), ["hold 1", "run hint.run in 1:3"]],
    ["self nesting", { a: [{ id: "step" }, { id: "macro.play", args: { reg: "a" } }] }, () => undefined, ["hold 1", ...Array<string>(MAX_MACRO_DEPTH).fill("run step in 1:3"), `refuse 1 Macros nest more than ${MAX_MACRO_DEPTH} deep`]],
  ];
  for (const [name, macros, set_up, expected] of cases) {
    const { replay, log, effects, start } = make(macros);
    set_up(effects);
    const played = replay.play(start);
    const ended = replay.ended();
    assert.equal(await played, false, name);
    assert.deepEqual(await ended, { ok: false }, name);
    assert.deepEqual(log, expected, name);
    assert.equal(replay.is_playing(), false, name);
  }
});

test("a nested macro plays inside the replay: no second hold, its steps in order, one end", async () => {
  const { replay, log, start } = make({ a: [{ id: "one" }, { id: "macro.play", args: { reg: "b" } }, { id: "three" }], b: [{ id: "two" }] });
  const ended = replay.ended();
  const played = replay.play(start);
  assert.equal(await played, true);
  assert.deepEqual(log, ["hold 1", "run one in 1:3", "run two in 1:3", "run three in 1:3"]);
  assert.deepEqual(await ended, { ok: true });
});

test("a register with no macro refuses before any hold, and a nested one stops the replay", async () => {
  const empty = make({});
  await assert.rejects(empty.replay.play(empty.start), /Register a holds no macro/);
  assert.deepEqual(empty.log, []);
  assert.equal(empty.replay.is_playing(), false);
  const nested = make({ a: [{ id: "macro.play", args: { reg: "z" } }, { id: "after" }] });
  assert.equal(await nested.replay.play(nested.start), false);
  assert.deepEqual(nested.log, ["hold 1", "refuse 1 Register z holds no macro"]);
});

test("a second play while one runs refuses, and the first plays on", async () => {
  const { replay, effects, start } = make({ a: [{ id: "wait" }] });
  let done!: (response: RunResponse) => void;
  effects.wait = () => new Promise((resolve) => (done = resolve));
  const first = replay.play(start);
  await settle();
  await assert.rejects(replay.play(start), /already playing/);
  done({ ok: true });
  assert.equal(await first, true);
});

test("a navigating step waits for the page before the next step, then holds keys in the new page", async () => {
  const { replay, log, watches, effects, start } = make({ a: [{ id: "open.url" }, { id: "scroll.lines" }] });
  effects["open.url"] = () => void watches.at(-1)!.navigate();
  const played = replay.play(start);
  await settle();
  assert.deepEqual(log, ["hold 1", "run open.url in 1:3", "wait 1"]);
  watches[0]!.answer("ready");
  assert.equal(await played, true);
  assert.deepEqual(log, ["hold 1", "run open.url in 1:3", "wait 1", "hold 1", "run scroll.lines in 1:3"]);
});

test("a tab-switching step holds keys in the new tab at once and again once it is ready, and runs the next step in its top frame", async () => {
  const { replay, log, watches, effects, start, switch_to } = make({ a: [{ id: "tab.next" }, { id: "scroll.lines" }] });
  effects["tab.next"] = () => void switch_to(2);
  const played = replay.play(start);
  await settle();
  assert.equal(watches[0]!.stopped, true, "the old tab's watch ends");
  assert.equal(watches[1]!.tab_id, 2);
  watches[1]!.answer("ready");
  assert.equal(await played, true);
  assert.deepEqual(log, ["hold 1", "run tab.next in 1:3", "hold 2", "wait 2", "hold 2", "run scroll.lines in 2:0"]);
});

test("a step that neither navigates nor switches runs the next one with no wait", async () => {
  const { replay, log, watches, start } = make({ a: [{ id: "scroll.lines" }, { id: "scroll.lines" }] });
  assert.equal(await replay.play(start), true);
  assert.deepEqual(log, ["hold 1", "run scroll.lines in 1:3", "run scroll.lines in 1:3"]);
  assert.ok(watches.every((watch) => watch.stopped));
});

test("a page that does not load in time stops the replay with a refusal and not ok", async () => {
  const { replay, log, watches, effects, start } = make({ a: [{ id: "open.url" }, { id: "scroll.lines" }] });
  effects["open.url"] = () => void watches.at(-1)!.navigate();
  const played = replay.play(start);
  const ended = replay.ended();
  await settle();
  watches[0]!.answer("timeout");
  assert.equal(await played, false);
  assert.deepEqual(await ended, { ok: false });
  assert.deepEqual(log.at(-1), "refuse 1 The page did not load within 10 seconds, so the macro stopped");
  assert.ok(!log.includes("run scroll.lines in 1:3"));
});

test("a loaded page DesertFox does not run on gets no hold, and the replay goes on", async () => {
  const { replay, log, watches, effects, start, switch_to } = make({ a: [{ id: "tab.next" }, { id: "tab.next" }] });
  effects["tab.next"] = () => void switch_to(2);
  const played = replay.play(start);
  await settle();
  watches[1]!.answer("no_script");
  await settle();
  watches.at(-1)!.answer("ready");
  assert.equal(await played, true);
  assert.deepEqual(log, ["hold 1", "run tab.next in 1:3", "hold 2", "wait 2", "run tab.next in 2:0"]);
});

test("Escape during a page-ready wait ends the wait at once, runs no more steps and answers not ok", async () => {
  const { replay, log, watches, effects, start } = make({ a: [{ id: "open.url" }, { id: "scroll.lines" }] });
  effects["open.url"] = () => void watches.at(-1)!.navigate();
  const played = replay.play(start);
  const ended = replay.ended();
  await settle();
  replay.stop();
  assert.equal(watches[0]!.stopped, true);
  assert.equal(await played, false);
  assert.deepEqual(await ended, { ok: false });
  assert.deepEqual(log, ["hold 1", "run open.url in 1:3", "wait 1"]);
});

test("Escape during a step lets that step end and runs no step after it", async () => {
  const { replay, log, effects, start } = make({ a: [{ id: "slow" }, { id: "after" }] });
  let done!: (response: RunResponse) => void;
  effects.slow = () => new Promise((resolve) => (done = resolve));
  const played = replay.play(start);
  await settle();
  replay.stop();
  done({ ok: true });
  assert.equal(await played, false);
  assert.deepEqual(log, ["hold 1", "run slow in 1:3"]);
  // With no replay, Escape does nothing.
  replay.stop();
});

test("a run from a tab the replay is not in waits for the end; one from the replay's tab and one with no replay do not", async () => {
  const { replay, watches, effects, start, switch_to } = make({ a: [{ id: "tab.next" }, { id: "hint.run" }] });
  let pick_done!: (response: RunResponse) => void;
  effects["tab.next"] = () => void switch_to(2);
  effects["hint.run"] = () => new Promise((resolve) => (pick_done = resolve));
  await replay.wait_unless_from(9);
  const played = replay.play(start);
  await settle();
  watches[1]!.answer("ready");
  await settle();
  let left_tab_ran = false;
  void replay.wait_unless_from(1).then(() => (left_tab_ran = true));
  await settle();
  // The pick in tab 2 opens its link through a run from tab 2, which must not wait or the pick would never end.
  await replay.wait_unless_from(2);
  assert.equal(left_tab_ran, false);
  pick_done({ ok: true });
  await played;
  await settle();
  assert.equal(left_tab_ran, true);
});

test("the recorder keeps none of a replay's steps, and keeps the macro.play that started it", async () => {
  const values = new Map<string, unknown>();
  const area = {
    get: async (key: string) => (values.has(key) ? { [key]: structuredClone(values.get(key)) } : {}),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value))),
    remove: async (key: string) => void values.delete(key),
  } as never;
  const { replay, effects, start } = make({ b: [{ id: "scroll.lines" }] });
  const recorder = create_macro_recorder({ session: () => area, tell_tabs: async () => undefined, is_replaying: replay.is_playing });
  const origin = { is_private: false };
  effects["scroll.lines"] = async () => {
    await recorder.record([{ id: "scroll.lines" }], { ok: true }, origin);
    await recorder.record_page(Promise.resolve([{ id: "hint.run" }]), { ok: true }, { ...origin, from_pick: true });
    return { ok: true };
  };
  await recorder.start("a", false);
  await replay.play({ ...start, register: "b" });
  await recorder.record([{ id: "macro.play", args: { reg: "b" } }], { ok: true }, origin);
  assert.deepEqual((await recorder.stop(false)).steps, [{ id: "macro.play", args: { reg: "b" } }]);
});

test("a tab switch by the user during a wait moves the replay there, so a pick in that tab opens its link and the tab holds its keys", async () => {
  const { replay, log, watches, effects, start, switch_to } = make({ a: [{ id: "open.url" }, { id: "hint.run" }] });
  effects["open.url"] = () => void watches.at(-1)!.navigate();
  // The pick opens its link with a run from its own tab, and only ends when that run answers.
  effects["hint.run"] = async (place) => (await replay.wait_unless_from(place.tab_id), { ok: true });
  const played = replay.play(start);
  await settle();
  switch_to(2);
  watches[0]!.answer("ready");
  const stalled = new Promise((resolve) => setTimeout(() => resolve("stalled"), 200));
  assert.equal(await Promise.race([played, stalled]), true);
  assert.deepEqual(log, ["hold 1", "run open.url in 1:3", "wait 1", "hold 1", "hold 2", "run hint.run in 2:0"]);
});

test("a tab closed during its page-ready wait stops the replay", async () => {
  const { replay, log, watches, effects, start } = make({ a: [{ id: "open.url" }, { id: "after" }] });
  effects["open.url"] = () => void watches.at(-1)!.navigate();
  const played = replay.play(start);
  await settle();
  watches[0]!.answer("gone");
  assert.equal(await played, false);
  assert.ok(!log.includes("run after in 1:3"));
});

test("a step whose load the watch has not seen yet still waits when the tab reads loading", async () => {
  const { replay, log, watches, effects, start, loading } = make({ a: [{ id: "hint.run" }, { id: "scroll.lines" }] });
  effects["hint.run"] = () => void loading.add(1);
  const played = replay.play(start);
  await settle();
  assert.deepEqual(log, ["hold 1", "run hint.run in 1:3", "wait 1"]);
  loading.delete(1);
  watches[0]!.answer("ready");
  assert.equal(await played, true);
  assert.equal(log.at(-1), "run scroll.lines in 1:3");
});

test("Escape that comes before the page-ready wait begins still ends it at once", async () => {
  const { replay, log, watches, effects, start } = make({ a: [{ id: "open.url" }, { id: "after" }] });
  effects["open.url"] = () => {
    watches.at(-1)!.navigate();
    replay.stop();
  };
  assert.equal(await replay.play(start), false);
  assert.ok(watches[0]!.stopped);
  assert.ok(!log.includes("run after in 1:3"));
});

test("a step that throws leaves no page watch behind", async () => {
  const { replay, watches, effects, start } = make({ a: [{ id: "boom" }] });
  effects.boom = () => {
    throw new Error("boom");
  };
  await assert.rejects(replay.play(start), /boom/);
  assert.ok(watches.every((watch) => watch.stopped));
  assert.equal(replay.is_playing(), false);
});

test("a step on a page still loading from before it runs the next step at once, with no wait", async () => {
  const { replay, log, start, loading } = make({ a: [{ id: "scroll.lines" }, { id: "scroll.lines" }] });
  loading.add(1);
  const stalled = new Promise((resolve) => setTimeout(() => resolve("stalled"), 200));
  assert.equal(await Promise.race([replay.play(start), stalled]), true);
  assert.deepEqual(log, ["hold 1", "run scroll.lines in 1:3", "run scroll.lines in 1:3"]);
});

// The background side of a macro replay: the loop, the holds it sends, the end it answers, the page-ready waits, Escape, nesting and the wait of runs from other tabs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { create_router } from "../../src/background/router.ts";
import { make_fake } from "./fakes.ts";
import { create_macro_replay, MAX_MACRO_DEPTH, MAX_MACRO_PASSES } from "../../src/background/macro_replay.ts";
import type { MacroReplayDeps, ReplayStart, StepPlace } from "../../src/background/macro_replay.ts";
import type { PageReady, PageWatch } from "../../src/background/page_ready.ts";
import type { BoundInvocation } from "../../src/shared/invocation.ts";
import type { RunResponse } from "../../src/shared/messages.ts";
import { check_play_step } from "../../src/commands/macro.ts";
import { create_macro_recorder } from "../../src/background/macro_recorder.ts";

type FakeWatch = PageWatch & { tab_id: number; stopped: boolean; navigate: () => void; answer: (ready: PageReady) => void };

const settle = () => new Promise((resolve) => setImmediate(resolve));
// Long enough for the whole grace window, whose pauses each take one turn.
const settle_grace = async () => {
  for (let turn = 0; turn < 40; turn++) await settle();
};

function make(macros: Record<string, BoundInvocation[]>, options: { real_timer?: boolean } = {}) {
  const log: string[] = [];
  const steps_run: BoundInvocation[] = [];
  const pointers = new Map<boolean, string>();
  const turns: Array<() => void> = [];
  const watches: FakeWatch[] = [];
  let active = 1;
  const loading = new Set<number>();
  // What each step does when it runs: by default it is done at once.
  const effects: Record<string, (place: StepPlace, lost_reply: (() => Promise<boolean>) | undefined) => RunResponse | Promise<RunResponse> | void> = {};
  // Each grace poll lands here, so a test can start a navigation partway through the grace window. The pause itself is instant.
  const pauses = { count: 0, on_pause: undefined as undefined | ((count: number) => void) };
  const deps: MacroReplayDeps = {
    read_macro: async (register) => macros[register],
    run_step: async (step, place, lost_reply) => {
      log.push(`run ${step.id} in ${place.tab_id}:${place.frame_id}`);
      steps_run.push(step);
      return (await effects[step.id]?.(place, lost_reply)) ?? { ok: true };
    },
    sleep: async () => {
      pauses.count++;
      pauses.on_pause?.(pauses.count);
      await new Promise<void>((resolve) => setImmediate(resolve));
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
    check_play: check_play_step,
    last_played: { read: async (is_private) => pointers.get(is_private), write: async (register, is_private) => void pointers.set(is_private, register) },
    // With `gate.held`, a pass waits here until the test lets it go, so Escape can come between two runs.
    ...(options.real_timer ? {} : { next_turn: () => new Promise<void>((resolve) => (gate.held ? turns.push(resolve) : setImmediate(resolve))) }),
  };
  const gate = { held: false };
  const release_turns = () => turns.splice(0).forEach((resolve) => resolve());
  const replay = create_macro_replay(deps);
  const start: ReplayStart = { register: "a", tab_id: 1, frame_id: 3, mode: "normal", is_private: false };
  return { replay, log, watches, effects, pauses, start, loading, steps_run, pointers, macros, turns, gate, deps, release_turns, switch_to: (tab_id: number) => (active = tab_id) };
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

test("a recorded step over a repeat limit is refused by the router, so the replay ends not ok and runs nothing after", async () => {
  const closed: number[] = [];
  const fake = make_fake({ "tab.close": { label: "Close", intent: "x", runs_in: "background", count: "repeat", repeat_limit: 20, run: () => void closed.push(1) }, "tab.next": { label: "Next", intent: "x", runs_in: "background", run: () => void closed.push(0) } });
  const router = create_router(fake.deps);
  const { replay, effects, steps_run, start } = make({ a: [{ id: "tab.close", count: 100 }, { id: "tab.next" }] });
  effects["tab.close"] = () => router.run({ invocations: [steps_run.at(-1)!], mode: "normal", instant: true });
  const played = replay.play(start);
  const ended = replay.ended();
  assert.equal(await played, false);
  assert.deepEqual(await ended, { ok: false });
  assert.deepEqual(closed, []);
  assert.deepEqual(steps_run.map((step) => step.id), ["tab.close"]);
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

const runs = (log: string[], id: string) => log.filter((line) => line.startsWith(`run ${id} `)).length;

test("a count plays the whole macro that many times in one replay: one hold, one end, and run 2 does not refuse itself", async () => {
  const { replay, log, start } = make({ a: [{ id: "one" }, { id: "two" }] });
  const ended = replay.ended();
  assert.equal(await replay.play({ ...start, count: 3 }), true);
  assert.deepEqual(log, ["hold 1", ...Array<string[]>(3).fill(["run one in 1:3", "run two in 1:3"]).flat()]);
  assert.deepEqual(await ended, { ok: true });
  assert.equal(replay.is_playing(), false);
});

test("the default timer between passes plays a count and leaves nothing pending", async () => {
  const { replay, log, watches, start } = make({ a: [{ id: "one" }] }, { real_timer: true });
  assert.equal(await replay.play({ ...start, count: 3 }), true);
  assert.equal(runs(log, "one"), 3);
  assert.ok(watches.every((watch) => watch.stopped));
});

test("a count stops at the first failed or cancelled pass", async () => {
  for (const effect of [{ ok: false, refusal: { id: "x", message: "no" } }, { ok: true, cancelled: true }] as RunResponse[]) {
    const { replay, log, effects, start } = make({ a: [{ id: "x" }] });
    let pass = 0;
    effects.x = () => (++pass === 2 ? effect : { ok: true });
    assert.equal(await replay.play({ ...start, count: 5 }), false);
    assert.equal(runs(log, "x"), 2);
  }
});

test("Escape between two runs stops the whole count: no more runs, queued keys dropped through ended not ok, no timer or watch left", async () => {
  const { replay, log, watches, start, turns, gate, release_turns } = make({ a: [{ id: "x" }] });
  gate.held = true;
  const played = replay.play({ ...start, count: 5 });
  const ended = replay.ended();
  while (turns.length === 0) await settle();
  assert.equal(runs(log, "x"), 1);
  replay.stop();
  release_turns();
  assert.equal(await played, false);
  assert.equal(runs(log, "x"), 1);
  assert.deepEqual(await ended, { ok: false });
  assert.equal(replay.is_playing(), false);
  assert.equal(turns.length, 0);
  gate.held = false;
  assert.ok(watches.every((watch) => watch.stopped));
  // The next play is free to start.
  assert.equal(await replay.play(start), true);
});

test("Escape during a run of a count lets that step end and starts no further run", async () => {
  const { replay, log, effects, start } = make({ a: [{ id: "x" }, { id: "y" }] });
  let done!: (response: RunResponse) => void;
  effects.x = () => new Promise((resolve) => (done = resolve));
  const played = replay.play({ ...start, count: 4 });
  await settle();
  replay.stop();
  done({ ok: true });
  assert.equal(await played, false);
  assert.deepEqual(log, ["hold 1", "run x in 1:3"]);
});

test("a huge count never hangs: Escape stops it, and a huge count on an empty macro ends at once", async () => {
  const huge = make({ a: [{ id: "x" }] });
  const played = huge.replay.play({ ...huge.start, count: 1e9 });
  for (let tick = 0; tick < 20; tick++) await settle();
  huge.replay.stop();
  assert.equal(await played, false);
  assert.ok(runs(huge.log, "x") >= 1 && runs(huge.log, "x") < 1000);
  const empty = make({ a: [] });
  assert.equal(await empty.replay.play({ ...empty.start, count: 1e9 }), true);
  assert.deepEqual(empty.log, ["hold 1"]);
});

test("a count typed inside a macro stays on its own step on every pass", async () => {
  const { replay, steps_run, start } = make({ a: [{ id: "scroll.lines", count: 3 }, { id: "tab.next" }] });
  await replay.play({ ...start, count: 2 });
  assert.deepEqual(steps_run, [{ id: "scroll.lines", count: 3 }, { id: "tab.next" }, { id: "scroll.lines", count: 3 }, { id: "tab.next" }]);
});

test("a nested counted play runs its macro that many times inside the one replay", async () => {
  const { replay, log, start } = make({ a: [{ id: "macro.play", args: { reg: "b" }, count: 3 }, { id: "after" }], b: [{ id: "x" }] });
  assert.equal(await replay.play(start), true);
  assert.equal(runs(log, "x"), 3);
  assert.equal(log.filter((line) => line.startsWith("hold")).length, 1);
  assert.equal(runs(log, "after"), 1);
  // The count of a stored step may also sit in its args, as the router fills it.
  const args = make({ a: [{ id: "macro.play", args: { reg: "b", count: 2 } }], b: [{ id: "x" }] });
  await args.replay.play(args.start);
  assert.equal(runs(args.log, "x"), 2);
});

test("a counted nested play and a macro that plays itself with @@ still stop at the depth limit", async () => {
  const counted = make({ a: [{ id: "macro.play", args: { reg: "b" }, count: 2 }], b: [{ id: "x" }, { id: "macro.play", args: { reg: "a" }, count: 2 }] });
  assert.equal(await counted.replay.play({ ...counted.start, count: 1 }), false);
  assert.ok(counted.log.includes(`refuse 1 Macros nest more than ${MAX_MACRO_DEPTH} deep`));
  const looping = make({ a: [{ id: "x" }, { id: "macro.play", args: { reg: "@" } }] });
  assert.equal(await looping.replay.play(looping.start), false);
  assert.equal(runs(looping.log, "x"), MAX_MACRO_DEPTH);
  assert.deepEqual(looping.log.at(-1), `refuse 1 Macros nest more than ${MAX_MACRO_DEPTH} deep`);
  assert.equal(looping.replay.is_playing(), false);
});

test("@@ plays the last register played, and refuses when nothing was played", async () => {
  const { replay, log, start, pointers } = make({ a: [{ id: "x" }] });
  await assert.rejects(replay.play({ ...start, register: "@" }), /No macro has been played yet/);
  assert.deepEqual(log, []);
  assert.equal(replay.is_playing(), false);
  await replay.play(start);
  assert.equal(pointers.get(false), "a");
  assert.equal(await replay.play({ ...start, register: "@", count: 2 }), true);
  assert.equal(runs(log, "x"), 3);
});

test("the pointer is set at the start of a play, so @@ after a failed @a plays a again", async () => {
  const { replay, log, effects, start } = make({ a: [{ id: "x" }] });
  effects.x = () => ({ ok: false, refusal: { id: "x", message: "no" } });
  assert.equal(await replay.play(start), false);
  effects.x = undefined as never;
  delete (effects as Record<string, unknown>).x;
  assert.equal(await replay.play({ ...start, register: "@" }), true);
  assert.equal(runs(log, "x"), 2);
});

test("after an @a that plays @b, @@ plays b, as in vim", async () => {
  const { replay, log, start, pointers } = make({ a: [{ id: "macro.play", args: { reg: "b" } }, { id: "in_a" }], b: [{ id: "in_b" }] });
  await replay.play(start);
  assert.equal(pointers.get(false), "b");
  log.length = 0;
  await replay.play({ ...start, register: "@" });
  assert.deepEqual(log.filter((line) => line.startsWith("run")), ["run in_b in 1:3"]);
});

test("the pointer in a private window stays apart from the normal one", async () => {
  const { replay, start, pointers, log } = make({ a: [{ id: "x" }] });
  await replay.play({ ...start, is_private: true });
  assert.equal(pointers.get(true), "a");
  assert.equal(pointers.has(false), false);
  await assert.rejects(replay.play({ ...start, register: "@" }), /No macro has been played yet/);
  assert.equal(await replay.play({ ...start, register: "@", is_private: true }), true);
  assert.equal(runs(log, "x"), 2);
});

test("@@ plays what the pointed register holds now: new content plays, a cleared register refuses cleanly", async () => {
  const { replay, log, start, macros } = make({ a: [{ id: "old" }] });
  await replay.play(start);
  macros.a = [{ id: "new" }];
  await replay.play({ ...start, register: "@" });
  assert.deepEqual(log.filter((line) => line.startsWith("run")), ["run old in 1:3", "run new in 1:3"]);
  delete macros.a;
  await assert.rejects(replay.play({ ...start, register: "@" }), /Register a holds no macro/);
  assert.equal(replay.is_playing(), false);
  const nested = make({ a: [{ id: "macro.play", args: { reg: "b" } }], b: [{ id: "x" }] });
  await nested.replay.play(nested.start);
  delete nested.macros.b;
  await assert.rejects(nested.replay.play({ ...nested.start, register: "@" }), /Register b holds no macro/);
});

test("5@a recorded inside another macro is one macro.play step with its count", async () => {
  const values = new Map<string, unknown>();
  const area = {
    get: async (key: string) => (values.has(key) ? { [key]: structuredClone(values.get(key)) } : {}),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value))),
    remove: async (key: string) => void values.delete(key),
  } as never;
  const { replay } = make({});
  const recorder = create_macro_recorder({ session: () => area, tell_tabs: async () => undefined, is_replaying: replay.is_playing });
  await recorder.start("z", false);
  await recorder.record([{ id: "macro.play", args: { reg: "a" }, count: 5 }], { ok: true }, { is_private: false });
  await recorder.record([{ id: "macro.play", args: { reg: "@" } }], { ok: true }, { is_private: false });
  assert.deepEqual((await recorder.stop(false)).steps, [{ id: "macro.play", args: { reg: "a" }, count: 5 }, { id: "macro.play", args: { reg: "@" } }]);
});

test("a nested step goes through the validator: a bad register or count fails the step and writes no pointer", async () => {
  for (const args of [{ reg: "+" }, { reg: "b", count: 0 }, { reg: "b", count: "abc" }]) {
    const { replay, log, start, pointers } = make({ a: [{ id: "macro.play", args }, { id: "after" }], b: [{ id: "x" }] });
    assert.equal(await replay.play(start), false, JSON.stringify(args));
    assert.equal(pointers.get(false), "a", JSON.stringify(args));
    assert.equal(runs(log, "x") + runs(log, "after"), 0, JSON.stringify(args));
    assert.ok(log.some((line) => line.startsWith("refuse 1 ")), JSON.stringify(args));
  }
  const count_zero = make({ a: [{ id: "macro.play", args: { reg: "b" }, count: 0 }], b: [{ id: "x" }] });
  assert.equal(await count_zero.replay.play(count_zero.start), false);
  const upper = make({ a: [{ id: "macro.play", args: { reg: "B" } }], b: [{ id: "x" }] });
  assert.equal(await upper.replay.play(upper.start), true);
  assert.equal(upper.pointers.get(false), "b");
});

test("a failed pointer write does not stop the play", async () => {
  const { replay, log, start, deps } = make({ a: [{ id: "x" }] });
  deps.last_played.write = async () => Promise.reject(new Error("quota"));
  assert.equal(await replay.play(start), true);
  assert.equal(runs(log, "x"), 1);
});

test("nested counts end at the pass budget like a failed step, with a notice and nothing left behind", async () => {
  const { replay, log, watches, turns, start } = make({ a: [{ id: "macro.play", args: { reg: "b" }, count: 200 }], b: [{ id: "x" }] });
  const began = Date.now();
  const played = replay.play({ ...start, count: 200 });
  const ended = replay.ended();
  assert.equal(await played, false);
  assert.ok(Date.now() - began < 5000);
  assert.deepEqual(await ended, { ok: false });
  assert.ok(runs(log, "x") < MAX_MACRO_PASSES);
  assert.ok(log.includes(`refuse 1 The macro ran ${MAX_MACRO_PASSES} passes, so it stopped`));
  assert.equal(log.filter((line) => line.startsWith("hold")).length, 1);
  assert.equal(replay.is_playing(), false);
  assert.equal(turns.length, 0);
  assert.ok(watches.every((watch) => watch.stopped));
});

const refused_unloaded = { ok: false, refusal: { id: "hint.run", message: "Pick a link needs a page DesertFox runs on" } } as const;

test("a pick that answers before the tab reports loading still waits for the new page", async () => {
  const { replay, log, watches, effects, pauses, start } = make({ a: [{ id: "hint.run" }, { id: "hint.run" }] });
  effects["hint.run"] = () => {
    const watch = watches.at(-1)!;
    pauses.on_pause = (count) => count === 3 && watch.navigate();
  };
  const played = replay.play(start);
  await settle_grace();
  assert.deepEqual(log, ["hold 1", "run hint.run in 1:3", "wait 1"]);
  watches[0]!.answer("ready");
  await settle_grace();
  assert.equal(log.filter((line) => line.startsWith("run hint.run")).length, 2);
  assert.ok(log.indexOf("wait 1") < log.lastIndexOf("run hint.run in 1:3"), "the second pick ran before the first pick's page was ready");
  assert.equal(await played, true);
});

test("a pick whose reply the unload ate counts as done when the tab then navigates, with no refusal", async () => {
  const { replay, log, watches, effects, pauses, start } = make({ a: [{ id: "hint.run" }, { id: "scroll.lines" }] });
  effects["hint.run"] = async (_place, lost_reply) => {
    const watch = watches.at(-1)!;
    pauses.on_pause = (count) => count === 2 && watch.navigate();
    return (await lost_reply?.()) ? { ok: true } : refused_unloaded;
  };
  const played = replay.play(start);
  await settle_grace();
  assert.deepEqual(log, ["hold 1", "run hint.run in 1:3", "wait 1"]);
  watches[0]!.answer("ready");
  assert.equal(await played, true);
  assert.deepEqual(log, ["hold 1", "run hint.run in 1:3", "wait 1", "hold 1", "run scroll.lines in 1:3"]);
  assert.ok(!log.some((line) => line.startsWith("refuse")));
});

test("a lost reply with no navigation after it stays a failure", async () => {
  const { replay, effects, start } = make({ a: [{ id: "hint.run" }, { id: "after" }] });
  let verdict: boolean | undefined;
  effects["hint.run"] = async (_place, lost_reply) => {
    verdict = await lost_reply?.();
    return verdict ? { ok: true } : refused_unloaded;
  };
  assert.equal(await replay.play(start), false);
  assert.equal(verdict, false);
});

test("a same-document navigation waits a short settle, then goes on without a load wait", async () => {
  const { replay, log, effects, watches, pauses, start } = make({ a: [{ id: "hint.run" }, { id: "scroll.lines" }] });
  effects["hint.run"] = () => {
    watches.at(-1)!.navigate();
    // The tab never reads loading, so the page-ready wait answers at once.
    watches.at(-1)!.answer("ready");
  };
  assert.equal(await replay.play(start), true);
  assert.ok(pauses.count >= 1, "no settle pause after the url change");
  assert.deepEqual(log.slice(0, 4), ["hold 1", "run hint.run in 1:3", "wait 1", "hold 1"]);
});

test("a load slower than the timeout still stops the replay after a late-seen navigation", async () => {
  const { replay, log, watches, effects, pauses, start } = make({ a: [{ id: "hint.run" }, { id: "scroll.lines" }] });
  effects["hint.run"] = () => {
    const watch = watches.at(-1)!;
    pauses.on_pause = (count) => count === 2 && watch.navigate();
  };
  const played = replay.play(start);
  await settle_grace();
  watches[0]!.answer("timeout");
  assert.equal(await played, false);
  assert.equal(log.at(-1), "refuse 1 The page did not load within 10 seconds, so the macro stopped");
  assert.ok(!log.includes("run scroll.lines in 1:3"));
});

test("a pick that navigates nowhere waits only the grace window", async () => {
  const { replay, log, pauses, start } = make({ a: [{ id: "hint.run" }, { id: "scroll.lines" }] });
  assert.equal(await replay.play(start), true);
  assert.ok(pauses.count > 0 && pauses.count <= 20, `grace polled ${pauses.count} times`);
  assert.deepEqual(log, ["hold 1", "run hint.run in 1:3", "run scroll.lines in 1:3"]);
});

test("a step that is not a pick takes no grace wait", async () => {
  const { replay, pauses, start } = make({ a: [{ id: "scroll.lines" }, { id: "scroll.lines" }] });
  assert.equal(await replay.play(start), true);
  assert.equal(pauses.count, 0);
});

test("a pick whose action cannot navigate this tab takes no grace wait, and page.follow and a default or here pick do", async () => {
  const cases: [BoundInvocation, boolean][] = [
    [{ id: "hint.run", args: { action: "tab" } }, false],
    [{ id: "hint.run", args: { action: "background" } }, false],
    [{ id: "hint.run", args: { action: "window" } }, false],
    [{ id: "hint.run", args: { action: "copy" } }, false],
    [{ id: "hint.run", args: { action: "hover" } }, false],
    [{ id: "hint.run", args: { action: "here" } }, true],
    [{ id: "hint.run", args: { action: "double_click" } }, true],
    [{ id: "hint.run", args: { filter: "links" } }, true],
    [{ id: "page.follow", args: { direction: "next" } }, true],
  ];
  for (const [step, pays] of cases) {
    const { replay, pauses, start } = make({ a: [step] });
    assert.equal(await replay.play(start), true);
    assert.equal(pauses.count > 0, pays, JSON.stringify(step));
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { create_tab_preload } from "../../src/background/tab_preload.ts";
import type { PreloadDeps, PreloadSettings } from "../../src/background/tab_preload.ts";
import type { DiscardTab } from "../../src/background/tab_discard.ts";

// A small browser with a hand-driven clock. `reload` and `discard` change `discarded` as Firefox does, and `release_reload` lets a test hold a reload open.
function make(tabs: Partial<DiscardTab>[], settings: Partial<PreloadSettings> = {}) {
  const state: DiscardTab[] = tabs.map((tab, index) => ({ id: index + 1, window_id: 1, index, active: index === 0, audible: false, discarded: false, pinned: false, ...tab }));
  const log: string[] = [];
  const timers: { run: () => void; delay_ms: number; cancelled: boolean }[] = [];
  let hold: Promise<void> | undefined;
  const deps: PreloadDeps = {
    discard: {
      read_tab: async (id) => state.find((tab) => tab.id === id),
      tabs_in_window: async (window_id) => state.filter((tab) => tab.window_id === window_id),
      alternate_of: async () => undefined,
      activate: async (id) => {
        for (const tab of state) tab.active = tab.id === id;
      },
      discard: async (id) => {
        log.push(`discard ${id}`);
        const tab = state.find((candidate) => candidate.id === id)!;
        if (!tab.active) tab.discarded = true;
      },
      reload: async (id) => {
        log.push(`reload ${id}`);
        await hold;
        const tab = state.find((candidate) => candidate.id === id);
        if (tab) tab.discarded = false;
      },
    },
    warmup: async (id) => void log.push(`warmup ${id}`),
    settings: async () => ({ tab_preload: true, tab_preload_unload_ms: 60000, ...settings }),
    after: (run, delay_ms) => {
      const timer = { run, delay_ms, cancelled: false };
      timers.push(timer);
      return () => void (timer.cancelled = true);
    },
  };
  const preload = create_tab_preload(deps);
  const hold_reloads = () => {
    let release!: () => void;
    hold = new Promise((resolve) => (release = resolve));
    return () => {
      hold = undefined;
      release();
    };
  };
  // The user takes a tab: the browser activates it and the listener fires.
  const visit = (id: number) => {
    void deps.discard.activate(id);
    preload.activated(id);
  };
  // Fires every timer still armed and lets the unload it starts finish.
  const fire_timers = async () => {
    for (const timer of timers) if (!timer.cancelled) timer.run();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { deps, state, log, timers, preload, visit, fire_timers, hold_reloads };
}

test("a discarded next tab is reloaded, stays inactive and unloads after the delay", async () => {
  const { state, log, timers, preload, fire_timers } = make([{}, {}, { discarded: true }]);
  await preload.after_switch(1, 2, 1);
  assert.deepEqual(log, ["reload 3"]);
  assert.equal(state[2]!.active, false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0]!.delay_ms, 60000);
  await fire_timers();
  assert.deepEqual(log, ["reload 3", "discard 3"]);
  assert.equal(state[2]!.discarded, true);
});

test("a loaded next tab is warmed, never unloaded", async () => {
  const { log, timers, preload } = make([{}, {}, {}]);
  await preload.after_switch(1, 2, 1);
  assert.deepEqual(log, ["warmup 3"]);
  assert.equal(timers.length, 0);
});

test("direction picks the previous tab going backwards", async () => {
  const { log, preload } = make([{ discarded: true, active: false }, { active: true }, {}]);
  await preload.after_switch(1, 2, -1);
  assert.deepEqual(log, ["reload 1"]);
});

test("at the ends of the strip the direction wraps", async () => {
  const forward = make([{ discarded: true, active: false }, {}, { active: true }]);
  await forward.preload.after_switch(1, 3, 1);
  assert.deepEqual(forward.log, ["reload 1"]);
  const backward = make([{}, {}, { discarded: true }]);
  await backward.preload.after_switch(1, 1, -1);
  assert.deepEqual(backward.log, ["reload 3"]);
});

test("a window with one tab, or whose next tab is the landed tab, preloads nothing", async () => {
  const one = make([{}]);
  await one.preload.after_switch(1, 1, 1);
  assert.deepEqual(one.log, []);
});

test("the setting off preloads nothing", async () => {
  const { log, preload } = make([{}, {}, { discarded: true }], { tab_preload: false });
  await preload.after_switch(1, 2, 1);
  assert.deepEqual(log, []);
});

test("a delay of 0 keeps the tab loaded and arms no timer", async () => {
  const { log, timers, preload } = make([{}, {}, { discarded: true }], { tab_preload_unload_ms: 0 });
  await preload.after_switch(1, 2, 1);
  assert.deepEqual(log, ["reload 3"]);
  assert.equal(timers.length, 0);
});

test("activating the preloaded tab cancels its timer", async () => {
  const { state, timers, preload, visit, fire_timers, log } = make([{}, {}, { discarded: true }]);
  await preload.after_switch(1, 2, 1);
  visit(3);
  assert.equal(timers[0]!.cancelled, true);
  visit(1);
  await fire_timers();
  assert.deepEqual(log, ["reload 3"]);
  assert.equal(state[2]!.discarded, false);
});

test("a tab visited and left again is not unloaded even if the timer still fires", async () => {
  const { state, timers, preload, visit, log } = make([{}, {}, { discarded: true }]);
  await preload.after_switch(1, 2, 1);
  visit(3);
  visit(1);
  timers[0]!.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(log, ["reload 3"]);
  assert.equal(state[2]!.discarded, false);
});

test("a tab activated while its reload is still running gets no timer", async () => {
  const { timers, preload, visit, hold_reloads, log } = make([{}, {}, { discarded: true }]);
  const release = hold_reloads();
  const pending = preload.after_switch(1, 2, 1);
  await new Promise((resolve) => setImmediate(resolve));
  visit(3);
  release();
  await pending;
  assert.equal(timers.length, 0);
  assert.deepEqual(log, ["reload 3"]);
});

test("a second move before the first preload finishes does not load the tab twice and keeps one timer each", async () => {
  const { timers, preload, hold_reloads, log, state } = make([{}, {}, { discarded: true }, { discarded: true }]);
  const release = hold_reloads();
  const first = preload.after_switch(1, 2, 1);
  await new Promise((resolve) => setImmediate(resolve));
  const repeated = preload.after_switch(1, 2, 1);
  state[1]!.active = false;
  state[2]!.active = true;
  const second = preload.after_switch(1, 3, 1);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, repeated, second]);
  assert.deepEqual(log, ["reload 3", "reload 4"]);
});

test("a tab closed while its timer runs is left alone", async () => {
  const { state, timers, preload, fire_timers, log } = make([{}, {}, { discarded: true }]);
  await preload.after_switch(1, 2, 1);
  preload.removed(3);
  state.splice(2, 1);
  assert.equal(timers[0]!.cancelled, true);
  await fire_timers();
  assert.deepEqual(log, ["reload 3"]);
});

test("a tab moved while its timer runs is still unloaded by id", async () => {
  const { state, preload, fire_timers, log } = make([{}, {}, { discarded: true }, {}]);
  await preload.after_switch(1, 2, 1);
  [state[2]!.index, state[3]!.index] = [3, 2];
  await fire_timers();
  assert.deepEqual(log, ["reload 3", "discard 3"]);
});

test("the timer never unloads the active, a pinned or an audible tab", async () => {
  for (const change of [{ active: true }, { pinned: true }, { audible: true }] as Partial<DiscardTab>[]) {
    const { state, preload, fire_timers, log } = make([{}, {}, { discarded: true }]);
    await preload.after_switch(1, 2, 1);
    Object.assign(state[2]!, change);
    // The active case: Firefox activated it without the listener, so only the timer's own check protects it.
    await fire_timers();
    assert.deepEqual(log, ["reload 3"], JSON.stringify(change));
    assert.equal(state[2]!.discarded, false);
  }
});

test("a restart of the background loses the timers: the preloaded tab stays loaded and the new instance never unloads it", async () => {
  const { deps, state, timers, preload, log } = make([{}, {}, { discarded: true }]);
  await preload.after_switch(1, 2, 1);
  assert.equal(timers.length, 1);
  // The old instance and its timers die with the background. A new instance starts empty over the same browser.
  const restarted = create_tab_preload(deps);
  await restarted.after_switch(1, 2, 1);
  assert.equal(state[2]!.discarded, false);
  assert.equal(timers.length, 1);
  assert.deepEqual(log, ["reload 3", "warmup 3"]);
});

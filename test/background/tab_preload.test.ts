import assert from "node:assert/strict";
import { test } from "node:test";
import { create_tab_preload } from "../../src/background/tab_preload.ts";
import type { PreloadDeps, PreloadSettings, Preloaded } from "../../src/background/tab_preload.ts";
import type { DiscardTab } from "../../src/background/tab_discard.ts";

// A small browser with a hand-driven clock, alarms and session storage. `reload` and `discard` change `discarded` as Firefox does.
// `hold_reloads` and `hold_reads` keep a browser call open so a test can act in the middle of it.
function make(tabs: Partial<DiscardTab>[], settings: Partial<PreloadSettings> = {}) {
  const state: DiscardTab[] = tabs.map((tab, index) => ({ id: index + 1, window_id: 1, index, active: index === 0, audible: false, discarded: false, pinned: false, ...tab }));
  const log: string[] = [];
  const alarms = new Map<number, number>();
  const clock = { now: 1_000_000 };
  const stored: { entries: Record<string, Preloaded> } = { entries: {} };
  let hold_reload: Promise<void> | undefined;
  let hold_read: Promise<void> | undefined;
  const deps: PreloadDeps = {
    discard: {
      read_tab: async (id) => {
        await hold_read;
        return state.find((tab) => tab.id === id);
      },
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
        await hold_reload;
        const tab = state.find((candidate) => candidate.id === id);
        if (tab) tab.discarded = false;
      },
    },
    warmup: async (id) => void log.push(`warmup ${id}`),
    settings: async () => ({ tab_preload: true, tab_preload_unload_ms: 60000, ...settings }),
    read: async () => structuredClone(stored.entries),
    write: async (entries) => void (stored.entries = structuredClone(entries)),
    set_alarm: (id, when) => void alarms.set(id, when),
    clear_alarm: (id) => void alarms.delete(id),
    now_ms: () => clock.now,
  };
  const real = create_tab_preload(deps);
  // A switch lands on a tab before the preload starts, so the tab is active when it does.
  const preload = {
    ...real,
    after_switch: (window_id: number, landed_id: number, direction: 1 | -1) => {
      for (const tab of state) if (tab.window_id === window_id) tab.active = tab.id === landed_id;
      return real.after_switch(window_id, landed_id, direction);
    },
  };
  const hold = (which: "reload" | "read") => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    if (which === "reload") hold_reload = promise;
    else hold_read = promise;
    return () => {
      if (which === "reload") hold_reload = undefined;
      else hold_read = undefined;
      release();
    };
  };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  // The user takes a tab: the browser activates it and the listener fires.
  const visit = async (id: number) => {
    await deps.discard.activate(id);
    await preload.activated(1, id);
  };
  // The clock passes the deadline and the alarm for `id` fires, if one is armed.
  const fire_alarm = async (id: number) => {
    const when = alarms.get(id);
    if (when === undefined) return;
    clock.now = Math.max(clock.now, when);
    alarms.delete(id);
    await preload.alarm(id);
  };
  return { deps, state, log, alarms, clock, stored, preload, visit, fire_alarm, hold, tick };
}

test("an unloaded next tab is loaded, stays inactive and has no countdown while the user sits next to it", async () => {
  const { state, log, alarms, stored, preload } = make([{}, {}, { discarded: true }]);
  await preload.after_switch(1, 2, 1);
  assert.deepEqual(log, ["reload 3"]);
  assert.equal(state[2]!.active, false);
  assert.deepEqual(stored.entries, { 3: { window_id: 1, direction: 1 } });
  assert.equal(alarms.size, 0);
});

test("the countdown starts when the user leaves the place next to the tab, and the alarm unloads it", async () => {
  const { state, log, alarms, clock, stored, preload, visit, fire_alarm } = make([{}, {}, { discarded: true }, {}]);
  await preload.after_switch(1, 2, 1);
  await visit(2);
  await visit(1);
  assert.equal(alarms.get(3), clock.now + 60000);
  assert.equal(stored.entries[3]!.deadline, clock.now + 60000);
  await fire_alarm(3);
  assert.deepEqual(log, ["reload 3", "discard 3"]);
  assert.equal(state[2]!.discarded, true);
  assert.deepEqual(stored.entries, {});
});

test("moving next to the tab again cancels the countdown, and a stale alarm does nothing", async () => {
  const { state, log, alarms, stored, clock, preload, visit } = make([{}, {}, { discarded: true }, {}]);
  await preload.after_switch(1, 2, 1);
  await visit(1);
  const armed = alarms.get(3)!;
  assert.ok(armed > 0);
  await visit(2);
  assert.equal(alarms.size, 0);
  assert.equal(stored.entries[3]!.deadline, undefined);
  clock.now = armed + 1;
  await preload.alarm(3);
  assert.deepEqual(log, ["reload 3"]);
  assert.equal(state[2]!.discarded, false);
});

test("an alarm before the deadline does nothing", async () => {
  const { log, alarms, preload, visit, clock } = make([{}, {}, { discarded: true }, {}]);
  await preload.after_switch(1, 2, 1);
  await visit(1);
  clock.now = alarms.get(3)! - 1;
  await preload.alarm(3);
  assert.deepEqual(log, ["reload 3"]);
});

test("a long read on the adjacent tab never unloads the preloaded tab", async () => {
  const { log, alarms, clock, preload } = make([{}, {}, { discarded: true }]);
  await preload.after_switch(1, 2, 1);
  clock.now += 10 * 60000;
  await preload.alarm(3);
  assert.equal(alarms.size, 0);
  assert.deepEqual(log, ["reload 3"]);
});

test("visiting the preloaded tab ends the tracking for good", async () => {
  const { state, log, alarms, stored, preload, visit, fire_alarm } = make([{}, {}, { discarded: true }, {}]);
  await preload.after_switch(1, 2, 1);
  await visit(1);
  await visit(3);
  assert.equal(alarms.size, 0);
  assert.deepEqual(stored.entries, {});
  await visit(1);
  await fire_alarm(3);
  assert.deepEqual(log, ["reload 3"]);
  assert.equal(state[2]!.discarded, false);
});

test("an activation while the unload is under way stops it", async () => {
  const { state, log, preload, visit, hold, alarms, clock, tick } = make([{}, {}, { discarded: true }, {}]);
  await preload.after_switch(1, 2, 1);
  await visit(1);
  clock.now = alarms.get(3)!;
  const release = hold("read");
  const unloading = preload.alarm(3);
  await tick();
  // The user visits the tab and leaves it again before the unload reads it.
  state[2]!.active = true;
  const visiting = preload.activated(1, 3);
  state[2]!.active = false;
  release();
  await Promise.all([unloading, visiting]);
  assert.deepEqual(log, ["reload 3"]);
  assert.equal(state[2]!.discarded, false);
});

test("a loaded next tab is warmed and never tracked or unloaded", async () => {
  const { log, stored, alarms, preload, visit } = make([{}, {}, {}, {}]);
  await preload.after_switch(1, 2, 1);
  await visit(1);
  assert.deepEqual(log, ["warmup 3"]);
  assert.deepEqual(stored.entries, {});
  assert.equal(alarms.size, 0);
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

test("a window with one tab preloads nothing, and neither does the setting off", async () => {
  const one = make([{}]);
  await one.preload.after_switch(1, 1, 1);
  assert.deepEqual(one.log, []);
  const off = make([{}, {}, { discarded: true }], { tab_preload: false });
  await off.preload.after_switch(1, 2, 1);
  assert.deepEqual(off.log, []);
});

test("a delay of 0 keeps the tab loaded: leaving its place drops the tracking and arms nothing", async () => {
  const { log, alarms, stored, preload, visit } = make([{}, {}, { discarded: true }, {}], { tab_preload_unload_ms: 0 });
  await preload.after_switch(1, 2, 1);
  await visit(1);
  assert.equal(alarms.size, 0);
  assert.deepEqual(stored.entries, {});
  assert.deepEqual(log, ["reload 3"]);
});

test("a tab activated while its reload is still running is not tracked", async () => {
  const { stored, preload, visit, hold, log, tick } = make([{}, {}, { discarded: true }]);
  const release = hold("reload");
  const pending = preload.after_switch(1, 2, 1);
  await tick();
  await visit(3);
  release();
  await pending;
  assert.deepEqual(stored.entries, {});
  assert.deepEqual(log, ["reload 3"]);
});

test("a user who moved on while the tab loaded gets the countdown at once", async () => {
  const { alarms, preload, visit, hold, tick, clock, state } = make([{}, {}, { discarded: true }, {}]);
  const release = hold("reload");
  const pending = preload.after_switch(1, 2, 1);
  await tick();
  await visit(1);
  release();
  await pending;
  assert.equal(state[2]!.discarded, false);
  assert.equal(alarms.get(3), clock.now + 60000);
});

test("a second move before the first preload finishes loads each tab once", async () => {
  const { preload, hold, log, tick } = make([{}, {}, { discarded: true }, { discarded: true }]);
  const release = hold("reload");
  const first = preload.after_switch(1, 2, 1);
  await tick();
  const repeated = preload.after_switch(1, 2, 1);
  release();
  await Promise.all([first, repeated]);
  assert.deepEqual(log, ["reload 3"]);
});

test("a tab closed while its countdown runs is left alone", async () => {
  const { state, alarms, stored, log, preload, visit, fire_alarm } = make([{}, {}, { discarded: true }, {}]);
  await preload.after_switch(1, 2, 1);
  await visit(1);
  await preload.removed(3);
  state.splice(2, 1);
  assert.equal(alarms.size, 0);
  assert.deepEqual(stored.entries, {});
  await fire_alarm(3);
  assert.deepEqual(log, ["reload 3"]);
});

test("a tab moved while its countdown runs is still unloaded by id", async () => {
  const { state, log, preload, visit, fire_alarm } = make([{}, {}, { discarded: true }, {}]);
  await preload.after_switch(1, 2, 1);
  await visit(1);
  [state[2]!.index, state[3]!.index] = [3, 2];
  await fire_alarm(3);
  assert.deepEqual(log, ["reload 3", "discard 3"]);
});

test("the alarm never unloads the active, a pinned or an audible tab", async () => {
  for (const change of [{ active: true }, { pinned: true }, { audible: true }] as Partial<DiscardTab>[]) {
    const { state, log, preload, visit, fire_alarm } = make([{}, {}, { discarded: true }, {}]);
    await preload.after_switch(1, 2, 1);
    await visit(1);
    Object.assign(state[2]!, change);
    await fire_alarm(3);
    assert.deepEqual(log, ["reload 3"], JSON.stringify(change));
    assert.equal(state[2]!.discarded, false);
  }
});

test("a restart of the background keeps the countdown: the stored entry re-arms its alarm and the alarm unloads the tab", async () => {
  const { deps, state, alarms, log, clock, preload, visit } = make([{}, {}, { discarded: true }, {}]);
  await preload.after_switch(1, 2, 1);
  await visit(1);
  const deadline = alarms.get(3)!;
  // The new instance has nothing in memory, and the extension reload dropped the alarms.
  alarms.clear();
  const restarted = create_tab_preload(deps);
  await restarted.resume();
  assert.equal(alarms.get(3), deadline);
  clock.now = deadline;
  await restarted.alarm(3);
  assert.deepEqual(log, ["reload 3", "discard 3"]);
  assert.equal(state[2]!.discarded, true);
  void preload;
});

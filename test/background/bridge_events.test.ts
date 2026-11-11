import assert from "node:assert/strict";
import { test } from "node:test";
import { create_bridge_events, TAB_UPDATE_SETTLE_MS } from "../../src/background/bridge_events.ts";
import type { TabInfo } from "../../src/background/tab_switch.ts";

function make() {
  const sent: Record<string, unknown>[] = [];
  const timers: { run: () => void; delay_ms: number; cancelled: boolean }[] = [];
  const state = { sharing: true };
  const tabs = new Map<number, TabInfo>([
    [11, { id: 11, windowId: 1, title: "Mail", url: "https://mail.example/" }],
    [12, { id: 12, windowId: 1, title: "Music", url: "https://music.example/" }],
  ]);
  // A test can hold the next lookups until it lets them go, to race them against a removal or a settings change.
  const held: (() => void)[] = [];
  let holding = false;
  const events = create_bridge_events({
    sharing: () => state.sharing,
    send: (event) => void sent.push(event as Record<string, unknown>),
    normal_tab: async (tab_id) => {
      if (holding) await new Promise<void>((resolve) => held.push(resolve));
      return tabs.get(tab_id) && { ...tabs.get(tab_id)! };
    },
    after: (run, delay_ms) => {
      const timer = { run, delay_ms, cancelled: false };
      timers.push(timer);
      return () => void (timer.cancelled = true);
    },
  });
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
  const live = () => timers.filter((timer) => !timer.cancelled);
  return {
    events, sent, state, tabs, settle, live,
    hold: () => void (holding = true),
    release: () => {
      holding = false;
      for (const resolve of held.splice(0)) resolve();
    },
    fire: async () => {
      for (const timer of live()) {
        timer.cancelled = true;
        timer.run();
      }
      await settle();
    },
  };
}

test("a burst of title and address changes goes out once, with the values at the end of the window", async () => {
  const test_case = make();
  for (const title of ["0:01", "0:02", "0:03"]) test_case.events.tab_updated(11, { title });
  test_case.events.tab_updated(11, { url: "https://mail.example/inbox" });
  assert.deepEqual(test_case.live().map((timer) => timer.delay_ms), [TAB_UPDATE_SETTLE_MS]);
  test_case.tabs.set(11, { id: 11, windowId: 1, title: "0:03", url: "https://mail.example/inbox" });
  await test_case.fire();
  assert.deepEqual(test_case.sent, [{ verb: "event", event: "tab_updated", tab_id: 11, window_id: 1, title: "0:03", url: "https://mail.example/inbox" }]);
  test_case.events.tab_updated(11, { title: "0:04" });
  assert.equal(test_case.live().length, 1, "a change after the window starts a new one");
});

test("each tab settles on its own", async () => {
  const test_case = make();
  test_case.events.tab_updated(11, { title: "a" });
  test_case.events.tab_updated(12, { title: "b" });
  assert.equal(test_case.live().length, 2);
  await test_case.fire();
  assert.deepEqual(test_case.sent.map((event) => event.tab_id), [11, 12]);
});

test("an audible change goes out at once with the title and address, and starts no window", async () => {
  const test_case = make();
  test_case.events.tab_updated(12, { audible: true });
  await test_case.settle();
  assert.deepEqual(test_case.sent, [{ verb: "event", event: "tab_audible", tab_id: 12, window_id: 1, audible: true, title: "Music", url: "https://music.example/" }]);
  assert.equal(test_case.live().length, 0);
});

test("a removal cancels the pending update and is sent only for a tab a subscriber heard of", async () => {
  const test_case = make();
  test_case.events.tab_updated(11, { audible: true });
  await test_case.settle();
  test_case.events.tab_updated(11, { title: "x" });
  const pending = test_case.live()[0]!;
  test_case.tabs.delete(11);
  test_case.events.tab_removed(11);
  test_case.events.tab_removed(12);
  await test_case.settle();
  assert.equal(pending.cancelled, true);
  assert.deepEqual(test_case.sent.map((event) => event.event), ["tab_audible", "tab_removed"]);
  assert.equal(test_case.sent[1]!.tab_id, 11);
  test_case.events.tab_removed(11);
  await test_case.settle();
  assert.equal(test_case.sent.length, 2, "a second removal of the same tab sends nothing");
});

test("an update whose lookup is in flight when the tab closes still lands before the removal", async () => {
  const test_case = make();
  test_case.events.tab_updated(11, { title: "x" });
  test_case.hold();
  await test_case.fire();
  test_case.events.tab_removed(11);
  await test_case.settle();
  assert.equal(test_case.sent.length, 0);
  test_case.release();
  await test_case.settle();
  assert.deepEqual(test_case.sent.map((event) => event.event), ["tab_updated", "tab_removed"]);
});

test("a tab outside a normal window sends nothing and is never announced", async () => {
  const test_case = make();
  test_case.events.tab_updated(50, { audible: true, title: "Secret" });
  await test_case.events.tab_activated(50);
  await test_case.fire();
  test_case.events.tab_removed(50);
  await test_case.settle();
  assert.deepEqual(test_case.sent, []);
});

test("sharing that goes off during a lookup stops the event", async () => {
  const test_case = make();
  test_case.hold();
  void test_case.events.tab_activated(11);
  test_case.events.tab_updated(12, { audible: true });
  await test_case.settle();
  test_case.state.sharing = false;
  test_case.release();
  await test_case.settle();
  assert.deepEqual(test_case.sent, []);
});

test("sharing_off cancels every pending update, forgets the announced tabs and says tabs_off", async () => {
  const test_case = make();
  await test_case.events.tab_activated(11);
  test_case.events.tab_updated(11, { title: "a" });
  test_case.events.tab_updated(12, { title: "b" });
  const pending = test_case.live();
  test_case.state.sharing = false;
  test_case.events.sharing_off();
  assert.ok(pending.every((timer) => timer.cancelled));
  test_case.state.sharing = true;
  test_case.events.tab_removed(11);
  await test_case.settle();
  assert.deepEqual(test_case.sent.map((event) => event.event), ["tab_activated", "tabs_off"]);
});

test("with sharing off a change starts no window and sends nothing", async () => {
  const test_case = make();
  test_case.state.sharing = false;
  test_case.events.tab_updated(11, { title: "a", audible: true });
  await test_case.events.tab_activated(11);
  await test_case.settle();
  assert.deepEqual(test_case.sent, []);
  assert.equal(test_case.live().length, 0);
});

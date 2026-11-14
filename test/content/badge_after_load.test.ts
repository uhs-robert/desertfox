import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { BadgeState } from "../../src/content/ui/mode_label.ts";

const NORMAL: BadgeState = { mode: "normal", pass_next: false, setting: "always", recording: undefined };

// A window that records its load listeners and a document whose readyState the test sets.
let load_listeners: Set<() => void>;
let ready_state: string;
const fire_load = (): void => {
  ready_state = "complete";
  for (const listener of [...load_listeners]) {
    load_listeners.delete(listener);
    listener();
  }
};

beforeEach(() => {
  load_listeners = new Set();
  ready_state = "interactive";
  const window_stub = {
    addEventListener: (_type: string, listener: () => void) => void load_listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void load_listeners.delete(listener),
  } as { top?: unknown };
  window_stub.top = window_stub;
  Object.assign(globalThis, {
    window: window_stub,
    document: {
      get readyState() {
        return ready_state;
      },
      documentElement: { querySelectorAll: () => [] },
    },
  });
});
afterEach(() => mock.restoreAll());

async function proxy_with_drawn_states() {
  const { bundles } = await import("../../src/content/bundles.ts");
  const { show_mode_label } = await import("../../src/content/ui_proxy.ts");
  const drawn: BadgeState[] = [];
  mock.method(bundles, "run_command_", (_id: string, _bundle: string, args: BadgeState) => void drawn.push(args));
  return { show_mode_label, drawn };
}

test("a normal badge before load waits for the load event and then draws", async () => {
  const { show_mode_label, drawn } = await proxy_with_drawn_states();
  show_mode_label(NORMAL);
  assert.equal(drawn.length, 0);
  fire_load();
  assert.deepEqual(drawn, [NORMAL]);
});

test("a normal badge after load draws at once and leaves no listener", async () => {
  ready_state = "complete";
  const { show_mode_label, drawn } = await proxy_with_drawn_states();
  show_mode_label(NORMAL);
  assert.equal(drawn.length, 1);
  assert.equal(load_listeners.size, 0);
});

test("a non-normal state before load draws at once", async () => {
  const { show_mode_label, drawn } = await proxy_with_drawn_states();
  const states: BadgeState[] = [
    { ...NORMAL, mode: "insert" },
    { ...NORMAL, pass_next: true },
    { ...NORMAL, site_label: "SHEETS" },
    { ...NORMAL, recording: "a" },
  ];
  for (const state of states) show_mode_label(state);
  assert.deepEqual(drawn, states);
  assert.equal(load_listeners.size, 0);
});

test("a mode change before load draws at once and cancels the waiting draw", async () => {
  const { show_mode_label, drawn } = await proxy_with_drawn_states();
  show_mode_label(NORMAL);
  const insert = { ...NORMAL, mode: "insert" } as const;
  show_mode_label(insert);
  assert.deepEqual(drawn, [insert]);
  assert.equal(load_listeners.size, 0);
  fire_load();
  assert.deepEqual(drawn, [insert]);
});

test("repeated normal states before load leave one listener and draw the last state once", async () => {
  const { show_mode_label, drawn } = await proxy_with_drawn_states();
  show_mode_label(NORMAL);
  const later = { ...NORMAL, setting: "not_normal" } as const;
  show_mode_label(later);
  assert.equal(load_listeners.size, 1);
  fire_load();
  assert.deepEqual(drawn, [later]);
});

test("hiding the badge before load cancels the waiting draw", async () => {
  const { show_mode_label, drawn } = await proxy_with_drawn_states();
  show_mode_label(NORMAL);
  show_mode_label();
  assert.equal(load_listeners.size, 0);
  fire_load();
  assert.equal(drawn.length, 0);
});

test("a subframe adds no listener and draws nothing", async () => {
  const { show_mode_label, drawn } = await proxy_with_drawn_states();
  (window as { top?: unknown }).top = {};
  show_mode_label(NORMAL);
  assert.equal(load_listeners.size, 0);
  assert.equal(drawn.length, 0);
});

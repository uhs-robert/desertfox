import assert from "node:assert/strict";
import { test } from "node:test";
import { read_recent_window_ids, track_window_focus } from "../../src/background/window_focus.ts";

function make(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const storage = {
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
  } as unknown as Parameters<typeof read_recent_window_ids>[0];
  const listeners = { focus: (_id: number) => {}, removed: (_id: number) => {} };
  const tracker = track_window_focus(storage, {
    onFocusChanged: { addListener: (listener) => void (listeners.focus = listener) },
    onRemoved: { addListener: (listener) => void (listeners.removed = listener) },
  });
  return { storage, listeners, tracker };
}

test("focus puts a window first and moves a repeat to the front", async () => {
  const { storage, listeners, tracker } = make();
  for (const id of [4, 5, 6, 5]) listeners.focus(id);
  await tracker.settled();
  assert.deepEqual(await read_recent_window_ids(storage), [5, 6, 4]);
});

test("losing focus to no window is ignored", async () => {
  const { storage, listeners, tracker } = make();
  listeners.focus(4);
  listeners.focus(-1);
  await tracker.settled();
  assert.deepEqual(await read_recent_window_ids(storage), [4]);
});

test("a closed window drops out of the list", async () => {
  const { storage, listeners, tracker } = make();
  listeners.focus(4);
  listeners.focus(5);
  listeners.removed(5);
  await tracker.settled();
  assert.deepEqual(await read_recent_window_ids(storage), [4]);
});

test("the list survives a restart because it is read back from storage", async () => {
  const first = make();
  first.listeners.focus(4);
  await first.tracker.settled();
  const restarted = make({ oasisfox_window_focus: await read_recent_window_ids(first.storage) });
  restarted.listeners.focus(9);
  await restarted.tracker.settled();
  assert.deepEqual(await read_recent_window_ids(restarted.storage), [9, 4]);
});

test("a stored value of the wrong shape reads as empty", async () => {
  assert.deepEqual(await read_recent_window_ids(make({ oasisfox_window_focus: "x" }).storage), []);
});

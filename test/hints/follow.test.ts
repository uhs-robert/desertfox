import assert from "node:assert/strict";
import { test } from "node:test";
import { follow_windows } from "../../src/content/hints/follow.ts";

function fake_window() {
  const listeners = new Set<string>();
  const removed: { type: string; handler: unknown; capture: unknown }[] = [];
  const handlers: Record<string, () => void> = {};
  const adds: Record<string, unknown> = {};
  return {
    listeners,
    removed,
    adds,
    handlers,
    addEventListener: (type: string, handler: () => void, options: unknown) => (listeners.add(type), (handlers[type] = handler), (adds[type] = options)),
    removeEventListener: (type: string, handler: unknown, capture?: unknown) => (listeners.delete(type), removed.push({ type, handler, capture })),
  };
}

test("a scroll in any window repositions the labels, and stopping removes every listener", () => {
  const frames: (() => void)[] = [];
  (globalThis as Record<string, unknown>).requestAnimationFrame = (callback: () => void) => frames.push(callback);
  const top = fake_window();
  const inner = fake_window();
  let repositions = 0;
  const stop = follow_windows([top, inner] as never, () => repositions++);
  inner.handlers.scroll!();
  inner.handlers.scroll!();
  frames.splice(0).forEach((callback) => callback());
  assert.equal(repositions, 1);
  stop();
  for (const win of [top, inner]) {
    assert.deepEqual(win.removed, [
      { type: "scroll", handler: win.handlers.scroll, capture: true },
      { type: "resize", handler: win.handlers.resize, capture: undefined },
    ]);
    assert.equal(win.handlers.scroll, win.handlers.resize);
  }
});

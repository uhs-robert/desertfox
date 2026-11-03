import assert from "node:assert/strict";
import { test } from "node:test";
import { follow_windows } from "../../src/content/hints/follow.ts";

function fake_window() {
  const listeners = new Set<string>();
  const handlers: Record<string, () => void> = {};
  return {
    listeners,
    handlers,
    addEventListener: (type: string, handler: () => void) => (listeners.add(type), (handlers[type] = handler)),
    removeEventListener: (type: string) => listeners.delete(type),
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
  assert.equal(top.listeners.size + inner.listeners.size, 0);
});

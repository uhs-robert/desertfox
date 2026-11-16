import assert from "node:assert/strict";
import { test } from "node:test";
import { smooth_behavior } from "../../src/content/smooth_behavior.ts";

function with_reduced_motion(reduced: { value: boolean }, body: () => void): void {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" && reduced.value }),
  });
  try {
    body();
  } finally {
    if (saved) Object.defineProperty(globalThis, "matchMedia", saved);
    else delete (globalThis as { matchMedia?: unknown }).matchMedia;
  }
}

test("smooth_behavior is smooth, and instant under reduced motion, read on every call", () => {
  const reduced = { value: false };
  with_reduced_motion(reduced, () => {
    assert.equal(smooth_behavior(), "smooth");
    reduced.value = true;
    assert.equal(smooth_behavior(), "instant");
    reduced.value = false;
    assert.equal(smooth_behavior(), "smooth");
  });
});

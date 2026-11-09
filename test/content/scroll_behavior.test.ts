import assert from "node:assert/strict";
import { test } from "node:test";
import { scroll_lines, scroll_pages, scroll_to } from "../../src/content/handlers/scroll.ts";

// A page with one scrolling root and nothing focused. Records the behavior of each scroll call.
function with_page(body: (behaviors: string[]) => void): void {
  const behaviors: string[] = [];
  const record = (options: { behavior: string; top?: number }) => void behaviors.push(options.behavior);
  const root = { scrollWidth: 800, clientWidth: 800, scrollHeight: 4000, clientHeight: 800, scrollBy: record, scrollTo: record };
  const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { scrollingElement: root, documentElement: root, body: {}, activeElement: null, querySelectorAll: () => [] },
  });
  try {
    body(behaviors);
  } finally {
    if (saved) Object.defineProperty(globalThis, "document", saved);
    else delete (globalThis as { document?: unknown }).document;
  }
}

test("page scroll and the top and bottom jumps are smooth on a first press and instant on a repeat", () => {
  with_page((behaviors) => {
    scroll_pages.run({ fraction: 0.5, count: 1 }, false);
    scroll_pages.run({ fraction: 0.5, count: 1 }, true);
    scroll_to.run({ axis: "y", percent: 100 }, false);
    scroll_to.run({ axis: "y", percent: 100 }, true);
    assert.deepEqual(behaviors, ["smooth", "instant", "smooth", "instant"]);
  });
});

test("a counted page scroll is one call for the whole distance", () => {
  const calls: unknown[] = [];
  const root = { scrollWidth: 800, clientWidth: 800, scrollHeight: 4000, clientHeight: 800, scrollBy: (options: unknown) => void calls.push(options) };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { scrollingElement: root, documentElement: root, body: {}, activeElement: null, querySelectorAll: () => [] },
  });
  try {
    scroll_pages.run({ fraction: 0.5, count: 3 }, false);
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
  assert.deepEqual(calls, [{ left: 0, top: 1200, behavior: "smooth" }]);
});

test("line scroll is instant on every press", () => {
  with_page((behaviors) => {
    scroll_lines.run({ count: 1 }, false);
    scroll_lines.run({ count: 1 }, true);
    assert.deepEqual(behaviors, ["instant", "instant"]);
  });
});

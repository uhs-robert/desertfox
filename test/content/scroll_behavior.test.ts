import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { scroll_lines, scroll_pages, scroll_to, tapped_end } from "../../src/content/handlers/scroll.ts";

type Call = { method: string; top?: number | undefined; behavior: string };

// A page with one scrolling root, 4000 px tall in an 800 px view, and nothing focused. Records every scroll call.
function with_page(body: (calls: Call[], root: { scrollTop: number }) => void): void {
  const calls: Call[] = [];
  const root = {
    scrollTop: 0,
    scrollWidth: 800,
    clientWidth: 800,
    scrollHeight: 4000,
    clientHeight: 800,
    scrollBy: (options: Call) => void calls.push({ method: "by", top: options.top, behavior: options.behavior }),
    scrollTo: (options: Call) => void calls.push({ method: "to", top: options.top, behavior: options.behavior }),
  };
  const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { scrollingElement: root, documentElement: root, body: {}, activeElement: null, querySelectorAll: () => [] },
  });
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    body(calls, root);
  } finally {
    mock.timers.reset();
    if (saved) Object.defineProperty(globalThis, "document", saved);
    else delete (globalThis as { document?: unknown }).document;
  }
}

const half_page = { fraction: 0.5, count: 1 };

test("page scroll and the top and bottom jumps are smooth on a first press and instant on a repeat", () => {
  with_page((calls) => {
    scroll_pages.run(half_page, false);
    scroll_pages.run(half_page, true);
    scroll_to.run({ axis: "y", percent: 100 }, false);
    scroll_to.run({ axis: "y", percent: 100 }, true);
    assert.deepEqual(calls.map((call) => call.behavior), ["smooth", "instant", "smooth", "instant"]);
  });
});

test("line scroll is instant on every press", () => {
  with_page((calls) => {
    scroll_lines.run({ count: 1 }, false);
    scroll_lines.run({ count: 1 }, true);
    assert.deepEqual(calls.map((call) => call.behavior), ["instant", "instant"]);
  });
});

test("a counted page scroll is one call for the whole distance", () => {
  with_page((calls) => {
    scroll_pages.run({ fraction: 0.5, count: 3 }, false);
    assert.deepEqual(calls, [{ method: "to", top: 1200, behavior: "smooth" }]);
  });
});

test("tapped_end adds to the end in flight, else to the position, and stays in range", () => {
  assert.equal(tapped_end(undefined, 100, 400, 3200), 500);
  assert.equal(tapped_end(500, 100, 400, 3200), 900);
  assert.equal(tapped_end(3000, 0, 400, 3200), 3200);
  assert.equal(tapped_end(100, 0, -400, 3200), 0);
});

test("quick page taps add up to the end in flight", () => {
  with_page((calls) => {
    for (let tap = 0; tap < 4; tap++) scroll_pages.run(half_page, false);
    assert.deepEqual(calls.map((call) => call.top), [400, 800, 1200, 1600]);
  });
});

test("the end in flight resets after the timeout", () => {
  with_page((calls, root) => {
    scroll_pages.run(half_page, false);
    mock.timers.tick(600);
    root.scrollTop = 400;
    scroll_pages.run(half_page, false);
    assert.deepEqual(calls.map((call) => call.top), [400, 800]);
    mock.timers.tick(599);
    root.scrollTop = 0;
    scroll_pages.run(half_page, false);
    assert.equal(calls.at(-1)?.top, 1200);
  });
});

test("an instant scroll resets the end in flight", () => {
  for (const instant of [() => scroll_lines.run({ count: 1 }, false), () => scroll_pages.run(half_page, true), () => scroll_to.run({ axis: "y", percent: 0 }, false)]) {
    with_page((calls, root) => {
      scroll_pages.run(half_page, false);
      instant();
      root.scrollTop = 50;
      scroll_pages.run(half_page, false);
      assert.equal(calls.at(-1)?.top, 450);
    });
  }
});

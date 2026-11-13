import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { scroll_target, set_scroll_selector } from "../../src/content/handlers/scroll.ts";

type FakeBox = { isConnected: boolean; scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number; style: { overflowX: string; overflowY: string } };

const box = (height: number, client_height: number): FakeBox => ({
  isConnected: true,
  scrollHeight: client_height + 1000,
  clientHeight: height,
  scrollWidth: 100,
  clientWidth: 100,
  style: { overflowX: "hidden", overflowY: "auto" },
});

// A page whose root does not scroll. Counts the whole-page scans and keeps the listeners the scroll code adds.
function with_page(boxes: FakeBox[], body: (scans: () => number, fire: (type: string) => void) => void, document_extra: object = {}): void {
  const root = { scrollWidth: 100, clientWidth: 100, scrollHeight: 100, clientHeight: 100 };
  const listeners = new Map<string, () => void>();
  let scan_count = 0;
  const saved = { document: Object.getOwnPropertyDescriptor(globalThis, "document"), style: Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle"), listen: Object.getOwnPropertyDescriptor(globalThis, "addEventListener") };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { scrollingElement: root, documentElement: root, body: {}, activeElement: null, querySelector: () => null, querySelectorAll: () => (scan_count++, boxes.filter((fake) => fake.isConnected)), ...document_extra },
  });
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: (element: FakeBox) => element.style });
  Object.defineProperty(globalThis, "addEventListener", { configurable: true, value: (type: string, listener: () => void) => void listeners.set(type, listener) });
  try {
    body(() => scan_count, (type) => listeners.get(type)?.());
  } finally {
    // The kept box is module state that outlives the page, so a box that leaves keeps it from reaching the next test.
    for (const fake of boxes) fake.isConnected = false;
    for (const [name, descriptor] of Object.entries({ document: saved.document, getComputedStyle: saved.style, addEventListener: saved.listen })) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  }
}

test("the second press reuses the box the first scan chose", () => {
  const big = box(300, 300);
  with_page([box(100, 100), big], (scans) => {
    assert.equal(scroll_target("y"), big as unknown);
    assert.equal(scroll_target("y"), big as unknown);
    assert.equal(scans(), 1);
  });
});

test("a box that left the page or stopped scrolling is scanned for again", () => {
  const big = box(300, 300);
  const small = box(100, 100);
  with_page([small, big], (scans) => {
    scroll_target("y");
    big.isConnected = false;
    assert.equal(scroll_target("y"), small as unknown);
    assert.equal(scans(), 2);
    small.style.overflowY = "hidden";
    scroll_target("y");
    assert.equal(scans(), 3);
  });
});

test("a focus move or a mouse press drops the kept box", () => {
  for (const type of ["focusin", "pointerdown"]) {
    const big = box(300, 300);
    with_page([big], (scans, fire) => {
      scroll_target("y");
      fire(type);
      scroll_target("y");
      assert.equal(scans(), 2, type);
    });
  }
});

test("each axis keeps its own box", () => {
  const tall = box(300, 300);
  const wide = { ...box(200, 200), scrollWidth: 900, style: { overflowX: "auto", overflowY: "hidden" }, scrollHeight: 200 };
  with_page([tall, wide], (scans) => {
    assert.equal(scroll_target("y"), tall as unknown);
    assert.equal(scroll_target("x"), wide as unknown);
    assert.equal(scroll_target("y"), tall as unknown);
    assert.equal(scans(), 2);
  });
});

test("a pause of a second between scroll keys drops the kept box, and a held key keeps it", () => {
  const big = box(300, 300);
  mock.timers.enable({ apis: ["Date"] });
  try {
    with_page([big], (scans) => {
      scroll_target("y");
      for (let repeat = 0; repeat < 5; repeat++) {
        mock.timers.tick(900);
        scroll_target("y");
      }
      assert.equal(scans(), 1);
      mock.timers.tick(1100);
      scroll_target("y");
      assert.equal(scans(), 2);
    });
  } finally {
    mock.timers.reset();
  }
});

test("the site selector element beats a kept box", () => {
  const kept = box(300, 300);
  const site = box(50, 50);
  with_page([kept], (_scans) => {
    scroll_target("y");
    set_scroll_selector("#site");
    try {
      Object.assign(globalThis.document, { querySelector: () => site });
      assert.equal(scroll_target("y"), site as unknown);
    } finally {
      set_scroll_selector("");
    }
  });
});

test("a scrollable ancestor of the focused element beats a kept box", () => {
  const kept = box(300, 300);
  const focused = { ...box(50, 50), parentElement: null, getRootNode: () => ({}), shadowRoot: null };
  with_page([kept], (_scans) => {
    scroll_target("y");
    Object.assign(globalThis.document, { activeElement: focused });
    assert.equal(scroll_target("y"), focused as unknown);
  });
});

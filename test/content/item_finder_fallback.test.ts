import assert from "node:assert/strict";
import { test } from "node:test";
import { bundles } from "../../src/content/bundles.ts";
import { run_content_invocation } from "../../src/content/run_content.ts";

type Scroll = { top: number; left: number };

// A page with one scrolling root. Records the scrolls that content.js makes itself, which is what the item finder's fallback does when the item bundle refuses.
function with_page(load: () => Promise<boolean>, body: (scrolls: Scroll[]) => Promise<void>): Promise<void> {
  const scrolls: Scroll[] = [];
  const root = { scrollTop: 0, scrollWidth: 800, clientWidth: 800, scrollHeight: 4000, clientHeight: 800, scrollBy: (options: Scroll) => void scrolls.push(options) };
  const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { scrollingElement: root, documentElement: root, body: {}, activeElement: null, querySelectorAll: () => [] } });
  bundles.connect({ request_bundle_: load, on_idle_: () => {}, hold_first_: () => {}, set_mode_: () => {}, show_error_: () => {} });
  return body(scrolls).finally(() => {
    if (saved) Object.defineProperty(globalThis, "document", saved);
    else delete (globalThis as { document?: unknown }).document;
  });
}

const item_step = (args: Record<string, unknown>) => run_content_invocation({ id: "page.item", bundle: "item", args }, "repeat");

test("with no selector, a bundle that cannot load scrolls 50 px per count instead of failing", () =>
  with_page(async () => false, async (scrolls) => {
    assert.deepEqual(await item_step({ direction: "down", times: 2 }), { ok: true });
    assert.deepEqual(await item_step({ direction: "up" }), { ok: true });
    assert.deepEqual(scrolls.map((scroll) => scroll.top), [100, -50]);
  }));

test("a bundle that loads but registers no handler scrolls too", () =>
  with_page(async () => true, async (scrolls) => {
    assert.deepEqual(await item_step({ direction: "down" }), { ok: true });
    assert.deepEqual(scrolls.map((scroll) => scroll.top), [50]);
  }));

test("h and l scroll sideways when the bundle cannot load", () =>
  with_page(async () => false, async (scrolls) => {
    assert.deepEqual(await item_step({ direction: "left" }), { ok: true });
    assert.deepEqual(await item_step({ direction: "right", times: 2 }), { ok: true });
    assert.deepEqual(scrolls.map((scroll) => scroll.left), [-50, 100]);
  }));

test("a row that names a selector keeps the refusal, and so do the ends, which do not scroll", () =>
  with_page(async () => false, async (scrolls) => {
    assert.equal((await item_step({ selector: "li", direction: "down" })).ok, false);
    assert.equal((await item_step({ direction: "first" })).ok, false);
    assert.deepEqual(scrolls, []);
  }));

test("a handler that fails scrolls, and one that finishes does not", () =>
  with_page(async () => true, async (scrolls) => {
    bundles.api.register_handler_("page.item", () => ({ ok: false, message: "No next item" }));
    assert.deepEqual(await item_step({ direction: "down" }), { ok: true });
    assert.deepEqual(scrolls.map((scroll) => scroll.top), [50]);
    bundles.api.register_handler_("page.item", () => undefined);
    assert.deepEqual(await item_step({ direction: "down" }), { ok: true });
    assert.deepEqual(scrolls.map((scroll) => scroll.top), [50]);
  }));

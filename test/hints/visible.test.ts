import assert from "node:assert/strict";
import { test } from "node:test";
import { contains_composed, keep_visible, visible_point } from "../../src/content/hints/visible.ts";
import type { PageProbe, Rect } from "../../src/content/hints/visible.ts";

type Box = { name: string; rect: Rect; intersecting?: boolean; hidden?: boolean; covered_by?: string };

const probe: PageProbe<Box> = {
  is_intersecting: (box) => box.intersecting ?? true,
  rect_of: (box) => box.rect,
  viewport_of: () => ({ width: 800, height: 600 }),
  is_hidden_by_style: (box) => box.hidden ?? false,
  is_reachable_at: (box) => box.covered_by === undefined,
};

const at = (left: number, top: number, width = 100, height = 20): Rect => ({ left, top, right: left + width, bottom: top + height });

test("visible_point is the middle of the part on screen", () => {
  assert.deepEqual(visible_point(at(100, 100, 100, 20), { width: 800, height: 600 }), { x: 150, y: 110 });
  assert.deepEqual(visible_point(at(-50, 10, 100, 20), { width: 800, height: 600 }), { x: 25, y: 20 });
  assert.deepEqual(visible_point(at(750, 590, 100, 100), { width: 800, height: 600 }), { x: 775, y: 595 });
});

test("a box with no part on screen or no size has no point", () => {
  assert.equal(visible_point(at(0, 700), { width: 800, height: 600 }), undefined);
  assert.equal(visible_point(at(-200, 0), { width: 800, height: 600 }), undefined);
  assert.equal(visible_point(at(10, 10, 0, 20), { width: 800, height: 600 }), undefined);
});

test("keep_visible drops hidden, clipped, off-screen, empty and covered boxes and keeps the order", () => {
  const boxes: Box[] = [
    { name: "plain", rect: at(10, 10) },
    { name: "hidden", rect: at(10, 40), hidden: true },
    { name: "clipped by a scrolling parent", rect: at(10, 70), intersecting: false },
    { name: "below the fold", rect: at(10, 900) },
    { name: "empty", rect: at(10, 100, 0, 0) },
    { name: "covered", rect: at(10, 130), covered_by: "modal" },
    { name: "second plain", rect: at(10, 160) },
  ];
  assert.deepEqual(keep_visible(boxes, probe).map((box) => box.name), ["plain", "second plain"]);
});

test("contains_composed climbs out of a shadow root through its host", () => {
  const host = { parentNode: null };
  const shadow = { parentNode: null, host };
  const inner = { parentNode: shadow };
  assert.equal(contains_composed(host, inner), true);
  assert.equal(contains_composed(inner, host), false);
  assert.equal(contains_composed(inner, inner), true);
});

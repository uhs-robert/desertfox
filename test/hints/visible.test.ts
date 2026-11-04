import assert from "node:assert/strict";
import { test } from "node:test";
import { contains_composed, keep_visible, points_to_probe, uncovered_through_frames, visible_point } from "../../src/content/hints/visible.ts";
import type { PageProbe, Rect } from "../../src/content/hints/visible.ts";

type Box = { name: string; rect: Rect; rects?: Rect[]; reachable_at?: (x: number, y: number) => boolean; intersecting?: boolean; hidden?: boolean; covered_by?: string };

const probe: PageProbe<Box> = {
  is_intersecting: (box) => box.intersecting ?? true,
  rects_of: (box) => box.rects ?? [box.rect],
  viewport_of: () => ({ width: 800, height: 600 }),
  is_hidden_by_style: (box) => box.hidden ?? false,
  is_reachable_at: (box, x, y) => box.covered_by === undefined && (box.reachable_at?.(x, y) ?? true),
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

test("a candidate in a frame is dropped when the parent document covers the frame", () => {
  const link = { parentNode: null as unknown, ownerDocument: { elementFromPoint: () => null as unknown } };
  const modal = { parentNode: null as unknown };
  const frame = { parentNode: null as unknown, clientLeft: 1, clientTop: 2, getBoundingClientRect: () => at(100, 200), ownerDocument: { elementFromPoint: (_x: number, _y: number) => modal as unknown } };
  const found = { element: link, frames: [frame] };
  assert.equal(uncovered_through_frames(found, 5, 5), false);
  const seen: [number, number][] = [];
  frame.ownerDocument.elementFromPoint = (x, y) => (seen.push([x, y]), frame);
  assert.equal(uncovered_through_frames(found, 5, 5), true);
  assert.deepEqual(seen, [[106, 207]]);
});

const viewport = { width: 800, height: 600 };

test("points_to_probe lists each line box middle, then the inset corners of the first box", () => {
  const points = points_to_probe([at(100, 100, 100, 20), at(10, 120, 50, 20)], viewport);
  assert.deepEqual(points.slice(0, 2), [{ x: 150, y: 110 }, { x: 35, y: 130 }]);
  assert.deepEqual(points.slice(2), [{ x: 102, y: 102 }, { x: 102, y: 118 }, { x: 198, y: 102 }, { x: 198, y: 118 }]);
});

test("points_to_probe caps the count, clips to the screen and skips boxes off screen", () => {
  const many = Array.from({ length: 10 }, (_, i) => at(10, i * 20, 100, 20));
  assert.equal(points_to_probe(many, viewport).length, 8);
  assert.deepEqual(points_to_probe([at(0, 700)], viewport), []);
  assert.deepEqual(points_to_probe([at(-50, 10, 100, 4)], viewport)[0], { x: 25, y: 12 });
  const thin = points_to_probe([at(10, 10, 2, 2)], viewport);
  assert.ok(thin.every((p) => p.x >= 10 && p.x <= 12 && p.y >= 10 && p.y <= 12));
});

test("keep_visible keeps a wrapped link whose second line is reachable and a link covered only at the middle", () => {
  const wrapped: Box = { name: "wrapped", rect: at(0, 0, 300, 40), rects: [at(200, 0, 100, 20), at(0, 20, 100, 20)], reachable_at: (_x, y) => y >= 20 };
  const header_overlap: Box = { name: "under header", rect: at(10, 100, 100, 40), reachable_at: (_x, y) => y > 125 };
  const covered: Box = { name: "covered", rect: at(10, 200, 100, 20), reachable_at: () => false };
  assert.deepEqual(keep_visible([wrapped, header_overlap, covered], probe).map((box) => box.name), ["wrapped", "under header"]);
});

test("keep_visible stops probing a link at the first hit", () => {
  let calls = 0;
  const box: Box = { name: "a", rect: at(10, 10), reachable_at: () => (calls++, true) };
  keep_visible([box], probe);
  assert.equal(calls, 1);
});

test("points_to_probe keeps the visible lines of a long link that starts above the screen", () => {
  const lines = Array.from({ length: 8 }, (_, i) => at(10, -100 + i * 20, 100, 20));
  const points = points_to_probe(lines, viewport);
  assert.deepEqual(points.slice(0, 3), [{ x: 60, y: 10 }, { x: 60, y: 30 }, { x: 60, y: 50 }]);
});

test("points_to_probe stays inside a viewport narrower than the window by a scrollbar", () => {
  const narrow = { width: 785, height: 600 };
  const points = points_to_probe([at(700, 10, 100, 20)], narrow);
  assert.ok(points.length > 0 && points.every((p) => p.x < 785));
});

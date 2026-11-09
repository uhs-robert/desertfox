import assert from "node:assert/strict";
import { test } from "node:test";
import { is_scroll_box } from "../src/content/scroll_box.ts";

const document_like = { documentElement: {} as Element, body: {} as Element };
const box = (sizes: { sw: number; cw: number; sh: number; ch: number }) =>
  ({ scrollWidth: sizes.sw, clientWidth: sizes.cw, scrollHeight: sizes.sh, clientHeight: sizes.ch, ownerDocument: document_like }) as unknown as Element;
const style = (overflow_x_: string, overflow_y_: string) => ({ overflowX: overflow_x_, overflowY: overflow_y_ });
const tall = { sw: 100, cw: 100, sh: 900, ch: 100 };

test("a box with more content than room and overflow auto, scroll or overlay is a scroll box", () => {
  for (const value of ["auto", "scroll", "overlay"]) assert.equal(is_scroll_box(box(tall), style("visible", value)), true, value);
});

test("a box that scrolls sideways only counts", () => {
  assert.equal(is_scroll_box(box({ sw: 900, cw: 100, sh: 100, ch: 100 }), style("auto", "hidden")), true);
});

test("content that fits is no scroll box", () => {
  assert.equal(is_scroll_box(box({ sw: 100, cw: 100, sh: 100, ch: 100 }), style("auto", "auto")), false);
});

test("overflow visible, hidden or clip is no scroll box, even with extra content", () => {
  for (const value of ["visible", "hidden", "clip"]) assert.equal(is_scroll_box(box(tall), style(value, value)), false, value);
});

test("the page root and body are left out", () => {
  assert.equal(is_scroll_box(box(tall), style("auto", "auto")), true);
  for (const page_part of [document_like.documentElement, document_like.body]) {
    Object.assign(page_part, box(tall));
    assert.equal(is_scroll_box(page_part, style("auto", "auto")), false);
  }
});

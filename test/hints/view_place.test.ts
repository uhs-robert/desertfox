import assert from "node:assert/strict";
import { test } from "node:test";
import { filter_label, place_label } from "../../src/content/hints/view.ts";

const fake_style = () => ({ display: "", visibility: "", left: "", top: "" });

test("a reposition keeps a label hidden that the typed prefix filtered out", () => {
  const style = fake_style();
  place_label(style, { left: 10, top: 20 });
  filter_label(style, false);
  place_label(style, { left: 15, top: 25 });
  assert.equal(style.display, "none");
  assert.equal(style.left, "15px");
});

test("typing does not reveal a label that has no box", () => {
  const style = fake_style();
  place_label(style, undefined);
  filter_label(style, true);
  assert.equal(style.visibility, "hidden");
});

test("a boxless label shows again when a later reposition finds a box", () => {
  const style = fake_style();
  place_label(style, undefined);
  place_label(style, { left: 5, top: 6 });
  assert.equal(style.visibility, "");
  assert.equal(style.top, "6px");
});

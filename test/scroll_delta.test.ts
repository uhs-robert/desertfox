import assert from "node:assert/strict";
import { test } from "node:test";
import { scroll_delta } from "../src/content/caret/scroll_delta.ts";

test("scroll_delta is zero while the box is inside the view", () => {
  assert.equal(scroll_delta({ low: 20, high: 40 }, { low: 0, high: 100 }, 10), 0);
});

test("scroll_delta brings a box below or above the view back with a margin", () => {
  assert.equal(scroll_delta({ low: 95, high: 115 }, { low: 0, high: 100 }, 10), 25);
  assert.equal(scroll_delta({ low: -30, high: -10 }, { low: 0, high: 100 }, 10), -40);
});

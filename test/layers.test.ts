import assert from "node:assert/strict";
import { test } from "node:test";
import { LAYERS } from "../src/shared/layers.ts";

test("layers stack hints, mode badge, toast, which-key panel, command line from bottom to top", () => {
  const bottom_to_top = [LAYERS.hints, LAYERS.mode_badge, LAYERS.toast, LAYERS.which_key, LAYERS.command_line];
  for (let index = 1; index < bottom_to_top.length; index++) assert.ok(bottom_to_top[index]! > bottom_to_top[index - 1]!);
});

test("the command line keeps the browser maximum", () => {
  assert.equal(LAYERS.command_line, 2147483647);
  assert.equal(Math.max(...Object.values(LAYERS)), LAYERS.command_line);
});

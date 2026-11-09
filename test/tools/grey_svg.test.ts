import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// @ts-expect-error a plain module with no types
import { grey_svg } from "../../tools/grey_svg.mjs";

test("every fill becomes a grey and the shape stays", () => {
  const svg = readFileSync(new URL("../../src/icons/desertfox.svg", import.meta.url), "utf8");
  const grey: string = grey_svg(svg);
  const fills = [...grey.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((match) => match[1]!);
  assert.ok(fills.length >= 5);
  for (const fill of fills) assert.match(fill, /^#([0-9a-f]{2})\1\1$/);
  assert.equal(grey.replace(/fill="#[0-9a-f]{6}"/g, ""), svg.replace(/fill="#[0-9a-f]{6}"/g, ""));
});

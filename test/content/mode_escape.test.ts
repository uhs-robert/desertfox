import assert from "node:assert/strict";
import { test } from "node:test";
import { bundles } from "../../src/content/bundles.ts";
import { mode_escape } from "../../src/content/handlers/mode.ts";

Object.assign(globalThis, { document: { activeElement: null }, HTMLElement: class {} });

test("Escape with no hints bundle loaded asks nothing and does not throw", () => {
  assert.equal(bundles.has_handler("hint.unhover"), false);
  assert.doesNotThrow(() => mode_escape.run({}, {} as never));
});

test("Escape asks the loaded hints bundle to clear the hover", async () => {
  const cleared: string[] = [];
  bundles.api.register_handler("hint.unhover", () => void cleared.push("unhover"));
  mode_escape.run({}, {} as never);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(cleared, ["unhover"]);
});

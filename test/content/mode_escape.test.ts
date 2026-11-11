import assert from "node:assert/strict";
import { test } from "node:test";
import { bundles } from "../../src/content/bundles.ts";
import { mode_escape } from "../../src/content/handlers/mode.ts";

// `window.frameElement` is null in a top frame, which never hands its focus off.
Object.assign(globalThis, { document: { activeElement: null }, HTMLElement: class {}, window: { frameElement: null } });

test("Escape with no hints bundle loaded asks nothing and does not throw", () => {
  assert.equal(bundles.has_handler_("hint.unhover"), false);
  assert.doesNotThrow(() => mode_escape.run({}, false));
});

test("Escape asks the loaded hints bundle to clear the hover", async () => {
  const cleared: string[] = [];
  bundles.api.register_handler_("hint.unhover", () => void cleared.push("unhover"));
  mode_escape.run({}, false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(cleared, ["unhover"]);
});

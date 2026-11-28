// The `mode.normal_once` handler arms only a page that holds the focus. A Firefox shortcut fires it while the focus sits in the address bar, the sidebar or DevTools, and such a page hears no blur that would drop the arm.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mode_normal_once } from "../../src/content/handlers/mode.ts";
import { page_mode } from "../../src/content/page_mode.ts";

const with_focus = (focused: boolean) => Object.assign(globalThis, { document: { hasFocus: () => focused } });

test("a page without the focus does not arm", () => {
  with_focus(false);
  void mode_normal_once.run({}, false);
  assert.equal(page_mode.is_once_armed_(), false);
});

test("a page with the focus arms", () => {
  with_focus(true);
  void mode_normal_once.run({}, false);
  assert.equal(page_mode.is_once_armed_(), true);
  page_mode.take_once_();
});

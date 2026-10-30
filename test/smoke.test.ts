import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG_FORMAT_VERSION, DEFAULT_SETTINGS } from "../src/shared/index.ts";

test("shared contracts load and carry the agreed defaults", () => {
  assert.equal(CONFIG_FORMAT_VERSION, 1);
  assert.equal(DEFAULT_SETTINGS.which_key_delay_ms, 300);
});

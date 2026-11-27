import assert from "node:assert/strict";
import { test } from "node:test";
import { module_status_text } from "../src/help/settings_model.ts";

test("the settings page names each result of the module handshake", () => {
  assert.equal(module_status_text(undefined), "");
  assert.match(module_status_text({ result: "waiting" }), /No hello/);
  assert.match(module_status_text({ result: "matched", module_version: "0.3", module_v: 1 }), /version 0\.3.*connected/);
  assert.match(module_status_text({ result: "mismatch", module_version: "0.3", module_v: 2 }), /version 2.*stays idle/);
  assert.match(module_status_text({ result: "invalid", problem: "hello is too large" }), /hello is too large/);
});

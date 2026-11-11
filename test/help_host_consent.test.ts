import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { consent_to_auto_update } from "../src/help/grant_panel.ts";
import { DEFAULT_SETTINGS } from "../src/shared/config.ts";
import { registry } from "../src/shared/registry/builtin.ts";

test("the consent button saves host_auto_update on and says what happens next", async () => {
  const sent: unknown[] = [];
  const message = await consent_to_auto_update(async (request) => {
    sent.push(request);
    return { ok: true };
  });
  assert.deepEqual(sent, [{ type: "change_setting", name: "host_auto_update", action: "set", value: true }]);
  assert.match(message, /updates itself/);
});

test("a refused or failed consent save says so", async () => {
  assert.match(await consent_to_auto_update(async () => ({ ok: false, message: "no" })), /could not save.*no/);
  assert.match(await consent_to_auto_update(async () => Promise.reject(new Error("gone"))), /could not save.*gone/);
});

test("native.update is a registered background command, and consent is off by default", () => {
  assert.equal(registry.get("native.update")?.runs_in, "background");
  assert.equal(DEFAULT_SETTINGS.host_auto_update, false);
});

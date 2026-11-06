import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { ask_for_permission } from "../src/help/native_install.ts";
import { registry } from "../src/shared/registry/index.ts";

test("a granted request says what to do next", async () => {
  const outcome = await ask_for_permission({ has: async () => false, request: async () => true });
  assert.equal(outcome.granted, true);
  assert.match(outcome.message, /terminal/);
});

test("a denied request says so and how to retry, not nothing", async () => {
  const outcome = await ask_for_permission({ has: async () => false, request: async () => false });
  assert.equal(outcome.granted, false);
  assert.match(outcome.message, /did not grant/);
});

test("a request that throws, for example outside a click, shows Firefox's reason", async () => {
  const outcome = await ask_for_permission({
    has: async () => false,
    request: async () => Promise.reject(new Error("permissions.request may only be called from a user input handler")),
  });
  assert.equal(outcome.granted, false);
  assert.match(outcome.message, /user input handler/);
});

test("native.install is a registered background command", () => {
  assert.equal(registry.get("native.install")?.runs_in, "background");
});

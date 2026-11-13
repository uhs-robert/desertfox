import assert from "node:assert/strict";
import { test } from "node:test";
import { classify_host_start, files_digest } from "../../src/background/host_start.ts";

const reply = (files: Record<string, string>, config_dir_exists = true) => ({ config_dir: "/c", config_dir_exists, files });

test("a missing folder, an empty one and one with only autoconfig.toml are ignored, whatever the browser holds", async () => {
  for (const browser_files of [{}, { "settings.toml": "a" }]) {
    assert.deepEqual(await classify_host_start(reply({ "settings.toml": "b" }, false), browser_files, undefined), { kind: "ignore", reason: "missing" });
    assert.deepEqual(await classify_host_start(reply({}), browser_files, undefined), { kind: "ignore", reason: "empty" });
    assert.deepEqual(await classify_host_start(reply({ "autoconfig.toml": "x" }), browser_files, undefined), { kind: "ignore", reason: "empty" });
  }
});

test("an empty browser copy adopts the folder, and equal files ignore autoconfig.toml on both sides", async () => {
  assert.deepEqual(await classify_host_start(reply({ "settings.toml": "a" }), { "autoconfig.toml": "y" }, undefined), { kind: "adopt" });
  assert.deepEqual(await classify_host_start(reply({ "settings.toml": "a", "autoconfig.toml": "x" }), { "settings.toml": "a", "autoconfig.toml": "y" }, undefined), { kind: "ignore", reason: "same" });
});

test("differing files ask, with each file's change, and the kept folder digest does not ask again", async () => {
  const host = { "settings.toml": "new", "quickmarks.toml": "q", "autoconfig.toml": "x" };
  const browser_files = { "settings.toml": "old", "keymap.toml": "k" };
  const plan = await classify_host_start(reply(host), browser_files, undefined);
  assert.equal(plan.kind, "ask");
  if (plan.kind !== "ask") return;
  assert.deepEqual(plan.pending.changes, [
    { path: "keymap.toml", kind: "removed" },
    { path: "quickmarks.toml", kind: "added" },
    { path: "settings.toml", kind: "replaced" },
  ]);
  assert.equal(plan.pending.host_digest, await files_digest({ "quickmarks.toml": "q", "settings.toml": "new" }));
  assert.equal(plan.pending.browser_digest, await files_digest(browser_files));
  assert.deepEqual(await classify_host_start(reply(host), browser_files, plan.pending.host_digest), { kind: "ignore", reason: "kept" });
});

test("the digest ignores the order of the files and autoconfig.toml, and tells a path from its text", async () => {
  assert.equal(await files_digest({ a: "1", b: "2" }), await files_digest({ b: "2", a: "1", "autoconfig.toml": "z" }));
  assert.notEqual(await files_digest({ a: "1" }), await files_digest({ a: "2" }));
  assert.notEqual(await files_digest({ ab: "" }), await files_digest({ a: "b" }));
});

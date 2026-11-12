import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stamp_beta_manifest } from "../../tools/stamp_beta_manifest.ts";

const script = new URL("../../tools/stamp_beta_manifest.ts", import.meta.url).pathname;
const UPDATE_URL = "https://github.com/uhs-robert/desertfox/releases/download/beta-channel/updates.json";
const manifest = { name: "DesertFox", version: "0.1.22", browser_specific_settings: { gecko: { id: "desertfox@uhs-robert", strict_min_version: "140.0" } } };

test("stamps the version and update_url and keeps the other fields", () => {
  const stamped = stamp_beta_manifest(manifest, "0.1.23.1", UPDATE_URL) as typeof manifest;
  assert.equal(stamped.version, "0.1.23.1");
  assert.equal(stamped.name, "DesertFox");
  assert.deepEqual(stamped.browser_specific_settings.gecko, { ...manifest.browser_specific_settings.gecko, update_url: UPDATE_URL });
  assert.equal(manifest.version, "0.1.22");
});

test("refuses a stable version, a bad version and a non-https update_url", () => {
  assert.throws(() => stamp_beta_manifest(manifest, "0.1.23", UPDATE_URL), /not x\.y\.z\.N/);
  assert.throws(() => stamp_beta_manifest(manifest, "0.1.23-beta.1", UPDATE_URL), /not x\.y\.z\.N/);
  assert.throws(() => stamp_beta_manifest(manifest, "0.1.23.1", "http://example.invalid/u.json"), /https/);
  assert.throws(() => stamp_beta_manifest(manifest, "0.1.23.1", "https://"), /https/);
  assert.throws(() => stamp_beta_manifest(manifest, "0.1.23.1", "not a url"), /https/);
  assert.throws(() => stamp_beta_manifest({ version: "0.1.22" }, "0.1.23.1", UPDATE_URL), /gecko/);
});

test("the command rewrites only the manifest it is given and exits 1 on a bad version", () => {
  const dir = mkdtempSync(join(tmpdir(), "stamp-beta-"));
  const file = join(dir, "manifest.json");
  writeFileSync(file, JSON.stringify(manifest));
  const ok = spawnSync("node", [script, "--version", "0.1.23.4", "--update-url", UPDATE_URL, "--manifest", file], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const written = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(written.version, "0.1.23.4");
  assert.equal(written.browser_specific_settings.gecko.update_url, UPDATE_URL);
  const bad = spawnSync("node", [script, "--version", "0.1.23", "--update-url", UPDATE_URL, "--manifest", file], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).version, "0.1.23.4");
});

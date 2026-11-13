import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build_updates } from "../../tools/write_updates_json.ts";
import { make_tmp_dir } from "../support/tmp_dir.ts";

const script = new URL("../../tools/write_updates_json.ts", import.meta.url).pathname;
const REPO = "uhs-robert/desertfox";
const manifest = { version: "0.1.23.2", browser_specific_settings: { gecko: { id: "desertfox@uhs-robert", strict_min_version: "153.0" } } };
const xpi_bytes = Buffer.from("signed xpi bytes");
const input = { tag: "v0.1.23.2", xpi_name: "desertfox-0.1.23.2.xpi", xpi_bytes, manifest, repo: REPO };

test("updates.json has Firefox's update manifest shape with one entry", () => {
  const updates = build_updates(input);
  assert.deepEqual(Object.keys(updates), ["addons"]);
  assert.deepEqual(Object.keys(updates.addons), ["desertfox@uhs-robert"]);
  const entries = updates.addons["desertfox@uhs-robert"]!.updates;
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    version: "0.1.23.2",
    update_link: `https://github.com/${REPO}/releases/download/v0.1.23.2/desertfox-0.1.23.2.xpi`,
    update_hash: `sha256:${createHash("sha256").update(xpi_bytes).digest("hex")}`,
    applications: { gecko: { strict_min_version: "153.0" } },
  });
  assert.match(entries[0]!.update_hash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(entries[0]!.update_link.startsWith("https://"));
});

test("a tag, xpi name or manifest that names another version is refused", () => {
  assert.throws(() => build_updates({ ...input, tag: "v0.1.23.3" }), /xpi .* does not match tag/);
  assert.throws(() => build_updates({ ...input, xpi_name: "desertfox-0.1.23.3.xpi" }), /does not match tag/);
  assert.throws(() => build_updates({ ...input, manifest: { ...manifest, version: "0.1.23.3" } }), /manifest version/);
});

test("a stable version or a bad tag is not a beta", () => {
  for (const tag of ["v0.1.23", "v0.1.23-beta.1", "beta-channel", "v0.1.23.0", "0.1.23.2"]) {
    assert.throws(() => build_updates({ ...input, tag }), /not v<x.y.z.N>/, tag);
  }
});

test("a manifest without a gecko minimum version is refused", () => {
  assert.throws(() => build_updates({ ...input, manifest: { version: "0.1.23.2" } }), /strict_min_version/);
});

test("the command writes the file and exits 1 on a mismatch", (t) => {
  const dir = make_tmp_dir("desertfox-updates-", t);
  const xpi = join(dir, "desertfox-0.1.23.2.xpi");
  const manifest_path = join(dir, "manifest.json");
  const out = join(dir, "updates.json");
  writeFileSync(xpi, xpi_bytes);
  writeFileSync(manifest_path, JSON.stringify(manifest));
  const run = (tag: string) => spawnSync(process.execPath, ["--no-warnings", script, "--tag", tag, "--xpi", xpi, "--manifest", manifest_path, "--repo", REPO, "--out", out], { encoding: "utf8" });
  assert.equal(run("v0.1.23.2").status, 0);
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), build_updates(input));
  const bad = run("v0.1.23.3");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /does not match/);
});

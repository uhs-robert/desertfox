import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { host_channel, install_command } from "../src/shared/native_host.ts";

test("a development install follows main and every other install follows its own version", () => {
  assert.equal(host_channel("development", "0.1.5"), "main");
  for (const install_type of ["normal", "admin", "sideload", "other"]) assert.equal(host_channel(install_type, "0.1.5"), "0.1.5");
});

test("the install command takes the script and the channel from the same place", () => {
  assert.equal(install_command("main"), "curl -fsSL https://raw.githubusercontent.com/uhs-robert/desertfox/main/host/install.sh | sh -s -- main");
  assert.equal(
    install_command("0.1.5"),
    "curl -fsSL https://github.com/uhs-robert/desertfox/releases/download/v0.1.5/install.sh | sh -s -- 0.1.5",
  );
});

test("nativeMessaging, browsingData and cookies are optional, never required", () => {
  const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.optional_permissions, ["nativeMessaging", "browsingData", "cookies"]);
  for (const permission of manifest.optional_permissions) assert.ok(!manifest.permissions.includes(permission), permission);
});

test("every grant changes the hash, and the panel route accepts each form", async () => {
  const { grant_hash, permission_of_grant_hash } = await import("../src/shared/permission_grant.ts");
  assert.notEqual(grant_hash("browsingData", 1), grant_hash("browsingData", 2));
  assert.equal(permission_of_grant_hash(grant_hash("nativeMessaging", 5)), "nativeMessaging");
  assert.equal(permission_of_grant_hash("#grant/browsingData"), "browsingData");
  for (const hash of ["", "#/", "#grant/", "#grant/history", "#granted/browsingData", "#native-install"]) assert.equal(permission_of_grant_hash(hash), undefined, hash);
});

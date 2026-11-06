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

test("nativeMessaging is optional, never required", () => {
  const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.optional_permissions, ["nativeMessaging"]);
  assert.ok(!manifest.permissions.includes("nativeMessaging"));
});

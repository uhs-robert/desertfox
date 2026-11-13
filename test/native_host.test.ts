import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { install_step } from "../src/help/grant_panel.ts";
import { host_channel, install_hashes_of, main_install_command, release_install_command } from "../src/shared/native_host.ts";

const HASHES = { install_sh: "a".repeat(64), sha256: { "desertfox-host": "b".repeat(64), "desertfox-bridge": "c".repeat(64), desertfox: "d".repeat(64) } };

test("a development install follows main and every other install follows its own version", () => {
  assert.equal(host_channel("development", "0.1.5"), "main");
  for (const install_type of ["normal", "admin", "sideload", "other"]) assert.equal(host_channel(install_type, "0.1.5"), "0.1.5");
});

test("the main command pipes the main branch script with no checksum", () => {
  assert.equal(main_install_command(), "curl -fsSL https://raw.githubusercontent.com/uhs-robert/desertfox/main/host/install.sh | sh -s -- main");
});

test("the release command checks install.sh before it runs it and passes each host hash", () => {
  assert.equal(
    release_install_command("0.1.5", HASHES),
    "sh -c 'f=$(mktemp) || exit 1; clean() { rm -f -- \"$f\"; }; trap clean EXIT HUP INT TERM; " +
      `curl -fsSL https://github.com/uhs-robert/desertfox/releases/download/v0.1.5/install.sh -o "$f" && echo "${"a".repeat(64)}  $f" | sha256sum -c && ` +
      `sh "$f" 0.1.5 --sha256 desertfox-host=${"b".repeat(64)} --sha256 desertfox-bridge=${"c".repeat(64)} --sha256 desertfox=${"d".repeat(64)}'`,
  );
});

test("the release command body survives single quotes in bash, zsh and fish", () => {
  const body = release_install_command("0.1.5.3", HASHES).slice("sh -c '".length, -1);
  assert.ok(!body.includes("'") && !body.includes("\\"), body);
  assert.ok(!release_install_command("0.1.5", HASHES).includes("\n"));
});

test("only a file stamped for this version with four well-formed hashes counts", () => {
  const stamped = { version: "0.1.5", ...HASHES };
  assert.deepEqual(install_hashes_of(stamped, "0.1.5"), HASHES);
  assert.deepEqual(install_hashes_of({ ...stamped, version: "0.1.5.2" }, "0.1.5.2"), HASHES);
  const refused: [unknown, string][] = [
    [undefined, "0.1.5"],
    [stamped, "0.1.6"],
    [{ ...stamped, version: "0.1.5; rm" }, "0.1.5; rm"],
    [{ version: "0.1.5", sha256: HASHES.sha256 }, "0.1.5"],
    [{ ...stamped, install_sh: "A".repeat(64) }, "0.1.5"],
    [{ ...stamped, sha256: { ...HASHES.sha256, desertfox: "d".repeat(63) } }, "0.1.5"],
    [{ ...stamped, sha256: { "desertfox-host": "b".repeat(64), "desertfox-bridge": "c".repeat(64) } }, "0.1.5"],
    [{ ...stamped, sha256: { ...HASHES.sha256, extra: "e".repeat(64) } }, "0.1.5"],
  ];
  for (const [value, version] of refused) assert.equal(install_hashes_of(value, version), undefined, JSON.stringify(value));
});

test("the panel shows the checked command only for a release build with the signed hashes", () => {
  const release = install_step("0.1.5", HASHES);
  assert.equal(release.checked, true);
  assert.equal(release.command, release_install_command("0.1.5", HASHES));
  assert.doesNotMatch(release.text, /Warning/);
  for (const [channel, hashes, reason] of [["main", HASHES, /development install/], ["0.1.5", undefined, /no host hashes/]] as const) {
    const step = install_step(channel, hashes);
    assert.equal(step.checked, false);
    assert.equal(step.command, main_install_command());
    assert.match(step.text, /Warning: .*no checksum/);
    assert.match(step.text, reason);
  }
});

test("nativeMessaging and browsingData are optional, cookies stays required", () => {
  const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.optional_permissions, ["nativeMessaging", "browsingData"]);
  // cookies backs the cookieStoreId option of tabs.create, windows.create and downloads.download, so it cannot be optional.
  assert.ok(manifest.permissions.includes("cookies"));
  for (const permission of manifest.optional_permissions) assert.ok(!manifest.permissions.includes(permission), permission);
});

test("every grant changes the hash, and the panel route accepts each form", async () => {
  const { grant_hash, permission_of_grant_hash } = await import("../src/shared/permission_grant.ts");
  assert.notEqual(grant_hash("browsingData", 1), grant_hash("browsingData", 2));
  assert.equal(permission_of_grant_hash(grant_hash("nativeMessaging", 5)), "nativeMessaging");
  assert.equal(permission_of_grant_hash("#grant/browsingData"), "browsingData");
  for (const hash of ["", "#/", "#grant/", "#grant/history", "#granted/browsingData", "#native-install"]) assert.equal(permission_of_grant_hash(hash), undefined, hash);
});

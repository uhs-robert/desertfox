// Copies the hosts, the command line and install.sh into the release assets folder and writes the given version into both hosts as release_version. Then hashes the stamped files: a .sha256 per script for the GitHub release, and host_sha256.json, which the extension build copies into dist/ so the signed build carries the hashes. Stamping comes first, so the hashes match the shipped bytes.
// Usage: node tools/release_stamp.mjs <version>. RELEASE_ASSETS_DIR replaces the folder (default release-assets).
// Node only, so a reviewer who rebuilds from the source archive needs no other tool. `just release_stamp` runs it.

import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The same pattern as VERSION_PATTERN in host/desertfox-host, which refuses to update to any other version.
const VERSION_PATTERN = /^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(\.[1-9][0-9]{0,5})?$/;
const STAMPED_HOSTS = ["desertfox-host", "desertfox-bridge"];
const HASHED_SCRIPTS = [...STAMPED_HOSTS, "desertfox"];

const fail = (message) => {
  console.error(`release_stamp: ${message}`);
  process.exit(1);
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const version = process.argv[2] ?? "";
if (!VERSION_PATTERN.test(version)) fail(`'${version}' is not x.y.z or x.y.z.N, so no host could update to it.`);
const assets_dir = process.env.RELEASE_ASSETS_DIR || "release-assets";
mkdirSync(assets_dir, { recursive: true });

for (const name of [...HASHED_SCRIPTS, "install.sh"]) {
  const target = join(assets_dir, name);
  copyFileSync(join("host", name), target);
  chmodSync(target, statSync(join("host", name)).mode & 0o777);
}
for (const name of STAMPED_HOSTS) {
  const target = join(assets_dir, name);
  const lines = readFileSync(target, "utf8").split("\n");
  if (lines.filter((line) => line === 'RELEASE_VERSION = "dev"').length !== 1) fail(`host/${name} must hold the line RELEASE_VERSION = "dev" exactly once.`);
  writeFileSync(target, lines.map((line) => (line === 'RELEASE_VERSION = "dev"' ? `RELEASE_VERSION = "${version}"` : line)).join("\n"));
}
for (const name of HASHED_SCRIPTS) writeFileSync(join(assets_dir, `${name}.sha256`), `${sha256(join(assets_dir, name))}  ${name}\n`);
// install_sh sits beside sha256, not in it: self_update refuses a sha256 that names anything but the three scripts.
const hashes = { version, sha256: Object.fromEntries(HASHED_SCRIPTS.map((name) => [name, sha256(join(assets_dir, name))])), install_sh: sha256(join(assets_dir, "install.sh")) };
writeFileSync(join(assets_dir, "host_sha256.json"), `${JSON.stringify(hashes, null, 2)}\n`);
console.log(`stamped the hosts as ${version} in ${assets_dir}`);

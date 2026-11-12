// Stamps a beta version and its update_url into a manifest, in place. The beta build runs this in its workspace, so package.json keeps the last stable version.
// Usage: node tools/stamp_beta_manifest.ts --version 0.1.23.1 --update-url https://example.invalid/updates.json [--manifest src/manifest.json]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse_release_version } from "../src/shared/host_version.ts";

type Manifest = { version?: unknown; browser_specific_settings?: { gecko?: Record<string, unknown> } };

function is_https_url(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname !== "";
  } catch {
    return false;
  }
}

// Throws on a version that is not a beta (x.y.z.N) or an update_url that is not https, because Firefox ignores an update_url it cannot trust.
export function stamp_beta_manifest(manifest: Manifest, version: string, update_url: string): Manifest {
  if (parse_release_version(version)?.beta === undefined) throw new Error(`version ${version} is not x.y.z.N, a beta version`);
  if (!is_https_url(update_url)) throw new Error(`update_url ${update_url} is not an https URL with a host`);
  const gecko = manifest.browser_specific_settings?.gecko;
  if (gecko === undefined) throw new Error("manifest has no browser_specific_settings.gecko");
  return { ...manifest, version, browser_specific_settings: { ...manifest.browser_specific_settings, gecko: { ...gecko, update_url } } };
}

function main(argv: string[]) {
  const option = (name: string, fallback?: string) => {
    const at = argv.indexOf(`--${name}`);
    const value = at >= 0 ? argv[at + 1] : fallback;
    if (value === undefined) {
      console.error("usage: node tools/stamp_beta_manifest.ts --version <x.y.z.N> --update-url <https url> [--manifest <file>]");
      process.exit(2);
    }
    return value;
  };
  const manifest_path = option("manifest", "src/manifest.json");
  const stamped = stamp_beta_manifest(JSON.parse(readFileSync(manifest_path, "utf8")), option("version"), option("update-url"));
  writeFileSync(manifest_path, `${JSON.stringify(stamped, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

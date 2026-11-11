// Writes updates.json for the beta channel: the update manifest Firefox reads through the beta build's `update_url`.
// One entry, the latest beta. Firefox installs the highest listed version newer than the installed one, so older betas need no entry.
// Usage: node tools/write_updates_json.ts --tag v0.1.23.1 --xpi desertfox-0.1.23.1.xpi --manifest dist/manifest.json --repo owner/name --out updates.json

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse_release_version } from "../src/shared/host_version.ts";

export type UpdatesInput = { tag: string; xpi_name: string; xpi_bytes: Uint8Array; manifest: unknown; repo: string };

const ADDON_NAME = "desertfox";

// Throws when the tag, the xpi name and the manifest do not name the same beta, because Firefox would then fetch a file that is not the one it was told about.
export function build_updates(input: UpdatesInput) {
  const { tag, xpi_name, xpi_bytes, manifest, repo } = input;
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  if (parse_release_version(version)?.beta === undefined) throw new Error(`tag ${tag} is not v<x.y.z.N>, a beta version`);
  if (xpi_name !== `${ADDON_NAME}-${version}.xpi`) throw new Error(`xpi ${xpi_name} does not match tag ${tag}`);
  const parsed = (manifest as { version?: unknown; browser_specific_settings?: { gecko?: { id?: unknown; strict_min_version?: unknown } } }) ?? {};
  if (parsed.version !== version) throw new Error(`manifest version ${String(parsed.version)} does not match tag ${tag}`);
  const { id, strict_min_version } = parsed.browser_specific_settings?.gecko ?? {};
  if (typeof id !== "string" || typeof strict_min_version !== "string") throw new Error("manifest has no gecko id or strict_min_version");
  const update_link = `https://github.com/${repo}/releases/download/${tag}/${xpi_name}`;
  const update_hash = `sha256:${createHash("sha256").update(xpi_bytes).digest("hex")}`;
  return { addons: { [id]: { updates: [{ version, update_link, update_hash, applications: { gecko: { strict_min_version } } }] } } };
}

function main(argv: string[]) {
  const option = (name: string) => {
    const at = argv.indexOf(`--${name}`);
    const value = at >= 0 ? argv[at + 1] : undefined;
    if (value === undefined) {
      console.error("usage: node tools/write_updates_json.ts --tag v<x.y.z.N> --xpi <file> --manifest <manifest.json> --repo <owner/name> --out <file>");
      process.exit(2);
    }
    return value;
  };
  const xpi = option("xpi");
  const updates = build_updates({
    tag: option("tag"),
    xpi_name: basename(xpi),
    xpi_bytes: readFileSync(xpi),
    manifest: JSON.parse(readFileSync(option("manifest"), "utf8")),
    repo: option("repo"),
  });
  writeFileSync(option("out"), `${JSON.stringify(updates, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

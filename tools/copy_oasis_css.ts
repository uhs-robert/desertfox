// Copies the Oasis theme CSS files from an oasis.nvim checkout into themes/oasis/, byte for byte.
// Usage: node tools/copy_oasis_css.ts <oasis.nvim dir> [--out <dir>]
// The public repo needs no oasis.nvim at build time: `just themes` reads the copies.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { LIGHT_INTENSITIES } from "../src/shared/theme/roles.ts";

const args = process.argv.slice(2);
const out_flag = args.indexOf("--out");
const out_override = out_flag >= 0 ? args.splice(out_flag, 2)[1] : undefined;
const source_dir = args[0];
if (!source_dir || args.length !== 1 || (out_flag >= 0 && !out_override)) {
  console.error("usage: node tools/copy_oasis_css.ts <oasis.nvim dir> [--out <dir>]");
  process.exit(2);
}

const themes_root = join(source_dir, "extras", "css", "themes");
const source_folders = ["dark", ...LIGHT_INTENSITIES.map((intensity) => join("light", String(intensity)))];
const out_dir = out_override ?? fileURLToPath(new URL("../themes/oasis/", import.meta.url));

const sources: string[] = [];
for (const folder of source_folders) {
  const dir = join(themes_root, folder);
  if (!existsSync(dir)) {
    console.error(`${dir}: not found. Pass the oasis.nvim checkout directory.`);
    process.exit(1);
  }
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".css")).sort()) sources.push(join(dir, name));
}

// 16 themes, each one dark file and one file per light intensity. A short count means a wrong checkout.
const EXPECTED_FILES = 16 * (1 + LIGHT_INTENSITIES.length);
if (sources.length !== EXPECTED_FILES) {
  console.error(`found ${sources.length} CSS files under ${themes_root}, expected ${EXPECTED_FILES}. Nothing was copied.`);
  process.exit(1);
}

mkdirSync(out_dir, { recursive: true });
const copied = new Set(sources.map((path) => path.slice(path.lastIndexOf("/") + 1)));
// A theme that upstream dropped must not stay behind and keep building into themes.ts.
for (const name of readdirSync(out_dir).filter((entry) => entry.endsWith(".css") && !copied.has(entry))) rmSync(join(out_dir, name));
for (const path of sources) copyFileSync(path, join(out_dir, path.slice(path.lastIndexOf("/") + 1)));
console.log(`copied ${sources.length} files into ${out_dir}`);

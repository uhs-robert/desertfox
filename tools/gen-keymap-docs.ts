// Regenerates the block between the markers of docs/keymap.md from the default keymap, and of docs/site_rows.md from the default site rows.
// Usage: node tools/gen-keymap-docs.ts --write | --check [--doc path]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../src/shared/keys/default_keymap.ts";
import { DEFAULT_SITE_ROWS } from "../src/background/default_site_rows.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { render } from "./keymap_docs/render.ts";
import { render_site_rows } from "./keymap_docs/render_site_rows.ts";
import { splice } from "./keymap_docs/splice.ts";

const root = new URL("../", import.meta.url);
const args = process.argv.slice(2);
const doc_flag = args.indexOf("--doc");
const doc_path = doc_flag >= 0 ? args[doc_flag + 1]! : fileURLToPath(new URL("docs/keymap.md", root));
const write = args.includes("--write");
const check = args.includes("--check");
if (write === check) {
  console.error("usage: node tools/gen-keymap-docs.ts --write | --check [--doc path]");
  process.exit(2);
}

const docs = [
  { path: doc_path, block: render(DEFAULT_KEYMAP, registry), what: "keymap tables" },
  // --doc points at a copy of keymap.md, so a run with it leaves the site rows doc alone.
  ...(doc_flag >= 0 ? [] : [{ path: fileURLToPath(new URL("docs/site_rows.md", root)), block: render_site_rows(DEFAULT_SITE_ROWS, DEFAULT_KEYMAP, registry), what: "site row tables" }]),
];

let stale = false;
for (const { path, block, what } of docs) {
  const current = readFileSync(path, "utf8");
  const next = splice(current, block);
  if (next === current) continue;
  if (write) {
    writeFileSync(path, next);
    continue;
  }
  const current_lines = current.split("\n");
  const first_diff = next.split("\n").findIndex((line, at) => line !== current_lines[at]);
  console.error(`the generated ${what} are stale (first difference at line ${first_diff + 1}); run \`just docs-gen\``);
  stale = true;
}
if (stale) process.exit(1);

// Regenerates the block between the markers of docs/keymap.md from the default keymap.
// Usage: node tools/gen-keymap-docs.ts --write | --check [--doc path]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { registry } from "../src/shared/registry/index.ts";
import { read_planned } from "./keymap_docs/planned.ts";
import { render } from "./keymap_docs/render.ts";
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

const planned = read_planned(readFileSync(new URL("docs/keymap_planned.toml", root), "utf8"), DEFAULT_KEYMAP);
const current = readFileSync(doc_path, "utf8");
const next = splice(current, render(DEFAULT_KEYMAP, registry, planned));

if (next === current) process.exit(0);
if (write) {
  writeFileSync(doc_path, next);
} else {
  const current_lines = current.split("\n");
  const first_diff = next.split("\n").findIndex((line, at) => line !== current_lines[at]);
  console.error(`the generated keymap tables are stale (first difference at line ${first_diff + 1}); run \`just docs-gen\``);
  process.exit(1);
}

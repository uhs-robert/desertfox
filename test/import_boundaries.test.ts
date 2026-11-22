import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { test } from "node:test";
import { EXCEPTIONS } from "./import_boundaries.ts";

const PAGE_FOLDERS = ["help", "newtab", "popup", "devtools", "cmdline"];
const ALLOWED_FOLDERS: Record<string, string[]> = {
  shared: ["shared"],
  content: ["content", "shared"],
  commands: ["commands", "background", "shared"],
  background: ["background", "shared"],
  ...Object.fromEntries(PAGE_FOLDERS.map((folder) => [folder, [folder, "shared"]])),
};
// Files that may import another folder besides the ones above: the wiring that builds the background, and the cmdline bundle that is a content script.
const EXTRA_FOLDER: Record<string, string> = {
  "background/command_modules.ts": "commands",
  "background/main.ts": "commands",
  "cmdline/host.ts": "content",
};

const root = new URL("../", import.meta.url);
const sources = readdirSync(new URL("src", root), { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".ts") && !path.endsWith(".d.ts"))
  .sort();

// Type-only imports are kept: `import type` and `export type ... from` match like the others. Comment lines are dropped so an example in a comment is no edge.
const IMPORT = /(?:\b(?:import|export)\s[^;"']*?\bfrom\s*|\bimport\s*\(?\s*)["'](\.[^"']*)["']/g;
const code_of = (path: string) =>
  readFileSync(new URL(`src/${path}`, root), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

const edges = new Set<string>();
for (const file of sources) {
  for (const match of code_of(file).matchAll(IMPORT)) {
    edges.add(`${file} -> ${posix.normalize(posix.join(dirname(file), match[1]!))}`);
  }
}

const folder_of = (path: string) => path.split("/")[0]!;
const is_allowed = (from: string, to: string) =>
  folder_of(from) === folder_of(to) || ALLOWED_FOLDERS[folder_of(from)]?.includes(folder_of(to)) === true || EXTRA_FOLDER[from] === folder_of(to);
const forbidden = [...edges].filter((edge) => {
  const [from, to] = edge.split(" -> ") as [string, string];
  return !is_allowed(from, to);
});

test("every import between src folders follows the one-way rule or is a listed exception", () => {
  const unlisted = forbidden.filter((edge) => !(edge in EXCEPTIONS));
  assert.deepEqual(
    unlisted,
    [],
    `These imports break the folder rule in AGENTS.md. Move the shared code into src/shared instead of adding an exception:\n${unlisted.join("\n")}`,
  );
});

test("every listed exception is still a forbidden import", () => {
  const stale = Object.keys(EXCEPTIONS).filter((edge) => !forbidden.includes(edge));
  assert.deepEqual(stale, [], `These exceptions no longer match an import. Remove them from test/import_boundaries.ts:\n${stale.join("\n")}`);
});

test("every exception names the cluster that removes it", () => {
  const unnamed = Object.entries(EXCEPTIONS).filter(([, cluster]) => !/^C([1-9]|10)$/.test(cluster));
  assert.deepEqual(unnamed, []);
});

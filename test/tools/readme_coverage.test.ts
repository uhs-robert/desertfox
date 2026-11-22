import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

const SOURCE_FILE = /\.(ts|css|html)$/;
const DECLARATION_FILE = /\.d\.ts$/;

// A folder without its own README is described by the nearest README above it.
function readme_of(folder: string): string {
  for (let current = folder; current !== "."; current = dirname(current)) {
    const path = join(current, "README.md");
    if (existsSync(path)) return path;
  }
  throw new Error(`no README above ${folder}`);
}

// A README names a file as `name.ts`, or as `name` where it lists modules without the extension.
function is_named(readme_text: string, file: string): boolean {
  return readme_text.includes(`\`${file}\``) || readme_text.includes(`\`${file.replace(/\.ts$/, "")}\``);
}

test("every source file has an entry in its folder README", () => {
  const problems: string[] = [];
  for (const entry of readdirSync("src", { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !SOURCE_FILE.test(entry.name) || DECLARATION_FILE.test(entry.name)) continue;
    const readme = readme_of(entry.parentPath);
    if (!is_named(readFileSync(readme, "utf8"), entry.name)) problems.push(`${join(entry.parentPath, entry.name)}: add a line "- \`${entry.name}\`: what it does" to ${readme}`);
  }
  assert.equal(problems.length, 0, `\n${problems.length} source file(s) have no README entry:\n${problems.sort().join("\n")}\n`);
});

const ENTRY_CAP = 200;
const OVER_CAP_FILE = "test/tools/readme_over_cap.json";

function all_readmes(): string[] {
  return readdirSync("src", { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === "README.md")
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

// An entry is a list line that starts with backticked names: "- `file.ts`, `other.ts`: what it owns". Its key is those names. A line whose names are not followed by a colon (a note about a file elsewhere) is an entry for the cap but names no file here.
function entries_of(readme: string): { key: string; names: string[]; length: number }[] {
  const found: { key: string; names: string[]; length: number }[] = [];
  for (const line of readFileSync(readme, "utf8").split("\n")) {
    const match = /^- ((?:`[^`]+`(?:, | and | or )?)+)(:?)/.exec(line);
    if (!match) continue;
    const key = match[1] ?? "";
    found.push({ key, names: match[2] ? [...key.matchAll(/`([^`]+)`/g)].map((name) => name[1] ?? "") : [], length: line.length });
  }
  return found;
}

// A name that points at a file or folder under the README's folder: has an extension or ends in a slash.
const PATH_NAME = /^[\w./-]+(\.(ts|css|html|md|json|py|sh|mjs)|\/)$/;

test("no README entry names a file or folder that is gone", () => {
  const problems: string[] = [];
  for (const readme of all_readmes()) {
    for (const entry of entries_of(readme)) {
      for (const name of entry.names.filter((candidate) => PATH_NAME.test(candidate))) {
        if (!existsSync(join(dirname(readme), name))) problems.push(`${readme}: entry ${entry.key} names ${name}, which does not exist`);
      }
    }
  }
  assert.equal(problems.length, 0, `\n${problems.length} stale README entr(ies):\n${problems.join("\n")}\n`);
});

test(`README entries stay within ${ENTRY_CAP} characters, except the shrinking allow list`, () => {
  const allowed = new Set<string>((JSON.parse(readFileSync(OVER_CAP_FILE, "utf8")) as string[]));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const readme of all_readmes()) {
    for (const entry of entries_of(readme)) {
      const id = `${readme} ${entry.key}`;
      if (entry.length > ENTRY_CAP) {
        seen.add(id);
        if (!allowed.has(id)) problems.push(`${id}: ${entry.length} characters, cap ${ENTRY_CAP}. Move behavior to docs/design/ or a code comment`);
      }
    }
  }
  for (const id of allowed) {
    if (!seen.has(id)) problems.push(`${id}: no longer over the cap or gone, remove it from ${OVER_CAP_FILE}`);
  }
  assert.equal(problems.length, 0, `\n${problems.length} README entry problem(s):\n${problems.join("\n")}\n`);
});

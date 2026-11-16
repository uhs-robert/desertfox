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

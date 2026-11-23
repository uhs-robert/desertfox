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

// A README is a code map: no line over LINE_CAP characters (headings, prose, list items and indented lines alike). Only READMEs under src are checked. READMEs elsewhere (host, tools, docs) are out of scope on purpose.
const LINE_CAP = 200;

function all_readmes(): string[] {
  return readdirSync("src", { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === "README.md")
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function lines_over_cap(readme: string): string[] {
  return readFileSync(readme, "utf8")
    .split("\n")
    .filter((line) => line.length > LINE_CAP);
}

// An entry is a list line, indented or not, that starts with backticked names: "- `file.ts`, `other.ts`: what it owns". A name followed by " (in" points at a file elsewhere and is skipped. A bare name (no extension) counts only in a colon entry, since a colon-free line may start with a command or handler id.
function entry_names(readme: string): { head: string; names: string[]; has_colon: boolean }[] {
  const found: { head: string; names: string[]; has_colon: boolean }[] = [];
  for (const line of readFileSync(readme, "utf8").split("\n")) {
    const match = /^\s*- ((?:`[^`]+`(?:, | and | or )?)+)(?! \(in )(:?)/.exec(line);
    if (!match) continue;
    const head = match[1] ?? "";
    found.push({ head, names: [...head.matchAll(/`([^`]+)`/g)].map((name) => name[1] ?? ""), has_colon: match[2] === ":" });
  }
  return found;
}

// A name with an extension or a trailing slash is a path. A bare name is a module listed without its extension.
const PATH_NAME = /^[\w./-]+(\.(ts|css|html|md|json|py|sh|mjs)|\/)$/;
const BARE_NAME = /^[\w-]+$/;

// A path with a folder in it may be written from src, like `content/main.ts`.
const src_paths = readdirSync("src", { recursive: true }).map((path) => `/${String(path)}`);

// A colon-free entry is a note that may point at a file in another folder ("`a.ts` lives in `shared/config/`"), so any file or folder under src satisfies it.
function exists_for(folder: string, name: string, has_colon: boolean): boolean {
  if (!has_colon) {
    const tail = `/${name.replace(/^(\.\.?\/)+/, "").replace(/\/$/, "")}`;
    return src_paths.some((path) => path.endsWith(tail) || path.endsWith(`${tail}.ts`));
  }
  if (PATH_NAME.test(name)) return existsSync(join(folder, name)) || (name.includes("/") && existsSync(join("src", name)));
  return [name, `${name}.ts`, `${name}.css`, `${name}.html`].some((candidate) => existsSync(join(folder, candidate)));
}

test("no README entry names a file or folder that is gone", () => {
  const problems: string[] = [];
  for (const readme of all_readmes()) {
    for (const entry of entry_names(readme)) {
      for (const name of entry.names.filter((candidate) => PATH_NAME.test(candidate) || (entry.has_colon && BARE_NAME.test(candidate)))) {
        if (!exists_for(dirname(readme), name, entry.has_colon)) problems.push(`${readme}: entry ${entry.head} names ${name}, which does not exist`);
      }
    }
  }
  assert.equal(problems.length, 0, `\n${problems.length} stale README entr(ies):\n${problems.join("\n")}\n`);
});

test(`no README has a line over ${LINE_CAP} characters`, () => {
  const problems: string[] = [];
  for (const readme of all_readmes()) {
    const long_lines = lines_over_cap(readme);
    if (long_lines.length > 0) problems.push(`${readme}: ${long_lines.length} line(s) over ${LINE_CAP} characters, for example "${(long_lines[0] ?? "").slice(0, 60)}...". Move behavior to docs/design/ or a code comment`);
  }
  assert.equal(problems.length, 0, `\n${problems.length} README size problem(s):\n${problems.join("\n")}\n`);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { test } from "node:test";

const DESIGN_MAP = "docs/design.md";
const DESIGN_AREAS = "docs/design";

const markdown_files = execFileSync("git", ["ls-files", "*.md"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(
    (file) =>
      file &&
      existsSync(file) &&
      !file.startsWith(".logs/") &&
      !file.startsWith(".plans/"),
  );

// A capture group the pattern always fills.
function group(match: RegExpMatchArray, index: number): string {
  return match[index] ?? "";
}

function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]/g, "")
    .replaceAll(" ", "-");
}

// Heading lines outside code fences, as their text. A design.md stub (a heading whose body is "Moved to ...") is left out when asked, because its title repeats the area file's.
function heading_texts(file: string, skip_stubs = false): string[] {
  const texts: string[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  let in_fence = false;
  lines.forEach((line, index) => {
    if (line.startsWith("```")) in_fence = !in_fence;
    const match = in_fence ? null : /^#{1,6} (.*)/.exec(line);
    if (match && !(skip_stubs && lines[index + 2]?.startsWith("Moved to ")))
      texts.push(group(match, 1));
  });
  return texts;
}

const heading_cache = new Map<
  string,
  { texts: Set<string>; slugs: Set<string> }
>();
function headings_of(file: string) {
  let cached = heading_cache.get(file);
  if (!cached) {
    const texts = heading_texts(file);
    // A quote may leave off a trailing "(note)" of the heading, and a hand-written anchor tag names an anchor too.
    const anchor_tags = [
      ...readFileSync(file, "utf8").matchAll(/<a id="([^"]+)"><\/a>/g),
    ].map((match) => group(match, 1));
    cached = {
      texts: new Set(
        texts
          .flatMap((text) => [text, text.replace(/ \(.*\)$/, "")])
          .map((text) => text.trim().toLowerCase()),
      ),
      slugs: new Set([...texts.map(slug), ...anchor_tags]),
    };
    heading_cache.set(file, cached);
  }
  return cached;
}

test("every markdown link to a file or heading resolves", () => {
  const problems: string[] = [];
  for (const file of markdown_files) {
    const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
    for (const match of text.matchAll(/\]\(([^)\s#]*)(?:#([^)\s]*))?\)/g)) {
      const path = group(match, 1);
      const anchor = match[2];
      if (/^[a-z]+:/.test(path)) continue;
      const target = path === "" ? file : normalize(join(dirname(file), path));
      if (!existsSync(target))
        problems.push(`${file}: ${match[0]} names a file that does not exist`);
      else if (
        anchor &&
        target.endsWith(".md") &&
        !headings_of(target).slugs.has(anchor)
      )
        problems.push(`${file}: ${match[0]} names no heading in ${target}`);
    }
  }
  assert.equal(problems.length, 0, `\n${problems.join("\n")}\n`);
});

// A quoted title after a markdown file name, as in `docs/design/config.md`, "Engines" or design.md "Styles" and "Themes".
test("every section title quoted after a markdown file name is a heading there", () => {
  const known = new Set(markdown_files);
  const problems: string[] = [];
  for (const file of markdown_files) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /([\w./-]+\.md)[`)\]]*,? ((?:"[^"\n]+"(?:,? (?:and )?)?)+)/g,
    )) {
      const named = group(match, 1);
      const target = [
        normalize(join(dirname(file), named)),
        named,
        join("docs", named),
      ].find((candidate) => known.has(candidate));
      if (!target) continue;
      for (const title of group(match, 2).matchAll(/"([^"]+)"/g)) {
        if (!headings_of(target).texts.has(group(title, 1).toLowerCase()))
          problems.push(
            `${file}: "${group(title, 1)}" is no heading in ${target}`,
          );
      }
    }
  }
  assert.equal(problems.length, 0, `\n${problems.join("\n")}\n`);
});

test("the design section map lists every area file and every listed file exists", () => {
  const map = readFileSync(DESIGN_MAP, "utf8");
  const listed = [...map.matchAll(/\]\((design\/[\w]+\.md)\)/g)].map((match) =>
    join("docs", group(match, 1)),
  );
  const on_disk = readdirSync(DESIGN_AREAS).map((name) =>
    join(DESIGN_AREAS, name),
  );
  assert.deepEqual([...new Set(listed)].sort(), on_disk.sort());
});

test("every area file header names READMEs and source folders that exist", () => {
  const problems: string[] = [];
  for (const name of readdirSync(DESIGN_AREAS)) {
    const file = join(DESIGN_AREAS, name);
    const header = readFileSync(file, "utf8")
      .split("\n")
      .slice(0, 6)
      .join("\n");
    for (const line of ["Area", "READMEs", "Source"])
      if (!new RegExp(`^${line}: `, "m").test(header))
        problems.push(`${file}: header has no "${line}:" line`);
    for (const match of header.matchAll(/`([^`]+)`/g))
      if (!existsSync(group(match, 1)))
        problems.push(
          `${file}: header names ${group(match, 1)}, which does not exist`,
        );
  }
  assert.equal(problems.length, 0, `\n${problems.join("\n")}\n`);
});

test("each heading anchor is unique across the design files", () => {
  const owner = new Map<string, string>();
  const problems: string[] = [];
  for (const file of [
    DESIGN_MAP,
    ...readdirSync(DESIGN_AREAS).map((name) => join(DESIGN_AREAS, name)),
  ]) {
    for (const anchor of heading_texts(file, true).map(slug)) {
      const first = owner.get(anchor);
      if (first && first !== file)
        problems.push(`#${anchor} is in ${first} and ${file}`);
      else owner.set(anchor, file);
    }
  }
  assert.equal(problems.length, 0, `\n${problems.join("\n")}\n`);
});

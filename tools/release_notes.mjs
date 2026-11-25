// Reads and resets RELEASE.md, the local release notes file. It holds one "# Next release" section. Past notes live on the GitHub releases, so the file keeps no versioned sections.
// Usage: node tools/release_notes.mjs next <file>              print the body of "# Next release"; fail when the file or the body is missing or empty.
//        node tools/release_notes.mjs text <file> <version>    print that body under the heading "# DesertFox <version>", the text of the GitHub release.
//        node tools/release_notes.mjs reset <file>             after the publish, replace the file with an empty "# Next release" section; fail when that section is already empty.
// Node only, like release_stamp.mjs. `just release` runs it.

import { readFileSync, writeFileSync } from "node:fs";

const NEXT_HEADING = "# Next release";

const fail = (message) => {
  console.error(`release_notes: ${message}`);
  process.exit(1);
};

// A "# " line inside a code fence is body text, not a heading.
const heading_line_indexes = (lines) => {
  const indexes = [];
  let in_fence = false;
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) in_fence = !in_fence;
    else if (!in_fence && /^# /.test(line)) indexes.push(index);
  });
  return indexes;
};

// The line range of the Next release section, from its heading to the next heading.
const next_section = (lines, file) => {
  const headings = heading_line_indexes(lines);
  const start = headings.find((index) => lines[index].trimEnd() === NEXT_HEADING);
  if (start === undefined) fail(`${file} has no "${NEXT_HEADING}" section.`);
  const end = headings.find((index) => index > start) ?? lines.length;
  return { start, end };
};

const read_lines = (file) => {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    fail(`${file} does not exist. Write the release notes under "${NEXT_HEADING}" there.`);
  }
  return content.split("\n");
};

const next_body = (lines, file) => {
  const { start, end } = next_section(lines, file);
  const body = lines.slice(start + 1, end).join("\n").trim();
  if (body === "") fail(`the "${NEXT_HEADING}" section of ${file} is empty. Write the release notes first.`);
  return body;
};

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$/;
const [command, file, version] = process.argv.slice(2);
if (!file) fail("usage: release_notes.mjs next|text|reset <file> [version]");
if (command === "text" && !VERSION_PATTERN.test(version ?? "")) fail(`'${version}' is not a version.`);
const lines = read_lines(file);

if (command === "next") {
  console.log(next_body(lines, file));
} else if (command === "text") {
  console.log(`# DesertFox ${version}\n\n${next_body(lines, file)}`);
} else if (command === "reset") {
  next_body(lines, file);
  writeFileSync(file, `${NEXT_HEADING}\n\n`);
} else {
  fail(`unknown command '${command}'.`);
}

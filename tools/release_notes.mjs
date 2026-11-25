// Reads and resets RELEASE.md, the local release notes file. It holds one "# Next release" section. Past notes live on the GitHub releases, so the file keeps no versioned sections.
// Usage: node tools/release_notes.mjs next <file>              print the body of "# Next release"; fail when the file or the body is missing or empty.
//        node tools/release_notes.mjs text <file> <version>    print that body under the heading "# DesertFox <version>", the text of the GitHub release.
//        node tools/release_notes.mjs reset <file> <snapshot>  after the publish, replace the file with an empty "# Next release" section, but only when the file still equals the snapshot taken with the notes. A changed file stays as it is.
// Node only, like release_stamp.mjs. `just release` runs it.

import { readFileSync, writeFileSync } from "node:fs";

const NEXT_HEADING = "# Next release";

const fail = (message) => {
  console.error(`release_notes: ${message}`);
  process.exit(1);
};

// A "# " line inside a code fence is body text, not a heading. As in CommonMark, a fence closes only on the same character, at least as long as the opening, with nothing after it.
const heading_line_indexes = (lines) => {
  const indexes = [];
  let fence = null;
  lines.forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence === null && marker) fence = marker[1];
    else if (fence !== null && marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === "") fence = null;
    else if (fence === null && /^# /.test(line)) indexes.push(index);
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
  // Only blank boundary lines go, so the indentation of the first content line survives.
  const section = lines.slice(start + 1, end);
  while (section.length > 0 && section[0].trim() === "") section.shift();
  while (section.length > 0 && section[section.length - 1].trim() === "") section.pop();
  const body = section.join("\n");
  if (body === "") fail(`the "${NEXT_HEADING}" section of ${file} is empty. Write the release notes first.`);
  return body;
};

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$/;
const [command, file, version] = process.argv.slice(2);
const snapshot = version;
if (!file) fail("usage: release_notes.mjs next|text|reset <file> [version|snapshot]");
if (command === "text" && !VERSION_PATTERN.test(version ?? "")) fail(`'${version}' is not a version.`);
const lines = read_lines(file);

if (command === "next") {
  console.log(next_body(lines, file));
} else if (command === "text") {
  console.log(`# DesertFox ${version}\n\n${next_body(lines, file)}`);
} else if (command === "reset") {
  if (!snapshot) fail("reset needs the snapshot file.");
  if (readFileSync(file, "utf8") !== readFileSync(snapshot, "utf8")) {
    console.log(`release_notes: ${file} changed after the release took its notes, so it is left as it is. Remove the published notes from it by hand.`);
  } else {
    writeFileSync(file, `${NEXT_HEADING}\n\n`);
  }
} else {
  fail(`unknown command '${command}'.`);
}

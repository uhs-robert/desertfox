// Converts the GitHub release text of tools/release_notes.mjs (`text`) into the plain text of the AMO "release notes" field. AMO shows that field as plain text, so markdown marks would show as typed.
// Usage: node tools/amo_notes.mjs [file]    reads the file, or stdin without one, and prints the plain text. Fails when the result is empty or longer than MAX_LENGTH.
// Rules: the "# " title goes. The "## Install" and "## Links" sections go, since they point at the GitHub release and not at the listing. Any other "## X" or "### X" becomes the line "X:". Bullets stay as "- ". Bold, code ticks and fences go. A link [text](url) becomes "text (url)". No HTML.
// Node only, like release_notes.mjs. `just release_submit_listed` runs it.

import { readFileSync } from "node:fs";

// AMO counts code points, not UTF-16 units. AMO's API docs state no limit for version release_notes. 3000 is the limit the API itself answered with (400 "Ensure this field has no more than 3000 characters."), so the check runs before the GitHub release goes public.
const MAX_LENGTH = 3000;
const DROPPED_SECTIONS = new Set(["install", "links"]);

const fail = (message) => {
  console.error(`amo_notes: ${message}`);
  process.exit(1);
};

const strip_inline = (line) =>
  line
    .replace(/!?\[([^\]]*)\]\(([^)\s]+)\)/g, (_, text, url) => (text === "" || text === url ? url : `${text} (${url})`))
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]*)`/g, "$1");

// A fence closes only on the same character, at least as long as the opening, with nothing after it (CommonMark, as in release_notes.mjs).
export const convert = (markdown) => {
  const out = [];
  let fence = null;
  // The level of the dropped heading while one is open: its nested headings are dropped too, and a heading of the same or a higher level ends it.
  let skipping_level = null;
  for (const line of markdown.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence === null && marker) {
      fence = marker[1];
      continue;
    }
    if (fence !== null && marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === "") {
      fence = null;
      continue;
    }
    if (fence === null) {
      const heading = /^(#{1,6}) +(.*?) *#*$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        if (skipping_level !== null && level > skipping_level) continue;
        // Release headings carry a leading emoji ("## 📦 Install"), so the name starts at the first letter or digit, and the emoji stays out of the plain text.
        const name = heading[2].replace(/^[^\p{L}\p{N}]+/u, "").trim();
        skipping_level = DROPPED_SECTIONS.has(name.toLowerCase()) ? level : null;
        if (level >= 2 && skipping_level === null) out.push("", `${strip_inline(name)}:`, "");
        continue;
      }
    }
    if (skipping_level !== null) continue;
    out.push(fence === null ? strip_inline(line.replace(/^(\s*)[*+] /, "$1- ")) : line);
  }
  return out.join("\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
};

if (process.argv[1] === import.meta.filename) {
  const file = process.argv[2];
  let input;
  try {
    input = readFileSync(file ?? 0, "utf8");
  } catch {
    fail(`cannot read ${file ?? "stdin"}.`);
  }
  const text = convert(input);
  if (text === "") fail("the release notes are empty after the conversion. Write a release intro or bullets outside the Install and Links sections.");
  const length = [...text].length;
  if (length > MAX_LENGTH) fail(`the converted notes are ${length} characters long, but AMO accepts at most ${MAX_LENGTH}. Shorten "# Next release" in RELEASE.md (for a recovery, shorten release-assets/release-notes-<version>.md). A short summary with a link to the GitHub release notes works.`);
  process.stdout.write(text);
}

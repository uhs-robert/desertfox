// Turns a small markdown subset into a block list. It fails on anything else, so a doc never renders half right.
// Allowed: `##` and `###` headings, paragraphs, flat `- ` lists, fenced code blocks, inline code and `[text](https://...)` links.
// The page title is the help page heading, so a doc has no `#` heading. Move to a library parser if docs need tables,
// nested lists or markdown we do not control.

import type { Block, Inline } from "../src/help/blocks.ts";

export class UnsupportedMarkdown extends Error {
  constructor(source: string, line: number, reason: string) {
    super(`${source}:${line}: ${reason}`);
    this.name = "UnsupportedMarkdown";
  }
}

const HEADING = /^(#{1,6})(?: (.*))?$/;
const LIST_MARKER = /^(?:[-*+]|\d+[.)]) /;
const FENCE = /^```(\w*)$/;

function parse_inlines(text: string, fail: (reason: string) => never): Inline[] {
  const inlines: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain) inlines.push({ kind: "text", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    if (char === "`") {
      const end = text.indexOf("`", i + 1);
      if (end <= i + 1) fail("a backtick has no closing backtick, or the code is empty");
      flush();
      inlines.push({ kind: "code", text: text.slice(i + 1, end) });
      i = end + 1;
    } else if (char === "[") {
      const link = /^\[([^\][`]+)\]\((https:\/\/[^\s()]+)\)/.exec(text.slice(i));
      if (!link) fail("a [ must start a link written [text](https://...) with plain text");
      flush();
      inlines.push({ kind: "link", text: link![1]!, href: link![2]! });
      i += link![0].length;
    } else if (char === "!" && text[i + 1] === "[") {
      fail("images are not supported");
    } else if (char === "*" || char === "<" || char === "\\") {
      fail(`"${char}" is not supported (emphasis, HTML and escapes)`);
    } else if (char === "_" && !/\w/.test(text[i - 1] ?? " ") && /\S/.test(text[i + 1] ?? " ")) {
      fail('"_" starts emphasis, which is not supported');
    } else {
      plain += char;
      i += 1;
    }
  }
  flush();
  return inlines;
}

export function parse_markdown(source: string, text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  const fail_at = (index: number, reason: string): never => {
    throw new UnsupportedMarkdown(source, index + 1, reason);
  };
  // Checked first, so a blank line or a code block body cannot hide one.
  const carriage_return_line = lines.findIndex((line) => line.includes("\r"));
  if (carriage_return_line >= 0) fail_at(carriage_return_line, "carriage returns are not supported. Use Unix line endings");
  const inlines_at = (index: number, line: string) => parse_inlines(line, (reason) => fail_at(index, reason));

  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (line.includes("\t")) fail_at(index, "tabs are not supported");
    const fence = FENCE.exec(line);
    if (fence) {
      const start = index;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && lines[index] !== "```") {
        body.push(lines[index]!);
        index += 1;
      }
      if (index >= lines.length) fail_at(start, "the code block is never closed");
      index += 1;
      blocks.push({ kind: "code_block", text: body.join("\n") });
      continue;
    }
    if (line.startsWith("```") || line.startsWith("~~~") || line.startsWith("    ")) {
      fail_at(index, "use a plain ``` fence with at most a language word. Indented code is not supported");
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      if (level !== 2 && level !== 3) fail_at(index, "only ## and ### headings are supported");
      const title = heading[2] ?? "";
      if (title.trim() === "") fail_at(index, "the heading is empty");
      blocks.push({ kind: "heading", level: level as 2 | 3, text: title });
      index += 1;
      continue;
    }
    if (line.startsWith("- ") || LIST_MARKER.test(line)) {
      if (!line.startsWith("- ")) fail_at(index, "only flat lists that start with `- ` are supported");
      const raw_items: { line_index: number; text: string }[] = [];
      while (index < lines.length && lines[index]!.trim() !== "") {
        const row = lines[index]!;
        if (row.startsWith("- ")) {
          raw_items.push({ line_index: index, text: row.slice(2) });
        } else if (row.startsWith("  ") && !LIST_MARKER.test(row.trimStart())) {
          raw_items[raw_items.length - 1]!.text += ` ${row.trim()}`;
        } else {
          fail_at(index, "a list item continues only on lines indented by two spaces. Nested lists are not supported");
        }
        index += 1;
      }
      const items = raw_items.map((item) => inlines_at(item.line_index, item.text));
      blocks.push({ kind: "list", items });
      continue;
    }
    if (line.startsWith(">") || line.startsWith("|") || /^(-{3,}|={3,}|\*{3,})$/.test(line.trim())) {
      fail_at(index, "quotes, tables, rules and setext headings are not supported");
    }
    const start = index;
    const parts: string[] = [];
    while (index < lines.length && lines[index]!.trim() !== "") {
      const row = lines[index]!;
      if (FENCE.test(row) || HEADING.test(row) || LIST_MARKER.test(row)) fail_at(index, "leave a blank line before a heading, list or code block");
      if (/^(-{3,}|={3,})$/.test(row.trim())) fail_at(index, "quotes, tables, rules and setext headings are not supported");
      parts.push(row.trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", inlines: inlines_at(start, parts.join(" ")) });
  }
  return blocks;
}

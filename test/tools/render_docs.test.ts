import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse_markdown, UnsupportedMarkdown } from "../../tools/render_docs.ts";

const parse = (text: string) => parse_markdown("doc.md", text);

test("headings, paragraphs, lists, code and links become blocks", () => {
  const blocks = parse(["## Title", "", "Some `code` and", "a [link](https://a.example/x).", "", "- one", "  more", "- two", "", "```toml", "a = 1", "", "b = 2", "```", ""].join("\n"));
  assert.deepEqual(blocks, [
    { kind: "heading", level: 2, text: "Title" },
    {
      kind: "paragraph",
      inlines: [
        { kind: "text", text: "Some " },
        { kind: "code", text: "code" },
        { kind: "text", text: " and a " },
        { kind: "link", text: "link", href: "https://a.example/x" },
        { kind: "text", text: "." },
      ],
    },
    { kind: "list", items: [[{ kind: "text", text: "one more" }], [{ kind: "text", text: "two" }]] },
    { kind: "code_block", text: "a = 1\n\nb = 2", language: "toml" },
  ]);
});

test("names with underscores and braces stay plain text", () => {
  const [block] = parse("Edit search_engines.toml and use {query|url:raw}.");
  assert.deepEqual(block, { kind: "paragraph", inlines: [{ kind: "text", text: "Edit search_engines.toml and use {query|url:raw}." }] });
});

test("markdown characters inside code are not parsed", () => {
  const [block] = parse("Run `*a* <b> [c]`.");
  assert.deepEqual(block, { kind: "paragraph", inlines: [{ kind: "text", text: "Run " }, { kind: "code", text: "*a* <b> [c]" }, { kind: "text", text: "." }] });
  assert.deepEqual(parse("```\n# not a heading <b>\n```"), [{ kind: "code_block", text: "# not a heading <b>" }]);
});

const UNSUPPORTED: [string, string][] = [
  ["bold", "Some **bold** text"],
  ["emphasis with underscores", "Some _slanted_ text"],
  ["html", "A <b>tag</b>"],
  ["an h1 heading", "# Title"],
  ["an h4 heading", "#### Deep"],
  ["a nested list", "- one\n  - two"],
  ["an ordered list", "1. one\n2. two"],
  ["a star list", "* one"],
  ["a quote", "> quoted"],
  ["a table", "| a | b |\n| - | - |"],
  ["an image", "![alt](https://a.example/i.png)"],
  ["a relative link", "See [it](docs/x.md)"],
  ["a script link", "See [it](javascript:alert(1))"],
  ["an unclosed code block", "```\nabc"],
  ["an unclosed backtick", "a `b"],
  ["indented code", "    code"],
  ["windows line endings", "## A\r\n\r\ntext"],
  ["a carriage return alone on a blank line", "text\n\r\nmore"],
  ["a carriage return in a code block", "```\na\r\n```"],
  ["emphasis in a heading", "## *bold*"],
  ["an image in a heading", "## ![x](https://e.com/a.png)"],
  ["code in a heading", "## The `code`"],
  ["a quote on a later paragraph line", "text\n> quoted"],
  ["a table row on a later paragraph line", "text\n| a | b |"],
  ["a tilde fence on a later paragraph line", "text\n~~~"],
  ["a list glued to a paragraph", "text\n- item"],
];

for (const [name, text] of UNSUPPORTED) {
  test(`unsupported markdown fails with a located message: ${name}`, () => {
    assert.throws(() => parse(text), (error: unknown) => error instanceof UnsupportedMarkdown && /^doc\.md:\d+: /.test(error.message));
  });
}

test("an inline error on a later paragraph line names that line", () => {
  assert.throws(() => parse("fine\nstill fine\nbad **bold**"), /doc\.md:3:/);
});

test("a block marker on a later paragraph line names that line", () => {
  assert.throws(() => parse("fine\n> quoted"), /doc\.md:2:/);
});

test("the error names the line", () => {
  assert.throws(() => parse("fine\n\n**bold**"), /doc\.md:3:/);
});

test("docs/search_engines.md renders", () => {
  const blocks = parse_markdown("docs/search_engines.md", readFileSync(new URL("../../docs/search_engines.md", import.meta.url), "utf8"));
  assert.ok(blocks.some((block) => block.kind === "code_block"));
  assert.ok(blocks.every((block) => block.kind !== "heading" || block.level >= 2));
});

test("a fence keeps its language word in the block, and a bare fence has no language field", () => {
  assert.deepEqual(parse("```toml\na = 1\n```"), [{ kind: "code_block", text: "a = 1", language: "toml" }]);
  assert.equal("language" in parse("```\na = 1\n```")[0]!, false);
});

test("the built guide JSON carries the language of its code blocks", () => {
  const blocks = parse(readFileSync(new URL("../../docs/search_engines.md", import.meta.url), "utf8"));
  const code = blocks.filter((block) => block.kind === "code_block");
  assert.ok(code.length > 0 && code.every((block) => block.kind === "code_block" && block.language === "toml"));
});

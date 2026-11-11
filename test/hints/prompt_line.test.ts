import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_command_line } from "../../src/shared/registry/command_line.ts";
import "../../src/background/command_modules.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { line_for, prompt_pick, quote_for_line } from "../../src/content/hints/prompt_line.ts";

test("an address with no special character stays plain, anything the line would split or read as a flag is quoted", () => {
  assert.equal(quote_for_line("https://x.test/a?b=1&c=2#d"), "https://x.test/a?b=1&c=2#d");
  assert.equal(quote_for_line("https://x.test/a b"), "'https://x.test/a b'");
  assert.equal(quote_for_line("-x"), "'-x'");
  assert.equal(quote_for_line("@clipboard"), "'@clipboard'");
  assert.equal(quote_for_line("a\\b"), "'a\\b'");
  assert.equal(quote_for_line("it's"), "'it'\\''s'");
});

test("the line reads back as the same address through the real command line parser", () => {
  for (const address of ["https://x.test/a b?q='x'&r=\"y\"", "https://x.test/a\\b", "https://x.test/plain", "data:text/plain,hi there"]) {
    const parsed = parse_command_line(registry, line_for("open --tab", address));
    assert.equal(parsed.kind, "invocation", address);
    if (parsed.kind === "invocation") assert.deepEqual([parsed.invocation.args?.url, parsed.invocation.args?.where], [address, "tab"]);
  }
});

test("a target with no address gets a refusal and no line", () => {
  const asked: string[] = [];
  const target = { localName: "button", textContent: "x" } as never;
  assert.deepEqual(prompt_pick(target, "open", false, async (text) => void asked.push(text)), { ok: false, message: "This element has no web address" });
  assert.deepEqual(asked, []);
});

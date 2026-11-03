import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_command_line, print_command } from "../../src/shared/registry/index.ts";
import { grammar_registry, search_sources } from "./grammar_registry.ts";

const registry = grammar_registry();
const command_of = (id: string) => registry.get(id)!;

// Parse, print, parse again: the second parse must equal the first.
function round_trip(text: string) {
  const first = parse_command_line(registry, text, search_sources);
  assert.equal(first.kind, "invocation", text);
  if (first.kind !== "invocation") return;
  const printed = print_command(command_of(first.invocation.id), first.invocation.args);
  const second = parse_command_line(registry, printed, search_sources);
  assert.deepEqual(second.kind === "invocation" ? second.invocation : second, first.invocation, `${text} printed as ${printed}`);
}

test("lines parse, print and parse to the same invocation", () => {
  for (const text of [
    "tab.next",
    "open https://example.org/a?b=c",
    "open tab https://example.org",
    "open url='two words' where=window",
    "search engine=arch rust lifetimes",
    "search engine=arch tab 'it''s' ",
    "search engine=ddg @selection",
    "hint rapid background links",
    "hint custom selector='a[href]'",
    "tab.shift 3 wrap",
    "zoom.set 1.5",
    "open '@not_a_source'",
    "open 'a=b'",
    "open 'with \"double\" quotes'",
  ]) {
    round_trip(text);
  }
});

test("the main value prints bare and last, other params as name=value", () => {
  assert.equal(print_command(command_of("open.url"), { url: "https://example.org", where: "tab" }), "open where=tab https://example.org");
  assert.equal(print_command(command_of("open.search"), { engine: "arch", query: "rust lifetimes" }), "search engine=arch rust lifetimes");
  assert.equal(print_command(command_of("tab.shift"), { offset: 3, wrap: true }), "tab.shift offset=3 wrap");
});

test("a value a bare word would misread is quoted or named", () => {
  assert.equal(print_command(command_of("open.url"), { url: "@selection" }), "open '@selection'");
  assert.equal(print_command(command_of("open.url"), { url: "tab" }), "open url=tab");
  assert.equal(print_command(command_of("open.url"), { url: "a=b" }), "open 'a=b'");
});

test("an open param prints without a value", () => {
  assert.equal(print_command(command_of("open.url"), {}, { open_param: "url" }), "open ");
  assert.equal(print_command(command_of("tab.move"), {}, { open_param: "offset" }), "tab.move offset=");
  assert.equal(print_command(command_of("open.search"), { engine: "arch" }, { open_param: "query" }), "search engine=arch ");
  assert.equal(print_command(command_of("open.url"), { where: "tab" }, { open_param: "url" }), "open where=tab ");
});

test("a context source prints as its marker", () => {
  assert.equal(print_command(command_of("open.search"), { engine: "arch", query: { from: "selection" } }), "search engine=arch query=@selection");
});

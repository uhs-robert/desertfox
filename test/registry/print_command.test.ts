import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_command_line, print_command } from "../../src/shared/registry/index.ts";
import { registry as real_registry } from "../../src/shared/registry/builtin.ts";
import "../../src/background/command_modules.ts";
import "../../src/commands/hint.ts";
import { grammar_registry, search_sources } from "./grammar_registry.ts";

const registry = grammar_registry();
const command_of = (id: string) => registry.get(id)!;

// Parse, print, parse again: the second parse must equal the first.
function round_trip(text: string) {
  const first = parse_command_line(registry, text, search_sources);
  assert.equal(first.kind, "invocation", text);
  if (first.kind !== "invocation") return;
  const printed = print_command(command_of(first.invocation.id), first.invocation.args, { sources: search_sources });
  const second = parse_command_line(registry, printed, search_sources);
  assert.deepEqual(second.kind === "invocation" ? second.invocation : second, first.invocation, `${text} printed as ${printed}`);
}

test("lines parse, print and parse to the same invocation", () => {
  for (const text of [
    "tab.next",
    "open https://example.org/a?b=c",
    "open -t https://example.org",
    "open --url='two words' --where=window",
    "open -t -c='My Work' x",
    "search arch rust lifetimes",
    "search arch -t 'it''s' ",
    "search ddg @selection",
    "search -- -std c++",
    "search -- arch maps",
    "hint -r -b",
    "hint --custom --selector='a[href]'",
    "tab.shift --wrap 3",
    "tab.move -3",
    "zoom.set 1.5",
    "mode ignore",
    "open '@not_a_source'",
    "open 'a=b'",
    "open -- -b",
    "open '--tab'",
    "open 'with \"double\" quotes'",
  ]) {
    round_trip(text);
  }
});

test("flags print first in param order, the subject last, defaults left out", () => {
  assert.equal(print_command(command_of("open.url"), { url: "https://example.org", where: "tab" }), "open -t https://example.org");
  assert.equal(print_command(command_of("open.url"), { url: "https://example.org", where: "here" }), "open https://example.org");
  assert.equal(print_command(command_of("open.url"), { url: "x", where: "tab", container: "Work" }), "open -c=Work -t x");
  assert.equal(print_command(command_of("open.search"), { engine: "arch", query: "rust lifetimes" }), "search arch rust lifetimes");
  assert.equal(print_command(command_of("open.search"), { engine: "arch", where: "window", query: "x" }), "search arch -w x");
  assert.equal(print_command(command_of("tab.shift"), { offset: 3, wrap: true }), "tab.shift -w 3");
  assert.equal(print_command(command_of("tab.shift"), { offset: 3, wrap: false }), "tab.shift 3");
  assert.equal(print_command(command_of("hint.run"), { action: "open", filter: "custom", selector: "a", rapid: true }), "hint -u -r");
  assert.equal(print_command(command_of("tab.close"), { focus: "left" }), "tab.close --left");
  assert.equal(print_command(command_of("mode.set"), { mode: "ignore" }), "mode ignore");
});

test("the long style writes every flag in full, for docs", () => {
  const long = { flags: "long" } as const;
  assert.equal(print_command(command_of("open.url"), { url: "x", where: "tab", container: "Work" }, long), "open --container=Work --tab x");
  assert.equal(print_command(command_of("hint.run"), { action: "background", rapid: true }, long), "hint --background --rapid");
});

test("a value that would be misread gets the -- guard, quotes or a named flag", () => {
  assert.equal(print_command(command_of("open.url"), { url: "@selection" }), "open '@selection'");
  assert.equal(print_command(command_of("open.url"), { url: "-b" }), "open -- -b");
  assert.equal(print_command(command_of("open.url"), { url: "a=b" }), "open a=b");
  assert.equal(print_command(command_of("open.search"), { query: "arch maps" }, { sources: search_sources }), "search -- arch maps");
  assert.equal(print_command(command_of("open.search"), { engine: "arch", query: "-std c++" }), "search arch -- -std c++");
});

test("an open param prints without a value", () => {
  assert.equal(print_command(command_of("open.url"), {}, { open_param: "url" }), "open ");
  assert.equal(print_command(command_of("tab.move"), {}, { open_param: "offset" }), "tab.move ");
  assert.equal(print_command(command_of("open.search"), { engine: "arch" }, { open_param: "query" }), "search arch ");
  assert.equal(print_command(command_of("open.url"), { where: "tab" }, { open_param: "url" }), "open -t ");
  assert.equal(print_command(command_of("open.url"), { where: "tab" }, { open_param: "container" }), "open -c= -t");
});

test("a context source prints as its marker", () => {
  assert.equal(print_command(command_of("open.search"), { engine: "arch", query: { from: "selection" } }), "search arch @selection");
  assert.equal(print_command(command_of("open.url"), { url: { from: "current_url" }, where: "tab" }), "open -t @current_url");
});

test("a context source in a positional param prints as its marker and reads back", () => {
  const positional = grammar_registry();
  positional.define("pos.set", {
    label: "Pos",
    intent: "Take a name, then text.",
    runs_in: "background",
    params: [
      { name: "name", type: "string", values: ["alpha", "beta"], strict: true },
      { name: "value", type: "string", rest: true, main: true, optional: true },
    ],
    run: () => {},
  });
  const command = positional.get("pos.set")!;
  const printed = print_command(command, { name: { from: "selection" }, value: "text" });
  assert.equal(printed, "pos.set @selection text");
  const parsed = parse_command_line(positional, printed);
  assert.deepEqual(parsed.kind === "invocation" && parsed.invocation.args, { name: { from: "selection" }, value: "text" });
});

test("an open positional param prints as an empty word, and an open subject after it too", () => {
  const positional = grammar_registry();
  positional.define("pos.set", {
    label: "Pos",
    intent: "Take a name, then text.",
    runs_in: "background",
    params: [
      { name: "name", type: "string", values: ["alpha", "beta"], strict: true },
      { name: "value", type: "string", rest: true, main: true, optional: true },
    ],
    run: () => {},
  });
  const command = positional.get("pos.set")!;
  assert.equal(print_command(command, {}, { open_param: "name" }), "pos.set ");
  assert.equal(print_command(command, { name: "" }, { open_param: "name" }), "pos.set ");
  assert.equal(print_command(command, { name: "alpha" }, { open_param: "value" }), "pos.set alpha ");
});

test("a verbatim subject prints raw and reads back as typed", () => {
  const hint = real_registry.get("hint.run")!;
  for (const selector of ['a[href="x"]', "a[title='it']  .b", '"a b"', ".a\\:b  c"]) {
    const text = print_command(hint, { filter: "custom", selector }, { flags: "long" });
    assert.equal(text, `hint --custom ${selector}`);
    const parsed = parse_command_line(real_registry, text);
    assert.deepEqual(parsed.kind === "invocation" ? parsed.invocation.args : parsed, { filter: "custom", selector });
  }
  const guarded = print_command(hint, { filter: "custom", selector: "-x[a]" }, { flags: "long" });
  assert.equal(guarded, "hint --custom -- -x[a]");
});

test("tab.move prints its offset as a flag and tm opens the tab picker", () => {
  const move = real_registry.get("tab.move")!;
  assert.equal(print_command(move, { offset: -1 }), "tab.move --offset=-1");
  assert.equal(print_command(move, {}, { open_param: "tab" }), "tab.move ");
  assert.equal(print_command(move, { tab: "-1" }), "tab.move -- -1");
});

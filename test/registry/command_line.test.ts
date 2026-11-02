import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args, parse_command_line, tokenize } from "../../src/shared/registry/index.ts";
import { grammar_registry, search_sources } from "./grammar_registry.ts";

const registry = grammar_registry();

function parsed(text: string) {
  const result = parse_command_line(registry, text);
  assert.equal(result.kind, "invocation", JSON.stringify(result));
  return result.kind === "invocation" ? result.invocation : never();
}
function error_of(text: string): string {
  const result = parse_command_line(registry, text);
  assert.equal(result.kind, "error", JSON.stringify(result));
  return result.kind === "error" ? result.error : "";
}
function never(): never {
  throw new Error("unreachable");
}

test("the design example parses to the documented invocation", () => {
  const invocation = parsed(`search engine=arch background "rust lifetimes"`);
  assert.deepEqual(invocation, {
    id: "open.search",
    args: { engine: "arch", where: "background", query: "rust lifetimes" },
  });
  assert.equal(check_args(registry.get(invocation.id)!, invocation.args, search_sources).ok, true);
});

test("first word is a name, an alias or a full id", () => {
  assert.equal(parsed("search engine=arch x").id, "open.search");
  assert.equal(parsed("s engine=arch x").id, "open.search");
  assert.equal(parsed("open.search engine=arch x").id, "open.search");
  assert.deepEqual(parsed("tab.close"), { id: "tab.close" });
  assert.equal(error_of("nope"), 'unknown command "nope"');
  assert.equal(error_of("   "), "empty command line");
});

test("a bare word that is one param's enum value sets that param, in any order", () => {
  assert.deepEqual(parsed("hint rapid background links").args, { rapid: true, action: "background", filter: "links" });
  assert.deepEqual(parsed("hint links background").args, { filter: "links", action: "background" });
  assert.deepEqual(parsed("tab.close left").args, { focus: "left" });
  assert.deepEqual(parsed("open tab https://github.com").args, { where: "tab", url: "https://github.com" });
  assert.deepEqual(parsed("open https://github.com tab").args, { url: "https://github.com", where: "tab" });
});

test("a bare bool name turns the switch on and name=value turns it off", () => {
  assert.deepEqual(parsed("hint rapid").args, { rapid: true });
  assert.deepEqual(parsed("hint rapid=false").args, { rapid: "false" });
  assert.equal(check_args(registry.get("hint.run")!, parsed("hint rapid=false").args).ok, true);
});

test("name=value works for any param, with the first = as the split", () => {
  assert.deepEqual(parsed("open where=tab url=https://a.example/?x=1").args, { where: "tab", url: "https://a.example/?x=1" });
  assert.deepEqual(parsed(`hint selector=".post a"`).args, { selector: ".post a" });
  assert.deepEqual(parsed(`hint selector='a[href="x"]'`).args, { selector: 'a[href="x"]' });
  assert.deepEqual(parsed("tab.move offset=-1").args, { offset: "-1" });
});

test("the main value is the one bare free word", () => {
  assert.deepEqual(parsed("s engine=arch rust").args, { engine: "arch", query: "rust" });
  assert.equal(error_of("s engine=arch rust lifetimes"), "query is set twice, quote text that has spaces");
  assert.equal(error_of("hint nope"), '"nope" is not a value, switch or param of hint');
});

test("a quoted word is always free text, never a value word, switch or name=value", () => {
  assert.deepEqual(parsed(`s engine=arch "tab"`).args, { engine: "arch", query: "tab" });
  assert.deepEqual(parsed(`open "where=tab"`).args, { url: "where=tab" });
  assert.deepEqual(parsed(`open 'url=x'`).args, { url: "url=x" });
  assert.equal(error_of(`hint "rapid"`), '"rapid" is not a value, switch or param of hint');
});

test("unknown params, repeated params and unknown commands are errors", () => {
  assert.equal(error_of("open nope=1"), 'unknown param "nope" for open');
  assert.equal(error_of("open tab window"), "where is set twice");
  assert.equal(error_of("open where=tab where=window"), "where is set twice");
});

test("@source words are context sources, unquoted only", () => {
  assert.deepEqual(parsed("open @current_url").args, { url: { from: "current_url" } });
  assert.deepEqual(parsed("open url=@selection").args, { url: { from: "selection" } });
  assert.deepEqual(parsed("open url=@clipboard tab").args, { url: { from: "clipboard" }, where: "tab" });
  assert.deepEqual(parsed(`open "@selection"`).args, { url: "@selection" });
  assert.deepEqual(parsed(`open url="@selection"`).args, { url: "@selection" });
  assert.deepEqual(parsed(`open a@b.example`).args, { url: "a@b.example" });
  assert.match(error_of("open @nope"), /unknown source "@nope" \(known: @current_url, @selection, @clipboard\), quote text that starts with @/);
});

test("shell quoting", () => {
  assert.deepEqual(tokenize(`a "b c" 'd e' f\\ g "h\\"i" 'j\\k' l"m n"o x="y z"`), [
    { text: "a", quoted_from: null },
    { text: "b c", quoted_from: 0 },
    { text: "d e", quoted_from: 0 },
    { text: "f g", quoted_from: 1 },
    { text: 'h"i', quoted_from: 0 },
    { text: "j\\k", quoted_from: 0 },
    { text: "lm no", quoted_from: 1 },
    { text: "x=y z", quoted_from: 2 },
  ]);
  assert.deepEqual(parsed(`open where=tab "two words"`).args, { where: "tab", url: "two words" });
  assert.deepEqual(parsed(`open url="my page" where=tab`).args, { url: "my page", where: "tab" });
  assert.deepEqual(parsed(`open url=""`).args, { url: "" });
  assert.equal(error_of(`open "oops`), 'unterminated " quote');
  assert.equal(error_of(`open 'oops`), "unterminated ' quote");
  assert.match(error_of("open oops\\"), /backslash/);
});

test("-h and --help return the usage line, quoted or not", () => {
  assert.equal(parse_command_line(registry, "open -h").kind, "help");
  assert.equal(parse_command_line(registry, "tab.close --help").kind, "help");
  assert.deepEqual(parsed(`open "-h"`).args, { url: "-h" });
});

test("when conditions are the validator's job", () => {
  const invocation = parsed("open container=Work");
  const result = check_args(registry.get(invocation.id)!, invocation.args, search_sources);
  assert.deepEqual(result.ok, false);
  assert.equal(result.ok ? "" : result.error, "container needs where tab, background or window");
});

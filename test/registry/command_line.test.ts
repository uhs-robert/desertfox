import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args, parse_command_line, tokenize, usage_line } from "../../src/shared/registry/index.ts";
import type { EnumSources } from "../../src/shared/registry/index.ts";
import { grammar_registry, search_sources } from "./grammar_registry.ts";

const registry = grammar_registry();

function parsed(text: string, sources: EnumSources = search_sources) {
  const result = parse_command_line(registry, text, sources);
  assert.equal(result.kind, "invocation", JSON.stringify(result));
  return result.kind === "invocation" ? result.invocation : never();
}
function error_of(text: string, sources: EnumSources = search_sources): string {
  const result = parse_command_line(registry, text, sources);
  assert.equal(result.kind, "error", JSON.stringify(result));
  return result.kind === "error" ? result.error : "";
}
function never(): never {
  throw new Error("unreachable");
}

test("the design example parses to the documented invocation", () => {
  const invocation = parsed(`search arch -b "rust lifetimes"`);
  assert.deepEqual(invocation, {
    id: "open.search",
    args: { engine: "arch", where: "background", query: "rust lifetimes" },
  });
  assert.equal(check_args(registry.get(invocation.id)!, invocation.args, search_sources).ok, true);
});

test("first word is a name or a full id, and the dropped alias is unknown", () => {
  assert.equal(parsed("search arch x").id, "open.search");
  assert.equal(parsed("open.search arch x").id, "open.search");
  assert.deepEqual(parsed("tab.close"), { id: "tab.close" });
  assert.equal(error_of("s arch x"), 'unknown command "s"');
  assert.equal(error_of("nope"), 'unknown command "nope"');
  assert.equal(error_of("   "), "empty command line");
});

test("a long flag sets an enum value or a switch, in any order", () => {
  assert.deepEqual(parsed("hint --rapid --background --links").args, { rapid: true, action: "background", filter: "links" });
  assert.deepEqual(parsed("hint --links --background").args, { filter: "links", action: "background" });
  assert.deepEqual(parsed("tab.close --left").args, { focus: "left" });
  assert.deepEqual(parsed("open --tab https://github.com").args, { where: "tab", url: "https://github.com" });
});

test("a short flag stands for the same value or switch", () => {
  assert.deepEqual(parsed("hint -r -b -u").args, { rapid: true, action: "background", filter: "custom" });
  assert.deepEqual(parsed("open -w https://a.example").args, { where: "window", url: "https://a.example" });
});

test("a valued short flag takes -c=Work, and a bare -c is an error", () => {
  assert.deepEqual(parsed("open -t -c=Work https://a.example").args, { where: "tab", container: "Work", url: "https://a.example" });
  assert.deepEqual(parsed("open -c='Work Two' x").args, { container: "Work Two", url: "x" });
  assert.deepEqual(parsed("open -c= x").args, { container: "", url: "x" });
  assert.equal(error_of("open -c Work"), "-c needs a value, write -c=VALUE");
  assert.equal(error_of("open -t=x y"), "-t takes no value");
  assert.equal(error_of("hint -r=1"), "-r is a switch and takes no value");
});

test("--name=value works for any param, with the first = as the split", () => {
  assert.deepEqual(parsed("open --where=tab --url=https://a.example/?x=1").args, { where: "tab", url: "https://a.example/?x=1" });
  assert.deepEqual(parsed(`hint --selector=".post a"`).args, { selector: ".post a" });
  assert.deepEqual(parsed(`hint --selector='a[href="x"]'`).args, { selector: 'a[href="x"]' });
  assert.deepEqual(parsed("tab.move --offset=-1").args, { offset: "-1" });
  assert.deepEqual(parsed("hint --rapid=false").args, { rapid: "false" });
  assert.equal(check_args(registry.get("hint.run")!, parsed("hint --rapid=false").args).ok, true);
  assert.equal(error_of("open --nope=1"), 'unknown param "nope" for open');
});

test("flags that do not exist are errors, bare option words are text", () => {
  assert.match(error_of("hint --nope"), /unknown flag "--nope" for hint/);
  assert.match(error_of("hint -z"), /unknown flag "-z" for hint/);
  assert.match(error_of("hint -rb"), /unknown flag "-rb"/);
  assert.match(error_of("hint --no-rapid"), /unknown flag "--no-rapid"/);
  assert.match(error_of("open -std c++"), /unknown flag "-std"/);
  assert.deepEqual(parsed("open tab").args, { url: "tab" });
  assert.deepEqual(parsed("open where=tab").args, { url: "where=tab" });
  assert.equal(error_of("hint rapid"), '"rapid" is not a flag or subject of hint');
});

test("a hyphen in a flag reads as an underscore in the name", () => {
  const word_end = { find: () => ({ id: "caret.move", params: [{ name: "unit", type: "enum" as const, values: ["char", "word_end"] }] }) };
  const result = parse_command_line(word_end, "caret.move --word-end");
  assert.deepEqual(result.kind === "invocation" && result.invocation.args, { unit: "word_end" });
});

test("a flag set twice is an error", () => {
  assert.equal(error_of("open -t -w x"), "where is set twice");
  assert.equal(error_of("open --tab --where=window x"), "where is set twice");
  assert.equal(error_of("hint -r --rapid"), "rapid is set twice");
});

test("the main value starts at the first unmarked word and runs to the end of the line", () => {
  assert.deepEqual(parsed("search arch rust").args, { engine: "arch", query: "rust" });
  assert.deepEqual(parsed("search arch rust lifetimes").args, { engine: "arch", query: "rust lifetimes" });
  assert.deepEqual(parsed("search --engine=arch pacman mirrors").args, { engine: "arch", query: "pacman mirrors" });
  assert.equal(error_of("hint nope"), '"nope" is not a flag or subject of hint');
});

test("flags work before the subject and are text after it", () => {
  assert.deepEqual(parsed("search -t arch pacman").args, { where: "tab", engine: "arch", query: "pacman" });
  assert.deepEqual(parsed("search arch -t pacman").args, { engine: "arch", where: "tab", query: "pacman" });
  assert.deepEqual(parsed("search arch pacman -t").args, { engine: "arch", query: "pacman -t" });
  assert.deepEqual(parsed("search arch pacman --where=tab").args, { engine: "arch", query: "pacman --where=tab" });
  assert.deepEqual(parsed("open https://a.example -b").args, { url: "https://a.example -b" });
  assert.deepEqual(parsed("search arch a -h").args, { engine: "arch", query: "a -h" });
});

test("-- ends the flags, so a dash word is the subject", () => {
  assert.deepEqual(parsed("search -- -std c++").args, { query: "-std c++" });
  assert.deepEqual(parsed("search arch -- -std c++").args, { engine: "arch", query: "-std c++" });
  assert.deepEqual(parsed("open -t -- -b").args, { where: "tab", url: "-b" });
  assert.deepEqual(parsed("open -- -h").args, { url: "-h" });
});

test("the engine is the first bare word and only when it names an engine", () => {
  assert.deepEqual(parsed("search arch pacman").args, { engine: "arch", query: "pacman" });
  assert.deepEqual(parsed("search -w arch pacman").args, { where: "window", engine: "arch", query: "pacman" });
  assert.deepEqual(parsed("search pacman").args, { query: "pacman" });
  assert.deepEqual(parsed("search arch", {}).args, { query: "arch" });
  assert.deepEqual(parsed("search ddg -t").args, { engine: "ddg", where: "tab" });
  assert.deepEqual(parsed("search ddg arch linux").args, { engine: "ddg", query: "arch linux" });
  assert.deepEqual(parsed("search --engine=ddg arch linux").args, { engine: "ddg", query: "arch linux" });
  assert.deepEqual(parsed("search -- arch maps").args, { query: "arch maps" });
  assert.deepEqual(parsed(`search "arch" maps`).args, { query: "arch maps" });
});

test("an engine name may hold dots or any other characters", () => {
  const sources = { search_engines: ["github.repo.issues"], containers: [] };
  assert.deepEqual(parsed("search github.repo.issues bug", sources).args, { engine: "github.repo.issues", query: "bug" });
});

test("quoted and unquoted words mix in the main value", () => {
  assert.deepEqual(parsed(`search arch "pacman mirrors"`).args, { engine: "arch", query: "pacman mirrors" });
  assert.deepEqual(parsed(`search arch pacman "mirror list" now`).args, { engine: "arch", query: "pacman mirror list now" });
  assert.deepEqual(parsed(`search arch "-t" x`).args, { engine: "arch", query: "-t x" });
  assert.deepEqual(parsed(`search arch --query="arch linux"`).args, { engine: "arch", query: "arch linux" });
  assert.equal(error_of(`search arch --query=a b`), "query is set twice, quote text that has spaces");
});

test("a source cannot join other words", () => {
  assert.deepEqual(parsed("search arch @selection").args, { engine: "arch", query: { from: "selection" } });
  assert.match(error_of("search arch @selection now"), /"@selection" is a source and cannot join other words/);
  assert.deepEqual(parsed("search arch now @selection").args, { engine: "arch", query: "now @selection" });
});

test("a command whose only argument is a required value takes it as the bare subject", () => {
  assert.deepEqual(parsed("mode ignore").args, { mode: "ignore" });
  assert.deepEqual(parsed("mode --ignore").args, { mode: "ignore" });
  assert.deepEqual(parsed("mode --mode=normal").args, { mode: "normal" });
  assert.equal(error_of("mode nope"), '"nope" is not a flag or subject of mode');
  assert.equal(error_of("mode ignore normal"), '"normal" is not a flag or subject of mode');
});

test("a command with one number param takes a bare number, negative included", () => {
  assert.deepEqual(parsed("tab.goto 1").args, { index: "1" });
  assert.deepEqual(parsed("tab.move -1").args, { offset: "-1" });
  assert.deepEqual(parsed("zoom.set 1.5").args, { level: "1.5" });
  assert.deepEqual(parsed("zoom.set -0.5").args, { level: "-0.5" });
  assert.deepEqual(parsed("tab.move -5").args, { offset: "-5" });
  assert.deepEqual(check_args(registry.get("tab.move")!, parsed("tab.move -1").args), { ok: true, args: { offset: -1 } });
});

test("a negative number is a value even next to a switch", () => {
  assert.deepEqual(parsed("tab.shift --wrap -1").args, { wrap: true, offset: "-1" });
  assert.deepEqual(parsed("tab.shift -1 --wrap").args, { offset: "-1", wrap: true });
});

test("bare number edge cases", () => {
  assert.match(error_of("scroll.by 5"), /"5" is not a flag or subject of scroll\.by, a bare number needs a command with one number param/);
  assert.deepEqual(parsed("scroll.by --dx=5 --dy=-5").args, { dx: "5", dy: "-5" });
  assert.equal(error_of("tab.move 1 2"), '"2" is not a flag or subject of tab.move');
  assert.equal(error_of("tab.move --offset=1 2"), '"2" is not a flag or subject of tab.move');
  assert.equal(error_of(`tab.move "1"`), '"1" is not a flag or subject of tab.move');
  assert.match(error_of("tab.move -x"), /unknown flag "-x"/);
  assert.match(error_of("tab.move 1.2.3"), /"1.2.3" is not a flag or subject/);
  assert.equal(check_args(registry.get("tab.move")!, parsed("tab.move 1.5").args).ok, false);
});

test("a number goes to the main value when the command has no number param", () => {
  assert.deepEqual(parsed("open 5 text").args, { url: "5 text" });
  assert.match(error_of("open -5"), /unknown flag "-5"/);
  assert.deepEqual(parsed("open -- -5").args, { url: "-5" });
});

test("a quoted word is always free text, never a flag, engine or name=value", () => {
  assert.deepEqual(parsed(`search arch "arch"`).args, { engine: "arch", query: "arch" });
  assert.deepEqual(parsed(`open '-b'`).args, { url: "-b" });
  assert.deepEqual(parsed(`open "--tab"`).args, { url: "--tab" });
  assert.deepEqual(parsed(`open "where=tab"`).args, { url: "where=tab" });
  assert.deepEqual(parsed(`open '--url=x'`).args, { url: "--url=x" });
  assert.deepEqual(parsed(`open -t '--url=x y'`).args, { where: "tab", url: "--url=x y" });
  assert.equal(error_of(`hint "--rapid"`), '"--rapid" is not a flag or subject of hint');
});

test("unknown params, repeated params and unknown commands are errors", () => {
  assert.equal(error_of("open --nope=1"), 'unknown param "nope" for open');
  assert.equal(error_of("open --tab -w"), "where is set twice");
  assert.equal(error_of("open --where=tab --where=window"), "where is set twice");
});

test("@source words are context sources, unquoted only", () => {
  assert.deepEqual(parsed("open @current_url").args, { url: { from: "current_url" } });
  assert.deepEqual(parsed("open --url=@selection").args, { url: { from: "selection" } });
  assert.deepEqual(parsed("open --url=@clipboard -t").args, { url: { from: "clipboard" }, where: "tab" });
  assert.deepEqual(parsed("open -t -c=@selection x").args, { where: "tab", container: { from: "selection" }, url: "x" });
  assert.deepEqual(parsed(`open "@selection"`).args, { url: "@selection" });
  assert.deepEqual(parsed(`open --url="@selection"`).args, { url: "@selection" });
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
  assert.deepEqual(parsed(`open --where=tab "two words"`).args, { where: "tab", url: "two words" });
  assert.deepEqual(parsed(`open --url="my page" --where=tab`).args, { url: "my page", where: "tab" });
  assert.deepEqual(parsed(`open --url=""`).args, { url: "" });
  assert.equal(error_of(`open "oops`), 'unterminated " quote');
  assert.equal(error_of(`open 'oops`), "unterminated ' quote");
  assert.match(error_of("open oops\\"), /backslash/);
});

test("-h and --help return the usage line, quoted or not", () => {
  assert.equal(parse_command_line(registry, "open -h").kind, "help");
  assert.equal(parse_command_line(registry, "tab.close --help").kind, "help");
  assert.equal(parse_command_line(registry, "open -t --help").kind, "help");
  assert.deepEqual(parsed(`open "-h"`).args, { url: "-h" });
  assert.deepEqual(parsed(`open -- -h`).args, { url: "-h" });
});

test("when conditions are the validator's job", () => {
  const invocation = parsed("open -c=Work");
  const result = check_args(registry.get(invocation.id)!, invocation.args, search_sources);
  assert.deepEqual(result.ok, false);
  assert.equal(result.ok ? "" : result.error, "container needs where tab, background or window");
});

test("the usage line lists flags in param order, the engine first and the subject last", () => {
  assert.equal(usage_line(registry.get("hint.run")!), "hint [-b|--background|-w|--window] [-i|--inputs|-u|--custom] [--selector=<selector>] [-r|--rapid]");
  assert.equal(
    usage_line(registry.get("open.search")!),
    "search [<engine>] [-t|--tab|-b|--background|-w|--window] query",
  );
  assert.equal(usage_line(registry.get("open.url")!), "open [-c=<container>|--container=<container>] [-t|--tab|-b|--background|-w|--window] url");
  assert.equal(usage_line(registry.get("mode.set")!), "mode normal|insert|ignore");
  assert.equal(usage_line(registry.get("tab.shift")!), "tab.shift [-w|--wrap] offset");
});

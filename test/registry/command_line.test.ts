import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args, create_registry, parse_command_line, tokenize } from "../../src/shared/registry/index.ts";
import { design_registry, search_sources } from "./fixtures.ts";

const registry = design_registry();

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
  const invocation = parsed("search -b arch rust lifetimes");
  assert.deepEqual(invocation, {
    id: "open.search",
    args: { engine: "arch", query: "rust lifetimes", where: "background" },
  });
  assert.equal(check_args(registry.get(invocation.id)!, invocation.args, search_sources).ok, true);
});

test("first word is a name, an alias or a full id", () => {
  assert.equal(parsed("search arch x").id, "open.search");
  assert.equal(parsed("s arch x").id, "open.search");
  assert.equal(parsed("open.search arch x").id, "open.search");
  assert.deepEqual(parsed("tab.close"), { id: "tab.close" });
  assert.equal(error_of("nope"), 'unknown command "nope"');
  assert.equal(error_of("   "), "empty command line");
});

test("flag forms: --long value, --long=value, -s value", () => {
  assert.deepEqual(parsed("s --where new_tab arch q").args, { engine: "arch", query: "q", where: "new_tab" });
  assert.deepEqual(parsed("s --where=new_tab arch q").args, { engine: "arch", query: "q", where: "new_tab" });
  assert.deepEqual(parsed("s -w new_tab arch q").args, { engine: "arch", query: "q", where: "new_tab" });
  assert.deepEqual(parsed("s arch q -c Work").args, { engine: "arch", query: "q", container: "Work" });
});

test("preset long forms", () => {
  assert.deepEqual(parsed("s --background arch q").args, { engine: "arch", query: "q", where: "background" });
  assert.deepEqual(parsed("s --tab arch q").args, { engine: "arch", query: "q", where: "new_tab" });
});

test("combined short switches", () => {
  assert.deepEqual(parsed("s -bc Work arch q").args, { engine: "arch", query: "q", where: "background", container: "Work" });
  assert.match(error_of("s -wb new_tab arch"), /-w needs a value/);
  assert.match(error_of("s -bx arch"), /unknown flag -x/);
});

test("-- ends the flags", () => {
  assert.deepEqual(parsed("s arch -- -b is a dash").args, { engine: "arch", query: "-b is a dash" });
  assert.deepEqual(parsed("s -b arch -- -x").args, { engine: "arch", query: "-x", where: "background" });
});

test("a quoted dash word is a word, not a flag", () => {
  assert.deepEqual(parsed(`s arch "-b" '-t'`).args, { engine: "arch", query: "-b -t" });
});

test("a negative number is a word when no flag has that letter", () => {
  assert.deepEqual(parsed("s arch -5").args, { engine: "arch", query: "-5" });
});

test("shell quoting", () => {
  assert.deepEqual(tokenize(`a "b c" 'd e' f\\ g "h\\"i" 'j\\k' l"m n"o`), [
    { text: "a", literal: false },
    { text: "b c", literal: true },
    { text: "d e", literal: true },
    { text: "f g", literal: false },
    { text: 'h"i', literal: true },
    { text: "j\\k", literal: true },
    { text: "lm no", literal: false },
  ]);
  assert.deepEqual(parsed(`s -c "My Work" -w new_tab arch "two words"`).args, {
    engine: "arch",
    query: "two words",
    where: "new_tab",
    container: "My Work",
  });
  assert.deepEqual(parsed(`s --container="My Work" arch q`).args?.["container"], "My Work");
  assert.equal(error_of(`s arch "oops`), 'unterminated " quote');
  assert.equal(error_of(`s arch 'oops`), "unterminated ' quote");
  assert.match(error_of("s arch oops\\"), /backslash/);
});

test("two flags that set the same param are an error", () => {
  assert.equal(error_of("s -b -t arch q"), "-b and -t both set where");
  assert.equal(error_of("s -b --where new_tab arch q"), "-b and --where both set where");
  assert.equal(error_of("s --tab -w current arch q"), "--tab and -w both set where");
  assert.equal(error_of("s -w a -w b arch q"), "-w and -w both set where");
});

test("flag errors", () => {
  assert.equal(error_of("s --nope arch"), "unknown flag --nope");
  assert.equal(error_of("s -w"), "-w needs a value");
  assert.equal(error_of("s --where"), "--where needs a value");
  assert.equal(error_of("s --background=1 arch"), "--background takes no value");
});

test("too many words without a rest param", () => {
  assert.equal(error_of("tab.close left right"), 'too many words, "right" has no param');
  assert.deepEqual(parsed("tab.close left").args, { focus: "left" });
});

test("switches: --private, --no-private, =value", () => {
  const switches = create_registry();
  switches.define("win.open", {
    label: "L",
    intent: "I.",
    runs_in: "background",
    run: () => {},
    params: [{ name: "private", type: "bool", flag: { short: "p" } }],
  });
  const result = (text: string) => parse_command_line(switches, text);
  assert.deepEqual(result("win.open -p"), { kind: "invocation", invocation: { id: "win.open", args: { private: true } } });
  assert.deepEqual(result("win.open --private"), { kind: "invocation", invocation: { id: "win.open", args: { private: true } } });
  assert.deepEqual(result("win.open --no-private"), { kind: "invocation", invocation: { id: "win.open", args: { private: false } } });
  assert.deepEqual(result("win.open --private=false"), { kind: "invocation", invocation: { id: "win.open", args: { private: false } } });
  assert.deepEqual(result("win.open --private --no-private"), { kind: "error", error: "--private and --no-private both set private" });
  assert.deepEqual(result("win.open --private=maybe"), { kind: "error", error: '--private takes true or false, got "maybe"' });
  assert.deepEqual(result("win.open --no-private=1"), { kind: "error", error: "--no-private takes no value" });
});

test("-h and --help return the usage line", () => {
  const usage = "search [-b|--background] [-t|--tab] [-w|--where <where>] [-c|--container <container>] <engine> <query...>";
  assert.deepEqual(parse_command_line(registry, "search -h"), { kind: "help", usage });
  assert.deepEqual(parse_command_line(registry, "s arch --help"), { kind: "help", usage });
  assert.deepEqual(parse_command_line(registry, "tab.close --help"), { kind: "help", usage: "tab.close [<focus>]" });
});

test("when conditions are the validator's job", () => {
  const invocation = parsed("s -c Work arch q");
  const result = check_args(registry.get(invocation.id)!, invocation.args, search_sources);
  assert.deepEqual(result.ok, false);
  assert.equal(result.ok ? "" : result.error, "--container needs --where new_tab, background or new_window");
});

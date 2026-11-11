import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_binding } from "../../src/shared/registry/parse_binding.ts";
import { registry as real_registry } from "../../src/shared/registry/builtin.ts";
import "../../src/background/command_modules.ts";
import "../../src/commands/hint.ts";
import { grammar_registry } from "./grammar_registry.ts";

const registry = grammar_registry();

function binding_of(text: string) {
  const result = parse_binding(registry, text);
  assert.equal(result.kind, "binding", JSON.stringify(result));
  return result.kind === "binding" ? result.binding : assert.fail();
}
function error_of(text: string): string {
  const result = parse_binding(registry, text);
  assert.equal(result.kind, "error", JSON.stringify(result));
  return result.kind === "error" ? result.error : "";
}

test("a command string becomes the id and args the extension stores", () => {
  assert.deepEqual(binding_of("tab.next"), { id: "tab.next" });
  assert.deepEqual(binding_of("open -t https://github.com"), { id: "open.url", args: { where: "tab", url: "https://github.com" } });
  assert.deepEqual(binding_of("hint -r -b --links"), { id: "hint.run", args: { rapid: true, action: "background", filter: "links" } });
  assert.deepEqual(binding_of(`search --engine=arch "rust lifetimes"`).args, { engine: "arch", query: "rust lifetimes" });
});

test("a name, an alias and a full id reach the same id", () => {
  assert.equal(binding_of("open").id, "open.url");
  assert.equal(binding_of("o").id, "open.url");
  assert.equal(binding_of("open.url").id, "open.url");
});

test("a leading colon asks for the command line, and the main param is the one to type", () => {
  assert.deepEqual(binding_of(":open -t"), { id: "open.url", args: { where: "tab" }, prompt: { param: "url" } });
  assert.deepEqual(binding_of("  :open"), { id: "open.url", prompt: { param: "url" } });
  assert.deepEqual(binding_of(":hint -r").prompt, { param: "action" });
});

test("a leading colon moves the @source into the prefill", () => {
  assert.deepEqual(binding_of(":open -t @current_url"), {
    id: "open.url",
    args: { where: "tab" },
    prompt: { param: "url", prefill: { from: "current_url" } },
  });
  assert.deepEqual(binding_of(":open.url --url=@selection"), { id: "open.url", prompt: { param: "url", prefill: { from: "selection" } } });
});

test("without a colon an @source stays in the args for the key press to fill", () => {
  assert.deepEqual(binding_of("open @clipboard"), { id: "open.url", args: { url: { from: "clipboard" } } });
});

test("a colon needs a command with a param", () => {
  assert.equal(error_of(":tab.next"), "tab.next has no param to type, drop the leading \":\"");
});

test("grammar errors pass through, and help is not a binding", () => {
  assert.equal(error_of("open --nope=1"), 'unknown param "nope" for open');
  assert.equal(error_of(":nope"), 'unknown command "nope"');
  assert.equal(error_of("open -t -w"), "where is set twice");
  assert.equal(error_of(""), "empty command line");
  assert.match(error_of("open --help"), /not a binding/);
});

test("runtime lists reach the grammar", () => {
  const sources = { search_engines: ["arch", "ddg"] };
  const result = parse_binding(registry, "search --engine=ddg arch linux", sources);
  assert.deepEqual(result.kind === "binding" && result.binding.args, { engine: "ddg", query: "arch linux" });
  const picked = parse_binding(registry, ":search arch pacman", sources);
  assert.deepEqual(picked.kind === "binding" && picked.binding, {
    id: "open.search",
    args: { engine: "arch", query: "pacman" },
    prompt: { param: "query" },
  });
});

test("a bare number binds the only number param, negative included", () => {
  assert.deepEqual(binding_of("tab.slide -1"), { id: "tab.slide", args: { offset: "-1" } });
  assert.deepEqual(binding_of("tab.goto 1"), { id: "tab.goto", args: { index: "1" } });
  assert.deepEqual(binding_of(":tab.slide -1").prompt, { param: "offset" });
});

test("a binding keeps the double quotes of a verbatim selector", () => {
  const result = parse_binding(real_registry, `hint --custom a[href="x"]`);
  assert.deepEqual(result.kind === "binding" ? result.binding : result, { id: "hint.run", args: { filter: "custom", selector: 'a[href="x"]' } });
});

test("tab.move reads a bare number as a place and --offset as a move", () => {
  assert.deepEqual(parse_binding(real_registry, "tab.move -1"), { kind: "binding", binding: { id: "tab.move", args: { tab: "-1" } } });
  assert.deepEqual(parse_binding(real_registry, "tab.move --offset=-1"), { kind: "binding", binding: { id: "tab.move", args: { offset: "-1" } } });
});

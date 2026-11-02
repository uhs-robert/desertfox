import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_binding } from "../../src/shared/registry/parse_binding.ts";
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
  assert.deepEqual(binding_of("open tab https://github.com"), { id: "open.url", args: { where: "tab", url: "https://github.com" } });
  assert.deepEqual(binding_of("hint rapid background links"), { id: "hint.run", args: { rapid: true, action: "background", filter: "links" } });
  assert.deepEqual(binding_of(`search engine=arch "rust lifetimes"`).args, { engine: "arch", query: "rust lifetimes" });
});

test("a short name, an alias and a full id reach the same id", () => {
  assert.equal(binding_of("open").id, "open.url");
  assert.equal(binding_of("o").id, "open.url");
  assert.equal(binding_of("open.url").id, "open.url");
});

test("a leading colon asks for the command line, and the main param is the one to type", () => {
  assert.deepEqual(binding_of(":open tab"), { id: "open.url", args: { where: "tab" }, prompt: { param: "url" } });
  assert.deepEqual(binding_of("  :open"), { id: "open.url", prompt: { param: "url" } });
  assert.deepEqual(binding_of(":hint rapid").prompt, { param: "action" });
});

test("a leading colon moves the @source into the prefill", () => {
  assert.deepEqual(binding_of(":open tab @current_url"), {
    id: "open.url",
    args: { where: "tab" },
    prompt: { param: "url", prefill: { from: "current_url" } },
  });
  assert.deepEqual(binding_of(":open.url url=@selection"), { id: "open.url", prompt: { param: "url", prefill: { from: "selection" } } });
});

test("without a colon an @source stays in the args for the key press to fill", () => {
  assert.deepEqual(binding_of("open @clipboard"), { id: "open.url", args: { url: { from: "clipboard" } } });
});

test("a colon needs a command with a param", () => {
  assert.equal(error_of(":tab.next"), "tab.next has no param to type, drop the leading \":\"");
});

test("grammar errors pass through, and help is not a binding", () => {
  assert.equal(error_of("open nope=1"), 'unknown param "nope" for open');
  assert.equal(error_of(":nope"), 'unknown command "nope"');
  assert.equal(error_of("open tab window"), "where is set twice");
  assert.equal(error_of(""), "empty command line");
  assert.match(error_of("open --help"), /not a binding/);
});

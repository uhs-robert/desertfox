import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compile_config } from "../src/background/compile.ts";
import { plan_set_value } from "../src/commands/settings.ts";
import { empty_config } from "../src/background/config_load.ts";
import "../src/background/command_modules.ts";
import { ConfigErrors } from "../src/shared/config_build/errors.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { build_commands_file } from "../src/shared/registry/index.ts";
import { build_config } from "../tools/build-config/build_config.ts";
import { MAX_BIND_STEPS } from "../src/shared/table_constants.ts";
import { make_tmp_dir } from "./support/tmp_dir.ts";

const commands = build_commands_file(registry).commands;

// A config dir holding one site row with the given `bind` table text.
function build_with_bind(bind: string) {
  const dir = make_tmp_dir("desertfox-bind-");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.toml"), `[[site_rules]]\nsite = "https://a.test/*"\nbind = { ${bind} }\n`);
  return build_config(dir, commands);
}
const problems_of = (bind: string): string[] => {
  try {
    build_with_bind(bind);
  } catch (error) {
    if (error instanceof ConfigErrors) return error.problems;
    throw error;
  }
  return [];
};
const bind_of = (bind: string) => (build_with_bind(bind).settings.site_rules?.[0] as { bind: Record<string, unknown> }).bind;

test("a site bind takes a command string, a list, a run table and an invocation table", () => {
  const bind = bind_of('a = "tab.prev", b = ["tab.prev", "tab.next"], c = { run = ["tab.prev", "tab.next"], label = "Both", intent = "Prev, then next tab" }, d = { run = "tab.next", label = "Next" }, e = { id = "tab.next" }');
  assert.deepEqual(bind.a, { id: "tab.prev" });
  assert.deepEqual(bind.b, [{ id: "tab.prev" }, { id: "tab.next" }]);
  assert.deepEqual(bind.c, [{ id: "tab.prev", label: "Both", intent: "Prev, then next tab" }, { id: "tab.next" }]);
  assert.deepEqual(bind.d, { id: "tab.next", label: "Next" });
  assert.deepEqual(bind.e, { id: "tab.next" });
});

test("a bad step of a chain names the key and the step, and a good chain has no problem", () => {
  const text = problems_of('a = ["tab.prev", "no.such.command"], b = ["tab.prev", "tab.next"], c = { run = "tab.next", label = "" }').join("\n");
  assert.match(text, /bind "a" of "https:\/\/a.test\/\*"/);
  assert.match(text, /bind "c" of "https:\/\/a.test\/\*": a label must not be empty/);
  assert.doesNotMatch(text, /bind "b"/);
});

test("a chain step that waits for a key press is refused, and a macro with a fixed register passes", () => {
  const text = problems_of('a = ["tab.prev", { id = "mark.add" }], q = "macro.play a"').join("\n");
  assert.match(text, /bind "a" of .*cannot wait for a key press/);
  assert.doesNotMatch(text, /bind "q"/);
  assert.deepEqual(bind_of('q = "macro.play a"').q, { id: "macro.play", args: { reg: "a" } });
});

test(`a chain of ${MAX_BIND_STEPS} steps passes and one more is a settings problem`, () => {
  const chain = (count: number) => `a = [${Array(count).fill('"tab.prev"').join(", ")}]`;
  assert.deepEqual(problems_of(chain(MAX_BIND_STEPS)), []);
  assert.match(problems_of(chain(MAX_BIND_STEPS + 1)).join("\n"), /more than 20 steps/);
});

const compile = (bind: Record<string, unknown>) => compile_config({ config: { ...empty_config(), settings: { site_rules: [{ site: "https://a.test/*", bind }] } as never }, default_keymap: {}, get_command: (id) => registry.get(id), enum_sources: {} });

test("a chain compiles to one leaf with a step per invocation, in order, labeled from the first step", () => {
  const { compiled, warnings } = compile({ a: [{ id: "tab.prev", label: "Top then next" }, { id: "tab.next" }], b: [{ id: "tab.prev" }, { id: "tab.next" }] });
  assert.deepEqual(warnings, []);
  const { a, b } = compiled.site_rules![0]!.bind!;
  assert.deepEqual(a!.leaf.steps.map((step) => step.invocation.id), ["tab.prev", "tab.next"]);
  assert.equal(a!.leaf.label, "Top then next");
  assert.equal(b!.leaf.label, "Previous tab");
  assert.equal("label" in a!.leaf.steps[0]!.invocation, false);
});

test("the compiler skips a chain over the step cap and a bind that is still text", () => {
  const { compiled, warnings } = compile({ a: Array(MAX_BIND_STEPS + 1).fill({ id: "tab.prev" }), b: "tab.prev", c: [{ id: "tab.prev" }, { id: "no.such" }], d: { id: "tab.prev" } });
  assert.deepEqual(Object.keys(compiled.site_rules![0]!.bind!), ["d"]);
  assert.ok(warnings.some((warning) => warning.includes('bind "a": more than 20 steps')), warnings.join("\n"));
  assert.ok(warnings.some((warning) => warning.includes('bind "b": the binding was not resolved')), warnings.join("\n"));
  assert.ok(warnings.some((warning) => warning.includes('"c"') && warning.includes("no.such")), warnings.join("\n"));
});

test("a failing step in the compile check drops the whole chain", () => {
  const { compiled, warnings } = compile({ a: [{ id: "tab.prev" }, { id: "page.send_key", args: { key: "ArrowDown" } }], b: [{ id: "tab.prev" }] });
  assert.deepEqual(Object.keys(compiled.site_rules![0]!.bind!), ["b"]);
  assert.ok(warnings.some((warning) => warning.startsWith('site_rules: skipped bind "a" of "https://a.test/*"')), warnings.join("\n"));
});

test("a label or intent with a control character is a build error in each table form", () => {
  const text = problems_of('a = { run = "tab.next", label = "x\\ny" }, b = { id = "tab.next", label = "x\\ny" }, c = { id = "tab.next", intent = "" }, d = { id = "tab.next", label = "Fine" }').join("\n");
  assert.match(text, /bind "a" .*a label must not hold control characters/);
  assert.match(text, /bind "b" .*a label must not hold control characters/);
  assert.match(text, /bind "c" .*an intent must not be empty/);
  assert.doesNotMatch(text, /bind "d"/);
});

test("a text bind set from the browser compiles and runs like a file bind", () => {
  const typed = { a: "tab.next", b: ["tab.prev", "tab.next"], c: { run: "tab.next", label: "Next" }, d: "no.such.command" };
  const config = empty_config();
  const plan = plan_set_value("site_rules", [{ site: "https://a.test/*", bind: typed }], "saved", { saved: {}, temp: {} }, config);
  assert.equal(plan.toast?.kind, "success");
  const edited = { ...config, settings: { ...config.settings, ...plan.next!.saved } };
  const { compiled, warnings } = compile_config({ config: edited, default_keymap: {}, get_command: (id) => registry.get(id), registry, enum_sources: {} });
  const bind = compiled.site_rules![0]!.bind!;
  assert.deepEqual(Object.keys(bind), ["a", "b", "c"]);
  assert.deepEqual(bind.b!.leaf.steps.map((step) => step.invocation.id), ["tab.prev", "tab.next"]);
  assert.equal(bind.c!.leaf.label, "Next");
  assert.equal(warnings.filter((warning) => warning.includes('bind "d"')).length, 1, warnings.join("\n"));
});

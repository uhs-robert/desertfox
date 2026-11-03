import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { create_registry, description_problem, DefineError, first_sentence, registry, summary_problem, summary_problems } from "../../src/shared/registry/index.ts";
import type { CommandInput } from "../../src/shared/registry/index.ts";

test("every built-in command has a good summary and a described flag", () => {
  const commands = registry.list();
  assert.ok(commands.length > 50);
  const ids = commands.map((command) => command.id);
  const problems = commands.flatMap((command) => summary_problems(command, ids).map((problem) => `${command.id} ${problem}`));
  assert.deepEqual(problems, []);
});

test("first_sentence", () => {
  assert.equal(first_sentence("Close the tab."), "Close the tab.");
  assert.equal(first_sentence("Close the tab. It keeps the pinned ones."), "Close the tab.");
  assert.equal(first_sentence("Zoom by an amount of 0.1 or more. A count repeats it."), "Zoom by an amount of 0.1 or more.");
  assert.equal(first_sentence("Set zoom to 1. The limit is 5."), "Set zoom to 1.");
  assert.equal(first_sentence("Close the tab"), "Close the tab");
  assert.equal(first_sentence("  Close the tab.  "), "Close the tab.");
});

test("summary_problem rejects what the list cannot show", () => {
  assert.equal(summary_problem("Close the tab."), null);
  assert.match(summary_problem("") ?? "", /empty/);
  assert.match(summary_problem("Close the tab") ?? "", /period/);
  assert.match(summary_problem(`Close ${"the tab ".repeat(10)}.`) ?? "", /limit is 60/);
  assert.match(summary_problem("The tab closes.") ?? "", /verb/);
  assert.match(summary_problem("close the tab.") ?? "", /verb/);
  assert.match(summary_problem("Close it like tab.close.", ["tab.close"]) ?? "", /compare/);
  assert.match(summary_problem("Run tab.close twice.", ["tab.close"]) ?? "", /names the command tab.close/);
});

test("summary_problems flags a bad first sentence and a missing description", () => {
  const command = { id: "x.y", intent: "Move it. More detail follows.", params: [{ name: "big", type: "bool" as const }] };
  assert.deepEqual(summary_problems(command), ["params.big: needs a description"]);
  assert.deepEqual(summary_problems({ ...command, intent: "It moves. More." }), ['intent: must start with a verb, not "It"', "params.big: needs a description"]);
  const fixed = { ...command, params: [{ name: "big", type: "bool" as const, description: "Move far." }] };
  assert.deepEqual(summary_problems(fixed), []);
});

test("an enum describes each value that has a flag, and the default needs none", () => {
  const params = [{ name: "side", type: "enum" as const, values: ["none", "left", "right"], default: "none", description: { left: "Close the left." } }];
  assert.deepEqual(summary_problems({ id: "x.y", intent: "Close it.", params }), ["params.side.right: needs a description"]);
});

test("define accepts several sentences and rejects an empty or multi-line intent", () => {
  const base: CommandInput = { label: "L", intent: "Close it. It keeps pinned tabs.", runs_in: "background", run: () => {} };
  assert.doesNotThrow(() => create_registry().define("x.y", base));
  assert.throws(() => create_registry().define("x.y", { ...base, intent: " " }), DefineError);
  assert.throws(() => create_registry().define("x.y", { ...base, intent: "Close it.\nKeep pinned." }), /one line/);
});

test("define rejects a bad flag description", () => {
  const base: CommandInput = { label: "L", intent: "Close it.", runs_in: "background", run: () => {} };
  const with_param = (param: object): CommandInput => ({ ...base, params: [{ name: "p", type: "bool", ...param }] });
  assert.doesNotThrow(() => create_registry().define("x.y", with_param({ description: "Skip the cache." })));
  for (const bad of ["", "skip the cache.", "Skip the cache", "Skip it. Twice.", "The cache is skipped."]) {
    assert.throws(() => create_registry().define("x.y", with_param({ description: bad })), (e: unknown) => e instanceof DefineError && /params\[0\]\.description/.test(e.message), bad);
  }
  assert.equal(description_problem("Skip it. Twice."), "must be one sentence");
  const enum_param = { name: "p", type: "enum" as const, values: ["a", "b"], default: "a" };
  assert.throws(() => create_registry().define("x.y", { ...base, params: [{ ...enum_param, description: "Skip it." }] }), /map/);
  assert.throws(() => create_registry().define("x.y", { ...base, params: [{ ...enum_param, description: { c: "Skip it." } }] }), /not one of the values/);
  assert.throws(() => create_registry().define("x.y", { ...base, params: [{ ...enum_param, description: { a: "Skip it." } }] }), /default/);
  assert.doesNotThrow(() => create_registry().define("x.y", { ...base, params: [{ ...enum_param, description: { b: "Skip it." } }] }));
});

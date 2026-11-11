import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args, create_registry, DefineError } from "../../src/shared/registry/index.ts";
import type { CommandInput } from "../../src/shared/registry/index.ts";

function input_with(params: unknown[]): CommandInput {
  return { name: "demo", label: "Demo", intent: "Do a thing.", runs_in: "background", run: () => {}, params: params as never };
}
const action = { name: "action", type: "string", values: ["a", "b", "c"], strict: true };
const arms = [
  { pattern: "^(one|two)$", when: { action: ["a"] } },
  { pattern: "^\\d+$", when: { action: ["b"] } },
];
const value = (extra: Record<string, unknown> = {}) => ({ name: "value", type: "string", main: true, pattern_arms: arms, when: { action: ["a", "b"] }, ...extra });
const demo = () => {
  const registry = create_registry();
  registry.define("demo.run", input_with([action, value()]));
  return registry.get("demo.run")!;
};

test("each action takes the value set of its own arm, whatever order the params come in", () => {
  const command = demo();
  assert.equal(check_args(command, { action: "a", value: "one" }).ok, true);
  assert.equal(check_args(command, { action: "a", value: "5" }).ok, false);
  assert.equal(check_args(command, { action: "b", value: "5" }).ok, true);
  assert.equal(check_args(command, { action: "b", value: "one" }).ok, false);
  const refused = check_args(command, { action: "a", value: "three" });
  assert.equal(refused.ok ? "" : refused.error, 'value expects text matching ^(one|two)$, got "three"');
});

test("an action with no arm falls back to the plain pattern, or to no rule", () => {
  const registry = create_registry();
  registry.define("demo.run", input_with([action, value({ pattern: "^x$", when: { action: ["a", "b", "c"] } })]));
  const command = registry.get("demo.run")!;
  assert.equal(check_args(command, { action: "c", value: "x" }).ok, true);
  assert.equal(check_args(command, { action: "c", value: "y" }).ok, false);
  assert.equal(check_args(command, { action: "a", value: "x" }).ok, false);
});

test("define refuses a bad arm", () => {
  const define = (arm: unknown, type = "string") => create_registry().define("demo.run", input_with([action, { ...value(), type, pattern_arms: [arm] }]));
  assert.throws(() => define({ pattern: "(", when: { action: ["a"] } }), DefineError);
  assert.throws(() => define({ pattern: "x", when: { nope: ["a"] } }), DefineError);
  assert.throws(() => define({ pattern: "x", when: { action: ["z"] } }), DefineError);
  assert.throws(() => define({ pattern: "x", when: {} }), DefineError);
  assert.throws(() => define({ pattern: "x", when: { action: ["a"] } }, "int"), DefineError);
});

test("a param under when with a default list is required when its when holds and no arm does", () => {
  const registry = create_registry();
  const count = { name: "count", type: "int", min: 1, default: [{ value: 1, when: { value: ["up"] } }], when: { value: ["up", "percent"] } };
  registry.define("demo.run", input_with([{ name: "value", type: "string", strict: true, values: ["up", "percent", "end"] }, count]));
  const command = registry.get("demo.run")!;
  assert.deepEqual(check_args(command, { value: "up" }), { ok: true, args: { value: "up", count: 1 } });
  assert.deepEqual(check_args(command, { value: "percent", count: 50 }), { ok: true, args: { value: "percent", count: 50 } });
  assert.deepEqual(check_args(command, { value: "percent" }), { ok: false, error: "missing <count>", missing_param: "count" });
  assert.deepEqual(check_args(command, { value: "end" }), { ok: true, args: { value: "end" } });
  assert.equal(check_args(command, { value: "end", count: 2 }).ok, false);
});

test("the plain pattern applies only where no arm holds, so an arm is never refused by it", () => {
  const registry = create_registry();
  registry.define("demo.run", input_with([action, value({ pattern: "^x$", when: { action: ["a", "b", "c"] } })]));
  const command = registry.get("demo.run")!;
  assert.equal(check_args(command, { action: "a", value: "one" }).ok, true);
  assert.equal(check_args(command, { action: "b", value: "5" }).ok, true);
});

test("an optional string left empty skips its arms like its pattern", () => {
  const registry = create_registry();
  registry.define("demo.run", input_with([action, { name: "value", type: "string", optional: true, pattern_arms: arms }]));
  const command = registry.get("demo.run")!;
  assert.equal(check_args(command, { action: "a", value: "" }).ok, true);
  assert.equal(check_args(command, { action: "a", value: "five" }).ok, false);
});

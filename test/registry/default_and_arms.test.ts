import assert from "node:assert/strict";
import { test } from "node:test";
import { build_help_model } from "../../src/help/model.ts";
import { build_commands_file, check_args, create_registry, DefineError, parse_command_line, print_command } from "../../src/shared/registry/index.ts";
import type { CommandInput } from "../../src/shared/registry/index.ts";
import { describe_default } from "../../src/shared/registry/params.ts";

const AND_ARM = { value: "background", when: { filter: ["links"], rapid: [true] } };

const hint_input = (action_default: unknown): CommandInput => ({
  name: "hint",
  label: "Hint",
  intent: "Pick an element.",
  runs_in: "background",
  run: () => {},
  params: [
    { name: "action", type: "enum", values: ["here", "background", "copy"], default: action_default, short: { background: "b", copy: "c" } },
    { name: "filter", type: "enum", values: ["clickable", "links"], default: "clickable", short: { links: "l" } },
    { name: "rapid", type: "bool" },
  ] as never,
});

const registry_with = (action_default: unknown) => {
  const registry = create_registry();
  registry.define("x.hint", hint_input(action_default));
  return registry;
};

const action_of = (registry: ReturnType<typeof registry_with>, args: Record<string, unknown>) =>
  (check_args(registry.get("x.hint")!, args) as { args: Record<string, unknown> }).args.action;

const rejects = (input: CommandInput, expected: RegExp) =>
  assert.throws(
    () => create_registry().define("x.hint", input),
    (error: unknown) => error instanceof DefineError && expected.test(error.message),
  );

test("an AND arm matches only when every param it names matches", () => {
  const registry = registry_with([AND_ARM, "here"]);
  assert.equal(action_of(registry, { filter: "links", rapid: true }), "background");
  assert.equal(action_of(registry, { filter: "links", rapid: false }), "here");
  assert.equal(action_of(registry, { filter: "clickable", rapid: true }), "here");
  assert.equal(action_of(registry, { filter: "links" }), "here");
  assert.equal(action_of(registry, { rapid: true }), "here");
});

test("arm order holds: the first arm that holds wins", () => {
  const single = { value: "copy", when: { filter: ["links"] } };
  assert.equal(action_of(registry_with([AND_ARM, single, "here"]), { filter: "links", rapid: true }), "background");
  assert.equal(action_of(registry_with([single, AND_ARM, "here"]), { filter: "links", rapid: true }), "copy");
});

test("a list of single arms, an AND arm and a plain last value resolves", () => {
  const registry = registry_with([AND_ARM, { value: "copy", when: { filter: ["clickable"], rapid: [true] } }, { value: "copy", when: { rapid: [false] } }, "here"]);
  assert.equal(action_of(registry, { filter: "links", rapid: true }), "background");
  assert.equal(action_of(registry, { filter: "clickable", rapid: true }), "copy");
  assert.equal(action_of(registry, { filter: "links", rapid: false }), "copy");
  assert.equal(action_of(registry, {}), "here");
});

test("single-param arms behave as before", () => {
  const registry = registry_with([{ value: "copy", when: { filter: ["links"] } }, "here"]);
  assert.equal(action_of(registry, { filter: "links" }), "copy");
  assert.equal(action_of(registry, { filter: "clickable" }), "here");
  assert.equal(action_of(registry, {}), "here");
});

test("help, the printer and a repeat use the same resolution", () => {
  const registry = registry_with([AND_ARM, "here"]);
  const command = registry.get("x.hint")!;
  const text = "here; background when filter is links and rapid is true";
  assert.equal(describe_default(command.params![0]!), text);
  assert.equal(build_help_model(build_commands_file(registry).commands, undefined, []).groups[0]!.commands[0]!.params[0]!.default, text);
  const printed = print_command(command, { action: "background", filter: "links", rapid: true }, {});
  const parsed = parse_command_line(registry, printed) as { invocation: { args: Record<string, unknown> } };
  assert.deepEqual(check_args(command, parsed.invocation.args), { ok: true, args: { action: "background", filter: "links", rapid: true } });
});

test("define refuses a loop through an AND arm", () => {
  const looping: CommandInput = {
    ...hint_input("here"),
    params: [
      { name: "action", type: "enum", values: ["here", "background"], default: [AND_ARM, "here"] },
      { name: "filter", type: "enum", values: ["clickable", "links"], default: "clickable" },
      { name: "rapid", type: "bool", default: [{ value: true, when: { action: ["background"] } }, false] },
    ] as never,
  };
  rejects(looping, /defaults depend on each other: action -> rapid -> action/);
});

test("define explains a bad AND arm", () => {
  rejects(hint_input([{ value: "copy", when: { filter: ["links"], action: ["copy"] } }]), /default\[0\]\.when: must not name the param itself/);
  rejects(hint_input([{ value: "copy", when: { filter: ["links"], nothing: ["x"] } }]), /default\[0\]\.when: names "nothing"/);
  rejects(hint_input([{ value: "copy", when: {} }]), /default\[0\]\.when: must name at least one other param/);
  rejects(hint_input([{ value: "copy", when: { filter: ["links"], rapid: [] } }]), /default\[0\]\.when\.rapid: must list at least one value/);
  rejects(hint_input([{ value: "copy", when: { filter: ["links", "bogus"], rapid: [true] } }]), /default\[0\]\.when\.filter: "bogus" is not one of/);
});

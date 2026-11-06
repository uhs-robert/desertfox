import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { create_completer } from "../../src/cmdline/completion/sources.ts";
import { create_word_lookup } from "../../src/cmdline/word_lookup.ts";
import { build_help_model } from "../../src/help/model.ts";
import { build_commands_file, check_args, command_meta, create_registry, DefineError, parse_command_line, print_command, usage_line } from "../../src/shared/registry/index.ts";
import type { CommandInput } from "../../src/shared/registry/index.ts";
import { default_of, describe_default } from "../../src/shared/registry/params.ts";

const DEFAULT_LIST = [{ value: "play_pause", when: { filter: ["media"] } }, { value: "tab", when: { filter: ["images"] } }, "here"];

const hint_input = (action_default: unknown = DEFAULT_LIST, filter_default: unknown = "clickable"): CommandInput => ({
  name: "hint",
  label: "Hint",
  intent: "Pick an element.",
  runs_in: "background",
  run: () => {},
  params: [
    {
      name: "action",
      type: "enum",
      values: ["here", "tab", "play_pause"],
      default: action_default,
      short: { tab: "t", play_pause: "p" },
      value_labels: { here: "here", tab: "in new tab", play_pause: "to play or pause" },
      description: { here: "Act here.", tab: "Open in a tab.", play_pause: "Play or pause." },
    },
    {
      name: "filter",
      type: "enum",
      values: ["clickable", "media", "images"],
      default: filter_default,
      short: { media: "m", images: "i" },
      value_labels: { media: "for media", images: "for images" },
      description: { media: "Label media.", images: "Label images." },
    } as never,
  ] as never,
});

function hint_registry() {
  const registry = create_registry();
  registry.define("x.hint", hint_input());
  return registry;
}

const rejects = (input: CommandInput, expected: RegExp) =>
  assert.throws(
    () => create_registry().define("x.hint", input),
    (error: unknown) => error instanceof DefineError && expected.test(error.message),
  );

test("the first arm that holds wins, and the plain last value covers the rest", () => {
  const command = hint_registry().get("x.hint")!;
  const action_of = (args: Record<string, unknown>) => (check_args(command, args) as { args: Record<string, unknown> }).args.action;
  assert.equal(action_of({ filter: "media" }), "play_pause");
  assert.equal(action_of({ filter: "images" }), "tab");
  assert.equal(action_of({ filter: "clickable" }), "here");
  assert.equal(action_of({}), "here");
  assert.equal(action_of({ filter: "media", action: "tab" }), "tab");

  const overlapping = create_registry();
  overlapping.define("x.hint", hint_input([{ value: "tab", when: { filter: ["media", "images"] } }, { value: "play_pause", when: { filter: ["media"] } }, "here"]));
  assert.equal(default_of(overlapping.get("x.hint")!, overlapping.get("x.hint")!.params![0]!, { filter: "media" }), "tab");
});

test("a dependency that is itself defaulted resolves through its own default, two levels deep", () => {
  const registry = create_registry();
  registry.define("x.chain", {
    label: "C",
    intent: "C.",
    runs_in: "background",
    run: () => {},
    params: [
      { name: "a", type: "string", default: [{ value: "from_b", when: { b: ["on"] } }, "plain"] },
      { name: "b", type: "enum", values: ["on", "off"], default: [{ value: "on", when: { c: [true] } }, "off"] },
      { name: "c", type: "bool", default: false },
    ] as never,
  });
  const command = registry.get("x.chain")!;
  assert.deepEqual(check_args(command, { c: true }), { ok: true, args: { c: true, a: "from_b", b: "on" } });
  assert.deepEqual(check_args(command, {}), { ok: true, args: { c: false, a: "plain", b: "off" } });
});

test("define refuses a cycle and names the path", () => {
  rejects(hint_input(DEFAULT_LIST, [{ value: "media", when: { action: ["tab"] } }, "clickable"]), /params\.action\.default: defaults depend on each other: action -> filter -> action/);
});

test("define checks every arm and the order of the list", () => {
  rejects(hint_input([]), /a default list must not be empty/);
  rejects(hint_input(["here", { value: "tab", when: { filter: ["media"] } }]), /default\[0\]: a plain value must be the last item/);
  rejects(hint_input([{ value: "nope", when: { filter: ["media"] } }]), /default\[0\]\.value: "nope" is not one of/);
  rejects(hint_input([{ value: "tab", when: { filter: ["video"] } }]), /default\[0\]\.when\.filter: "video" is not one of/);
  rejects(hint_input([{ value: "tab", when: { action: ["tab"] } }]), /default\[0\]\.when: must not name the param itself/);
  rejects(hint_input([{ value: "tab", when: { nothing: ["x"] } }]), /default\[0\]\.when: names "nothing"/);
});

test("a value that is the default only under some arms keeps its flag, short, phrase and description", () => {
  const registry = hint_registry();
  const command = registry.get("x.hint")!;
  assert.equal(usage_line(command), "hint [--here|-t|--tab|-p|--play-pause] [-m|--media|-i|--images]");
  assert.deepEqual(check_args(command, { action: "here", filter: "media" }), { ok: true, args: { action: "here", filter: "media" } });
  assert.equal(parse_command_line(registry, "hint --media --here").kind, "invocation");
  // A plain default still has no flag.
  assert.throws(() => create_registry().define("x.hint", { ...hint_input("here"), params: [{ name: "action", type: "enum", values: ["here", "tab"], default: "here", short: { here: "h" } }] as never }));
});

test("the help row prints the plain value, then each arm", () => {
  const registry = hint_registry();
  const model = build_help_model(build_commands_file(registry).commands, undefined, []);
  assert.equal(model.groups[0]!.commands[0]!.params[0]!.default, "here; play_pause when filter is media; tab when filter is images");
  assert.equal(describe_default(registry.get("x.hint")!.params![0]!), "here; play_pause when filter is media; tab when filter is images");
});

test("print_command drops an explicit default, so a repeat replays the same value", () => {
  const registry = hint_registry();
  const command = registry.get("x.hint")!;
  const typed = parse_command_line(registry, "hint --media --play-pause");
  assert.equal(typed.kind, "invocation");
  const args = (typed as { invocation: { args: Record<string, unknown> } }).invocation.args;
  const printed = print_command(command, args, {});
  assert.equal(printed, "hint -m");
  const again = check_args(command, (parse_command_line(registry, printed) as { invocation: { args: Record<string, unknown> } }).invocation.args);
  assert.deepEqual(again, { ok: true, args: { action: "play_pause", filter: "media" } });
  assert.equal(print_command(command, { action: "here", filter: "media" }, {}), "hint --here -m");
  assert.equal(print_command(command, { action: "here", filter: "clickable" }, {}), "hint");
});

test("flag completion hides only the default that applies to the typed flags", () => {
  const registry = hint_registry();
  const meta = [command_meta(registry.get("x.hint")!)];
  const complete = create_completer(create_word_lookup(meta), meta, {}, {});
  const flags = (text: string) => complete(text, text.length).rows.map((row) => row.name.split(" ")[0]);
  const bare = flags("hint --");
  assert.ok(!bare.includes("--here") && bare.includes("--play-pause") && bare.includes("--tab"));
  const media = flags("hint --media --");
  assert.ok(!media.includes("--play-pause") && media.includes("--here") && media.includes("--tab"));
  assert.ok(!flags("hint -i --").includes("--tab"));
});

test("the key compiler stores the resolved default and labels only a value that differs from it", () => {
  const registry = hint_registry();
  const { compiled, warnings } = compile_config({
    config: empty_config(),
    default_keymap: { normal: { m: { id: "x.hint", args: { filter: "media" } }, h: { id: "x.hint", args: { filter: "media", action: "here" } } } },
    get_command: (id) => registry.get(id),
    enum_sources: {},
  });
  assert.deepEqual(warnings, []);
  const leaf = (key: string) => (compiled.modes.normal!.children[key] as { label?: string; steps: { invocation: { args: unknown } }[] });
  assert.deepEqual(leaf("m").steps[0]!.invocation.args, { filter: "media", action: "play_pause" });
  assert.equal(leaf("m").label, "Hint for media");
  assert.equal(leaf("h").label, "Hint here for media");
});

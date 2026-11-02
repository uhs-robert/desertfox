import assert from "node:assert/strict";
import { test } from "node:test";
import { build_help_model } from "../src/help/model.ts";
import { compile_keymap } from "../src/shared/keys/compiler.ts";
import { build_commands_file, create_registry } from "../src/shared/registry/index.ts";

function sample() {
  const registry = create_registry();
  registry.define("scroll.lines", {
    name: "scroll", label: "Scroll Lines", intent: "Scroll by lines.", runs_in: "content",
    params: [{ name: "count", type: "int", default: 1 }],
    run: () => {},
  });
  registry.define("open.url", {
    name: "open", label: "Open URL", intent: "Open a URL.", runs_in: "background",
    params: [
      { name: "url", type: "string", default: { from: "clipboard" } },
      { name: "where", type: "enum", values: ["current", "new_tab"], default: "current", flag: { short: "w" } },
    ],
    run: () => {},
  });
  registry.define("help.open", { name: "help", label: "Help", intent: "Open help.", runs_in: "background", run: () => {} });
  const { compiled } = compile_keymap(
    { normal: { j: { id: "scroll.lines", args: { count: 10 } }, gg: [{ id: "scroll.lines" }, { id: "help.open" }] }, browser: { "<A-j>": { id: "scroll.lines" } } },
    {},
    (id) => {
      const command = registry.get(id);
      return command && { runs_in: command.runs_in, label: command.label, count: "ignore" };
    },
  );
  return { commands: build_commands_file(registry).commands, compiled };
}

test("the model groups commands by id group and lists params", () => {
  const { commands, compiled } = sample();
  const model = build_help_model(commands, compiled, []);
  assert.deepEqual(model.groups.map((group) => group.name), ["help", "open", "scroll"]);
  const open = model.groups[1]!.commands[0]!;
  assert.equal(open.usage, "open [-w|--where <where>] <url>");
  assert.deepEqual(open.params, [
    { name: "url", type: "string", default: "from clipboard", values: "" },
    { name: "where", type: "enum", default: "current", values: "current, new_tab" },
  ]);
});

test("keys come from the live compiled keymap, per mode, with args", () => {
  const { commands, compiled } = sample();
  const scroll = build_help_model(commands, compiled, []).groups[2]!.commands[0]!;
  assert.deepEqual(scroll.keys, [
    { mode: "normal", keys: "j", args: "count=10" },
    { mode: "normal", keys: "gg", args: "" },
    { mode: "browser", keys: "<A-j>", args: "" },
  ]);
});

test("warnings pass through and a missing keymap gives no keys", () => {
  const { commands } = sample();
  const model = build_help_model(commands, undefined, ["normal: skipped \"x\""]);
  assert.deepEqual(model.warnings, ["normal: skipped \"x\""]);
  assert.ok(model.groups.every((group) => group.commands.every((command) => command.keys.length === 0)));
});

test("a key row shows the binding prompt", () => {
  const { commands } = sample();
  const registry_compiled = compile_keymap(
    { normal: { o: { id: "open.url", prompt: { param: "url", prefill: { from: "current_url" } } } } },
    {},
    () => ({ runs_in: "background", label: "Open URL", count: "ignore" }),
  ).compiled;
  const model = build_help_model(commands, registry_compiled, []);
  const open = model.groups.find((group) => group.name === "open")!.commands[0]!;
  assert.deepEqual(open.keys, [{ mode: "normal", keys: "o", args: "prompts for url, prefilled from current_url" }]);
});

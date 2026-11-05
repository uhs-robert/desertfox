import assert from "node:assert/strict";
import { test } from "node:test";
import { build_commands_file, create_registry } from "../../src/shared/registry/index.ts";
import { design_registry } from "./fixtures.ts";

test("commands.json holds the meta fields and no handler", () => {
  const file = build_commands_file(design_registry());
  assert.equal(file.format_version, 1);
  assert.deepEqual(file.commands.map((command) => command.id), ["tab.close", "open.search"]);
  const search = file.commands[1]!;
  assert.deepEqual(Object.keys(search).sort(), ["aliases", "count", "id", "intent", "label", "modes", "name", "params"]);
  assert.equal(search.name, "search");
  assert.deepEqual(file.commands[0]!.modes, ["normal"]);
  assert.equal("name" in file.commands[0]!, false);
});

test("the file survives a JSON round trip", () => {
  const file = build_commands_file(design_registry());
  assert.deepEqual(JSON.parse(JSON.stringify(file)), file);
});

test("a conditional default is exported as data", () => {
  const registry = create_registry();
  registry.define("c.d", {
    label: "CD",
    intent: "x",
    params: [
      { name: "where", type: "enum", values: ["here", "tab"], default: "here" },
      { name: "text", type: "string", default: { value: "", when: { where: ["tab"] } } },
    ],
    runs_in: "background",
    run: () => {},
  });
  const file = JSON.parse(JSON.stringify(build_commands_file(registry)));
  assert.deepEqual(file.commands[0].params[1].default, { value: "", when: { where: ["tab"] } });
});

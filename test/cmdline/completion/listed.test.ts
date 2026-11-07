import assert from "node:assert/strict";
import { test } from "node:test";
import "../../../src/background/command_modules.ts";
import { create_completer, is_listed } from "../../../src/cmdline/completion/sources.ts";
import { build_commands_file, create_registry, DefineError, parse_command_line } from "../../../src/shared/registry/index.ts";
import { registry } from "../../../src/shared/registry/builtin.ts";
import type { CommandInput } from "../../../src/shared/registry/index.ts";
import { create_word_lookup } from "../../../src/cmdline/word_lookup.ts";

const commands = build_commands_file(registry).commands;
const lookup = create_word_lookup(commands);
const names_from = (mode: string) => create_completer(lookup, commands, {}, { search_engines: [], containers: [] }, mode)("", 0).rows.map((row) => row.name);

test("a command with no completion field is listed from any mode", () => {
  assert.equal(is_listed({}, "normal"), true);
  assert.equal(is_listed({}, "caret"), true);
});

test("a hidden command is listed from no mode, and a mode list only from those modes", () => {
  assert.equal(is_listed({ completion: "hidden" }, "normal"), false);
  assert.equal(is_listed({ completion: ["caret", "visual"] }, "normal"), false);
  assert.equal(is_listed({ completion: ["caret", "visual"] }, "visual"), true);
});

test("every cmdline command is hidden, including cmdline.open", () => {
  for (const command of commands.filter((candidate) => candidate.id.startsWith("cmdline."))) assert.equal(command.completion, "hidden", command.id);
  assert.ok(!names_from("normal").some((name) => name.startsWith("cmdline.")));
  assert.ok(!names_from("caret").some((name) => name.startsWith("cmdline.")));
});

test("the key-only focus and mode commands are hidden but still parse", () => {
  for (const id of ["mode.escape", "mode.pass_next", "page.blur", "page.focus_input", "browser.focus_page"]) {
    assert.equal(commands.find((command) => command.id === id)?.completion, "hidden", id);
    assert.ok(!names_from("normal").includes(id), id);
  }
});

test("caret and visual commands are hidden from the normal mode and shown from their own", () => {
  assert.ok(!names_from("normal").includes("caret.move"));
  assert.ok(!names_from("normal").includes("visual.act"));
  assert.ok(names_from("caret").includes("caret.move"));
  assert.ok(!names_from("caret").includes("visual.act"));
  assert.ok(names_from("visual").includes("caret.move"));
  assert.ok(names_from("visual").includes("visual.act"));
});

test("an ordinary command stays listed from the normal mode", () => {
  assert.ok(names_from("normal").includes("tab.close"));
});

test("typing a hidden command by hand still parses", () => {
  const parsed = parse_command_line(lookup, "cmdline.open", { search_engines: [], containers: [] });
  assert.equal(parsed.kind, "invocation");
});

test("define accepts hidden and a mode list and rejects an unknown mode or an empty list", () => {
  const base: CommandInput = { label: "L", intent: "Do it.", runs_in: "background", run: () => {} };
  const fresh = create_registry();
  assert.equal(fresh.define("a.one", { ...base, completion: "hidden" }).completion, "hidden");
  assert.deepEqual(fresh.define("a.two", { ...base, completion: ["caret"] }).completion, ["caret"]);
  for (const completion of [["nope"], []] as unknown as NonNullable<CommandInput["completion"]>[]) {
    assert.throws(() => create_registry().define("a.bad", { ...base, completion }), DefineError);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args, create_registry } from "../../src/shared/registry/index.ts";
import type { CommandInput } from "../../src/shared/registry/index.ts";
import { design_registry, search_sources } from "./fixtures.ts";

const registry = design_registry();
const tab_close = registry.get("tab.close")!;
const open_search = registry.get("open.search")!;

function error_of(result: ReturnType<typeof check_args>): string {
  assert.equal(result.ok, false);
  return result.ok ? "" : result.error;
}

test("defaults fill, context sources stay markers", () => {
  assert.deepEqual(check_args(tab_close, undefined), { ok: true, args: { focus: "right" } });
  const result = check_args(open_search, { engine: "arch" }, search_sources);
  assert.deepEqual(result, {
    ok: true,
    args: { engine: "arch", query: { from: "selection" }, where: "here" },
  });
});

test("a context source marker is accepted for a string param", () => {
  const result = check_args(open_search, { engine: "arch", query: { from: "clipboard" } }, search_sources);
  assert.deepEqual(result.ok && result.args["query"], { from: "clipboard" });
  assert.match(error_of(check_args(open_search, { engine: { from: "clipboard" } }, search_sources)), /engine expects/);
});

test("enum values are checked, static and runtime", () => {
  assert.match(error_of(check_args(tab_close, { focus: "up" })), /focus expects one of right, left, got "up"/);
  assert.match(error_of(check_args(open_search, { engine: "bing" }, search_sources)), /engine expects one of arch, ddg/);
  assert.match(error_of(check_args(open_search, { engine: "arch", where: "elsewhere" }, search_sources)), /where expects one of here/);
});

test("an enum given its own default passes, as a compiled key that names no engine gives it", () => {
  const command = create_registry().define("a.search", {
    label: "S",
    intent: "I.",
    runs_in: "background",
    run: () => {},
    params: [{ name: "engine", type: "enum", values: { from: "search_engines" }, default: "" }],
  });
  assert.deepEqual(check_args(command, { engine: "" }, search_sources), { ok: true, args: { engine: "" } });
});

test("a missing runtime list skips the membership check", () => {
  assert.equal(check_args(open_search, { engine: "anything" }).ok, true);
});

test("a missing required param is reported by name", () => {
  const result = check_args(open_search, {}, search_sources);
  assert.deepEqual(result, { ok: false, error: "missing <engine>", missing_param: "engine" });
});

test("an empty value for a required param is missing, not a value", () => {
  const result = check_args(open_search, { engine: "" }, search_sources);
  assert.deepEqual(result, { ok: false, error: "missing <engine>", missing_param: "engine" });
});

test("a bool param left out is off, not missing", () => {
  const registry = create_registry();
  const toggle = registry.define("myapp.toggle", {
    label: "Toggle",
    intent: "Toggle.",
    runs_in: "content",
    run: () => {},
    params: [{ name: "all", type: "bool" }],
  });
  assert.deepEqual(check_args(toggle, undefined), { ok: true, args: {} });
});

test("unknown args are rejected", () => {
  assert.match(error_of(check_args(tab_close, { focus: "left", extra: 1 })), /tab.close: unknown arg "extra"/);
});

test("when: error names the params", () => {
  const result = check_args(open_search, { engine: "arch", container: "Work" }, search_sources);
  assert.equal(error_of(result), "container needs where tab, background or window");
  assert.equal(check_args(open_search, { engine: "arch", container: "Work", where: "tab" }, search_sources).ok, true);
  assert.equal(
    error_of(check_args(open_search, { engine: "arch", container: "Work", where: "here" }, search_sources)),
    "container needs where tab, background or window",
  );
});

test("when: a positional param is named without dashes", () => {
  const local = create_registry();
  const command = local.define("a.b", {
    label: "L",
    intent: "I.",
    runs_in: "background",
    run: () => {},
    params: [
      { name: "mode", type: "enum", values: ["x", "y"] },
      { name: "extra", type: "string", when: { mode: ["y"] } },
    ],
  });
  assert.equal(error_of(check_args(command, { mode: "x", extra: "e" })), "extra needs mode y");
  assert.equal(check_args(command, { mode: "x" }).ok, true);
});

test("when: a defaulted param with an unmet condition is dropped", () => {
  const local = create_registry();
  const command = local.define("a.b", {
    label: "L",
    intent: "I.",
    runs_in: "background",
    run: () => {},
    params: [
      { name: "mode", type: "enum", values: ["x", "y"], default: "x" },
      { name: "extra", type: "string", default: "e", when: { mode: ["y"] } },
    ],
  });
  assert.deepEqual(check_args(command, {}), { ok: true, args: { mode: "x" } });
  assert.deepEqual(check_args(command, { mode: "y" }), { ok: true, args: { mode: "y", extra: "e" } });
});

test("types coerce from strings", () => {
  const local = create_registry();
  const command = local.define("a.b", {
    label: "L",
    intent: "I.",
    runs_in: "background",
    run: () => {},
    params: [
      { name: "count_of", type: "int" },
      { name: "ratio", type: "float" },
      { name: "loud", type: "bool" },
      { name: "text", type: "string" },
    ],
  });
  assert.deepEqual(check_args(command, { count_of: "-3", ratio: "0.5", loud: "false", text: "t" }), {
    ok: true,
    args: { count_of: -3, ratio: 0.5, loud: false, text: "t" },
  });
  assert.deepEqual(check_args(command, { count_of: 3, ratio: 2, loud: true, text: "t" }).ok, true);
  assert.match(error_of(check_args(command, { count_of: "1.5", ratio: 1, loud: true, text: "t" })), /count_of expects a whole number/);
  assert.match(error_of(check_args(command, { count_of: 1, ratio: "abc", loud: true, text: "t" })), /ratio expects a number/);
  assert.match(error_of(check_args(command, { count_of: 1, ratio: "", loud: true, text: "t" })), /missing <ratio>/);
  assert.match(error_of(check_args(command, { count_of: 1, ratio: 1, loud: "yes", text: "t" })), /loud expects true or false/);
  assert.match(error_of(check_args(command, { count_of: 1, ratio: 1, loud: true, text: 5 })), /text expects text/);
});

test("a conditional default fills only while its sibling has a listed value, else the param is required", () => {
  const reg = create_registry();
  reg.define("c.d", {
    label: "CD",
    intent: "x",
    params: [
      { name: "where", type: "enum", values: ["here", "tab"], default: "here" },
      { name: "text", type: "string", main: true, default: { value: "", when: { where: ["tab"] } } },
    ],
    runs_in: "background",
    run: () => {},
  });
  const command = reg.get("c.d")!;
  assert.deepEqual(check_args(command, { where: "tab" }), { ok: true, args: { where: "tab", text: "" } });
  assert.deepEqual(check_args(command, { where: "tab", text: "" }), { ok: true, args: { where: "tab", text: "" } });
  assert.deepEqual(check_args(command, {}), { ok: false, error: "missing <text>", missing_param: "text" });
  assert.deepEqual(check_args(command, { text: "" }), { ok: false, error: "missing <text>", missing_param: "text" });
  assert.deepEqual(check_args(command, { text: "x" }), { ok: true, args: { where: "here", text: "x" } });
});

test("a whitespace-only text counts as missing for a required param, and a default still applies", () => {
  const reg = create_registry();
  reg.define("w.x", {
    label: "WX",
    intent: "x",
    params: [
      { name: "text", type: "string", main: true },
      { name: "note", type: "string", default: "" },
    ],
    runs_in: "background",
    run: () => {},
  });
  const command = reg.get("w.x")!;
  assert.deepEqual(check_args(command, { text: "   " }), { ok: false, error: "missing <text>", missing_param: "text" });
  assert.deepEqual(check_args(command, { text: "a", note: "  " }), { ok: true, args: { text: "a", note: "  " } });
});

function conditional_command(sibling: object) {
  const reg = create_registry();
  reg.define("c.e", {
    label: "CE",
    intent: "x",
    params: [sibling as never, { name: "text", type: "string", main: true, default: { value: "", when: { flag: [true] } } }],
    runs_in: "background",
    run: () => {},
  });
  return reg.get("c.e")!;
}

test("a conditional default reads a bool sibling after it is coerced from text", () => {
  const command = conditional_command({ name: "flag", type: "bool" });
  assert.deepEqual(check_args(command, { flag: "true" }), { ok: true, args: { flag: true, text: "" } });
  assert.equal(check_args(command, { flag: "false" }).ok, false);
});

const rules_input: CommandInput = {
  label: "Rules",
  intent: "Check the rule kinds.",
  runs_in: "background",
  params: [
    { name: "count", type: "int", min: 1, default: 1 },
    { name: "pick", type: "string", pattern: "^\\d+$", optional: true },
    { name: "page", type: "string", values: ["home", "help"], strict: true, optional: true },
    { name: "engine", type: "enum", values: { from: "search_engines" }, optional: true },
  ],
  run: () => {},
};
const rules_command = create_registry().define("rules.check", rules_input);

test("min refuses an int below it", () => {
  assert.match(error_of(check_args(rules_command, { count: 0 })), /count expects a whole number, 1 or more, got 0/);
  assert.deepEqual(check_args(rules_command, { count: "1" }).ok, true);
});

test("pattern refuses text that does not match, and an optional param may be empty", () => {
  assert.match(error_of(check_args(rules_command, { pick: "x" })), /pick expects text matching \^\\d\+\$, got "x"/);
  assert.deepEqual(check_args(rules_command, { pick: "7" }).ok, true);
  for (const pick of ["", "  "]) assert.deepEqual(check_args(rules_command, { pick }).ok, true);
});

test("strict refuses a string outside its values", () => {
  assert.match(error_of(check_args(rules_command, { page: "nope" })), /page expects one of home, help, got "nope"/);
  assert.deepEqual(check_args(rules_command, { page: "help" }).ok, true);
});

test("an optional param reads as empty text when left out", () => {
  assert.deepEqual(check_args(rules_command, {}), { ok: true, args: { count: 1, pick: "", page: "", engine: "" } });
});

test("value_of checks the value with the named setting's spec", () => {
  const set = create_registry().define("rules.set", {
    label: "Set",
    intent: "Set a setting.",
    runs_in: "background",
    params: [
      { name: "name", type: "string", values: ["light_intensity", "hint_letters"], strict: true },
      { name: "value", type: "string", optional: true, value_of: "name" },
    ],
    run: () => {},
  });
  assert.match(error_of(check_args(set, { name: "light_intensity", value: "9" })), /light_intensity: expected a whole number from 1 to 5/);
  assert.equal(check_args(set, { name: "light_intensity", value: "4" }).ok, true);
  assert.equal(check_args(set, { name: "hint_letters", value: "9" }).ok, false);
  assert.equal(check_args(set, { name: "hint_letters", value: "ab" }).ok, true);
  assert.equal(check_args(set, { name: "light_intensity" }).ok, true);
});

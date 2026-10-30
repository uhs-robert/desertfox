import assert from "node:assert/strict";
import { test } from "node:test";
import { create_registry, DefineError } from "../../src/shared/registry/index.ts";
import type { CommandInput } from "../../src/shared/registry/index.ts";
import { design_registry, open_search_input, tab_close_input } from "./fixtures.ts";

const base: CommandInput = { label: "L", intent: "I.", runs_in: "background", run: () => {} };

function rejects(id: string, input: CommandInput, expected: RegExp, registry = create_registry()): void {
  assert.throws(
    () => registry.define(id, input),
    (error: unknown) => error instanceof DefineError && expected.test(error.message) && error.message.includes(id),
  );
}

test("the design examples define and get the count and modes defaults", () => {
  const registry = design_registry();
  assert.equal(registry.get("tab.close")?.count, "repeat");
  assert.equal(registry.get("open.search")?.count, "ignore");
  assert.deepEqual(registry.get("open.search")?.modes, ["normal"]);
});

test("find resolves a name, an alias and a full id", () => {
  const registry = design_registry();
  assert.equal(registry.find("search")?.id, "open.search");
  assert.equal(registry.find("s")?.id, "open.search");
  assert.equal(registry.find("open.search")?.id, "open.search");
  assert.equal(registry.find("open"), undefined);
});

test("id pattern", () => {
  for (const id of ["Tab.close", "tab", "tab.", "tab.close.now", "1tab.close", "tab-x.close", "tab.Close"]) {
    rejects(id, base, /id: .*group\.name/);
  }
  assert.doesNotThrow(() => create_registry().define("my_app.toggle_ids", base));
});

test("duplicate id", () => {
  const registry = design_registry();
  rejects("tab.close", tab_close_input, /id: already defined/, registry);
});

test("name and alias uniqueness across commands", () => {
  const registry = design_registry();
  rejects("open.other", { ...base, name: "search" }, /name: "search" is already used by "open.search"/, registry);
  rejects("open.other", { ...base, aliases: ["x", "s"] }, /aliases\[1\]: "s" is already used/, registry);
  rejects("open.other", { ...base, name: "tab.close" }, /name: .*already used by "tab.close"/, registry);
  rejects("open.other", { ...base, name: "x", aliases: ["x"] }, /aliases\[0\]: .*twice/, registry);
  const with_name = create_registry();
  with_name.define("a.b", { ...base, name: "other.thing" });
  rejects("other.thing", base, /id: already used as the name or alias of "a.b"/, with_name);
});

test("a rejected define leaves the registry unchanged", () => {
  const registry = design_registry();
  assert.throws(() => registry.define("open.other", { ...base, name: "newname", aliases: ["s"] }));
  assert.equal(registry.find("newname"), undefined);
  assert.equal(registry.get("open.other"), undefined);
});

test("names are one word without a leading dash", () => {
  rejects("a.b", { ...base, name: "two words" }, /name: /);
  rejects("a.b", { ...base, aliases: ["-x"] }, /aliases\[0\]: /);
});

test("short flags are one character", () => {
  const long_short: CommandInput = { ...base, params: [{ name: "x", type: "bool", flag: { short: "xy" } }] };
  rejects("a.b", long_short, /params\[0\]\.flag\.short: "xy" must be one character/);
  const preset_short: CommandInput = { ...open_search_input, flags: [{ short: "bb", long: "back", sets: { where: "background" }, label: "x" }] };
  rejects("a.b", preset_short, /flags\[0\]\.short: .*one character/);
});

test("short and long flag names are unique within a command", () => {
  const two_params: CommandInput = {
    ...base,
    params: [
      { name: "a", type: "bool", flag: { short: "x" } },
      { name: "b", type: "bool", flag: { short: "x" } },
    ],
  };
  rejects("a.b", two_params, /params\[1\]\.flag\.short: -x is already used/);
  const preset_vs_param: CommandInput = {
    ...open_search_input,
    flags: [{ long: "where", sets: { where: "background" }, label: "x" }],
  };
  rejects("a.b", preset_vs_param, /flags\[0\]\.long: --where is already used/);
  const two_presets: CommandInput = {
    ...open_search_input,
    flags: [
      { short: "b", long: "background", sets: { where: "background" }, label: "x" },
      { short: "b", long: "back2", sets: { where: "current" }, label: "x" },
    ],
  };
  rejects("a.b", two_presets, /flags\[1\]\.short: -b is already used/);
  const no_prefix: CommandInput = {
    ...base,
    params: [{ name: "private", type: "bool", flag: {} }],
    flags: [{ long: "no-private", sets: { private: true }, label: "x" }],
  };
  rejects("a.b", no_prefix, /--no-private is already used/);
});

test("-h and --help are reserved", () => {
  rejects("a.b", { ...base, params: [{ name: "x", type: "bool", flag: { short: "h" } }] }, /-h is reserved/);
  rejects("a.b", { ...base, params: [{ name: "help", type: "bool", flag: {} }] }, /--help is reserved/);
  rejects("a.b", { ...open_search_input, flags: [{ long: "help", sets: { where: "current" }, label: "x" }] }, /--help is reserved/);
  rejects("a.b", { ...open_search_input, flags: [{ short: "h", long: "hot", sets: { where: "current" }, label: "x" }] }, /-h is reserved/);
});

test("only a trailing run of positional params has defaults", () => {
  const gap: CommandInput = {
    ...base,
    params: [
      { name: "a", type: "string", default: "x" },
      { name: "b", type: "string" },
    ],
  };
  rejects("a.b", gap, /params\.b: .*trailing run/);
  const ok: CommandInput = {
    ...base,
    params: [
      { name: "a", type: "string" },
      { name: "b", type: "string", default: "x" },
      { name: "c", type: "bool", flag: {} },
      { name: "d", type: "string", default: "y" },
    ],
  };
  assert.doesNotThrow(() => create_registry().define("a.b", ok));
});

test("rest only on the last positional string param", () => {
  const rest = (params: NonNullable<CommandInput["params"]>): CommandInput => ({ ...base, params });
  rejects("a.b", rest([{ name: "a", type: "int", rest: true }]), /params\[0\]\.rest: .*string/);
  rejects(
    "a.b",
    rest([
      { name: "a", type: "string", rest: true },
      { name: "b", type: "string" },
    ]),
    /params\[0\]\.rest: .*last positional/,
  );
  rejects("a.b", rest([{ name: "a", type: "string", rest: true, flag: {} }]), /params\[0\]\.rest: .*flag/);
  assert.doesNotThrow(() =>
    create_registry().define(
      "a.b",
      rest([
        { name: "a", type: "string", rest: true },
        { name: "b", type: "bool", flag: {} },
      ]),
    ),
  );
});

test("a preset flag sets only existing params with valid values", () => {
  const preset = (sets: Record<string, string | number | boolean>): CommandInput => ({
    ...open_search_input,
    flags: [{ long: "go", sets, label: "x" }],
  });
  rejects("a.b", preset({ nope: "x" }), /flags\[0\]\.sets: names "nope"/);
  rejects("a.b", preset({ where: "elsewhere" }), /flags\[0\]\.sets\.where: "elsewhere" is not one of/);
  rejects("a.b", preset({ where: 3 }), /flags\[0\]\.sets\.where: 3 is not a enum/);
  rejects("a.b", preset({}), /flags\[0\]\.sets: .*at least one/);
});

test("when names exactly one other existing param with valid values", () => {
  const with_when = (when: Record<string, readonly (string | number | boolean)[]>): CommandInput => ({
    ...base,
    params: [
      { name: "where", type: "enum", values: ["a", "b"], default: "a", flag: {} },
      { name: "other", type: "string", flag: {}, when },
    ],
  });
  rejects("a.b", with_when({}), /params\[1\]\.when: must name exactly one/);
  rejects("a.b", with_when({ where: ["a"], other: ["x"] }), /params\[1\]\.when: must name exactly one/);
  rejects("a.b", with_when({ other: ["x"] }), /params\[1\]\.when: .*itself/);
  rejects("a.b", with_when({ missing: ["a"] }), /params\[1\]\.when: names "missing"/);
  rejects("a.b", with_when({ where: ["c"] }), /params\[1\]\.when\.where: "c" is not one of a, b/);
  rejects("a.b", with_when({ where: [] }), /params\[1\]\.when\.where: .*at least one/);
  assert.doesNotThrow(() => create_registry().define("a.b", with_when({ where: ["b"] })));
});

test("param shape checks", () => {
  rejects("a.b", { ...base, params: [{ name: "Bad", type: "string" }] }, /params\[0\]\.name/);
  rejects("a.b", { ...base, params: [{ name: "x", type: "string" }, { name: "x", type: "int" }] }, /params\[1\]\.name: .*twice/);
  rejects("a.b", { ...base, params: [{ name: "x", type: "enum" }] }, /params\[0\]\.values: .*needs values/);
  rejects("a.b", { ...base, params: [{ name: "x", type: "int", values: ["1"] }] }, /params\[0\]\.values: only enum and string/);
  rejects("a.b", { ...base, params: [{ name: "x", type: "enum", values: [] }] }, /params\[0\]\.values: .*empty/);
  rejects("a.b", { ...base, params: [{ name: "x", type: "enum", values: ["a", "a"] }] }, /params\[0\]\.values: .*repeated/);
  rejects("a.b", { ...base, params: [{ name: "x", type: "enum", values: ["a"], default: "b" }] }, /params\[0\]\.default: "b" is not one of a/);
  rejects("a.b", { ...base, params: [{ name: "x", type: "int", default: 1.5 }] }, /params\[0\]\.default/);
  rejects("a.b", { ...base, params: [{ name: "x", type: "int", default: { from: "selection" } }] }, /params\[0\]\.default: .*string/);
});

test("count must name an existing param, modes must be known", () => {
  rejects("a.b", { ...base, count: { param: "index" } }, /count: names "index"/);
  assert.doesNotThrow(() =>
    create_registry().define("a.b", { ...base, params: [{ name: "index", type: "int" }], count: { param: "index" } }),
  );
  rejects("a.b", { ...base, modes: ["browser" as never] }, /modes: unknown mode "browser"/);
  rejects("a.b", { ...base, modes: [] }, /modes: .*empty/);
  rejects("a.b", { ...base, runs_in: "both" as never }, /runs_in/);
});

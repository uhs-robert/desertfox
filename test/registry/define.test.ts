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
  rejects("open.other", { ...base, name: "x", aliases: ["x"] }, /aliases\[0\]: .*twice/, registry);
  const with_name = create_registry();
  with_name.define("a.b", { ...base, name: "thing" });
  rejects("thing.go", { ...base, name: "thing" }, /name: "thing" is already used by "a.b"/, with_name);
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

test("params may have defaults in any order", () => {
  const mixed: CommandInput = {
    ...base,
    params: [
      { name: "a", type: "string", default: "x" },
      { name: "b", type: "string" },
      { name: "c", type: "bool", default: false },
    ],
  };
  assert.doesNotThrow(() => create_registry().define("a.b", mixed));
});

test("rest is only for a string param", () => {
  rejects("a.b", { ...base, params: [{ name: "a", type: "int", rest: true }] }, /params\[0\]\.rest: .*string/);
  assert.doesNotThrow(() =>
    create_registry().define("a.b", { ...base, params: [{ name: "a", type: "string", rest: true }, { name: "b", type: "bool" }] }),
  );
});

test("when names exactly one other existing param with valid values", () => {
  const with_when = (when: Record<string, readonly (string | number | boolean)[]>): CommandInput => ({
    ...base,
    params: [
      { name: "where", type: "enum", values: ["a", "b"], default: "a" },
      { name: "other", type: "string", when },
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
  assert.doesNotThrow(() => create_registry().define("a.b", { ...base, modes: ["hint", "cmdline", "caret", "visual"] }));
  rejects("a.b", { ...base, runs_in: "both" as never }, /runs_in/);
});

test("the description is one non-empty line", () => {
  rejects("a.b", { ...base, intent: " " }, /intent: .*empty/);
  rejects("a.b", { ...base, intent: "One.\nTwo." }, /intent: .*one line/);
});

test("at most one param is main, and it is a string", () => {
  const two_mains: CommandInput = {
    ...base,
    params: [{ name: "a", type: "string", main: true }, { name: "b", type: "string", main: true }],
  };
  rejects("a.b", two_mains, /params\.main: only one param can be main, found a, b/);
  rejects("a.b", { ...base, params: [{ name: "n", type: "int", main: true }] }, /params\.n\.main: .*string/);
  assert.doesNotThrow(() => create_registry().define("a.b", { ...base, params: [{ name: "a", type: "string", main: true }] }));
});

test("a long flag names one param: enum values and bool names do not repeat", () => {
  const shared_value: CommandInput = {
    ...base,
    params: [{ name: "a", type: "enum", values: ["x", "y"] }, { name: "b", type: "enum", values: ["y", "z"] }],
  };
  rejects("a.b", shared_value, /params\.b: flag --y is also used by param "a"/);
  const bool_is_value: CommandInput = {
    ...base,
    params: [{ name: "a", type: "enum", values: ["rapid"] }, { name: "rapid", type: "bool" }],
  };
  rejects("a.b", bool_is_value, /params\.rapid: flag --rapid is also used by param "a"/);
});

test("long flags: hyphen and underscore spell one flag, help is reserved, words are plain", () => {
  const word_end: CommandInput = {
    ...base,
    params: [{ name: "a", type: "enum", values: ["word_end"] }, { name: "b", type: "bool", default: false }, { name: "c", type: "enum", values: ["x"] }],
  };
  assert.doesNotThrow(() => create_registry().define("a.b", word_end));
  rejects("a.b", { ...base, params: [{ name: "help", type: "bool" }] }, /params\.help: .*--help/);
  rejects("a.b", { ...base, params: [{ name: "a", type: "enum", values: ["help", "x"] }] }, /params\.a: .*--help/);
  rejects("a.b", { ...base, params: [{ name: "a", type: "enum", values: ["Big"] }] }, /params\.a: "Big" must be lowercase/);
});

test("short flags: one letter, not h, unique per command, only where a flag can use them", () => {
  const where = { name: "where", type: "enum" as const, values: ["here", "tab", "window"], default: "here", short: { tab: "t", window: "w" } };
  const registry = create_registry();
  assert.doesNotThrow(() => registry.define("a.ok", { ...base, params: [where, { name: "hard", type: "bool", default: false, short: "r" }, { name: "dir", type: "string", short: "D" }] }));
  const short = (param: object) => ({ ...base, params: [where, { name: "p", type: "bool" as const, ...param }] });
  rejects("a.b", short({ short: "t" }), /params\.p\.short: -t is also used by params\.where\.short\.tab/);
  rejects("a.b", short({ short: "tt" }), /params\.p\.short: "tt" must be one letter/);
  rejects("a.b", short({ short: "1" }), /params\.p\.short: "1" must be one letter/);
  rejects("a.b", short({ short: "h" }), /params\.p\.short: "h" is reserved/);
  rejects("a.b", { ...base, params: [{ name: "w", type: "enum", values: ["x"], short: { y: "y" } }] }, /params\.w\.short\.y: is not one of the values/);
  rejects("a.b", { ...base, params: [{ name: "w", type: "enum", values: ["x"], short: "x" }] }, /params\.w\.short: an enum takes a map/);
  rejects("a.b", { ...base, params: [{ name: "w", type: "bool", short: { x: "x" } }] }, /params\.w\.short: only an enum with a fixed value list/);
  rejects("a.b", { ...base, params: [{ name: "e", type: "enum", values: { from: "search_engines" }, short: { x: "x" } }] }, /params\.e\.short: only an enum with a fixed value list/);
  rejects("a.b", { ...base, params: [{ name: "q", type: "string", main: true, short: "q" }] }, /params\.q\.short: main and rest/);
  rejects("a.b", { ...base, params: [{ name: "q", type: "string", rest: true, short: "q" }] }, /params\.q\.short: main and rest/);
});

test("command names hold no dot", () => {
  rejects("a.b", { ...base, name: "tab.close" }, /name: .*must not hold a "\."/);
  rejects("a.b", { ...base, aliases: ["x.y"] }, /aliases\[0\]: .*must not hold a "\."/);
});

test("value_labels: keys must be values, the default has no phrase, phrases are plain, dynamic lists take none", () => {
  const param = (extra: object) => ({ ...base, params: [{ name: "side", type: "enum" as const, values: ["left", "right"], default: "right", ...extra }] });
  const registry = create_registry();
  assert.doesNotThrow(() => registry.define("tab.side", param({ value_labels: { left: "on the left" } })));
  rejects("tab.a", param({ value_labels: { up: "above" } }), /value_labels\.up: is not one of the values/);
  rejects("tab.b", param({ value_labels: { right: "on the right" } }), /value_labels\.right: the default value has no phrase/);
  rejects("tab.c", param({ value_labels: { left: "" } }), /value_labels\.left: must be a non-empty phrase/);
  rejects("tab.d", param({ value_labels: { left: " on the left" } }), /value_labels\.left: must be a non-empty phrase/);
  rejects("tab.e", { ...base, params: [{ name: "engine", type: "enum", values: { from: "search_engines" }, value_labels: { a: "b" } }] }, /value_labels: only an enum with a fixed value list/);
  rejects("tab.f", { ...base, params: [{ name: "n", type: "int", value_labels: { a: "b" } }] }, /value_labels: only an enum/);
});

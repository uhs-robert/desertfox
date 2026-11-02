import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args, create_registry } from "../../src/shared/registry/index.ts";
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
    args: { engine: "arch", query: { from: "selection" }, where: "current" },
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
  assert.match(error_of(check_args(open_search, { engine: "arch", where: "tab" }, search_sources)), /--where expects one of current/);
});

test("a missing runtime list skips the membership check", () => {
  assert.equal(check_args(open_search, { engine: "anything" }).ok, true);
});

test("a missing required param is reported by name", () => {
  const result = check_args(open_search, {}, search_sources);
  assert.deepEqual(result, { ok: false, error: "missing <engine>", missing_param: "engine" });
});

test("unknown args are rejected", () => {
  assert.match(error_of(check_args(tab_close, { focus: "left", extra: 1 })), /tab.close: unknown arg "extra"/);
});

test("when: error names the flags", () => {
  const result = check_args(open_search, { engine: "arch", container: "Work" }, search_sources);
  assert.equal(error_of(result), "--container needs --where new_tab, background or new_window");
  assert.equal(check_args(open_search, { engine: "arch", container: "Work", where: "new_tab" }, search_sources).ok, true);
  assert.equal(
    error_of(check_args(open_search, { engine: "arch", container: "Work", where: "current" }, search_sources)),
    "--container needs --where new_tab, background or new_window",
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
      { name: "mode", type: "enum", values: ["x", "y"], default: "x", flag: {} },
      { name: "extra", type: "string", default: "e", flag: {}, when: { mode: ["y"] } },
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
  assert.match(error_of(check_args(command, { count_of: 1, ratio: "", loud: true, text: "t" })), /ratio expects a number/);
  assert.match(error_of(check_args(command, { count_of: 1, ratio: 1, loud: "yes", text: "t" })), /loud expects true or false/);
  assert.match(error_of(check_args(command, { count_of: 1, ratio: 1, loud: true, text: 5 })), /text expects text/);
});

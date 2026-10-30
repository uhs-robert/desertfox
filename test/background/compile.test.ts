import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { make_fake } from "./fakes.ts";
import type { TreeLeaf } from "../../src/shared/prefix_tree.ts";

const commands = {
  "tab.close": {
    label: "Close",
    intent: "x",
    params: [{ name: "focus", type: "enum" as const, values: ["right", "left"], default: "right" }],
    runs_in: "background" as const,
    run: () => {},
  },
  "open.search": {
    label: "Search",
    intent: "x",
    params: [
      { name: "engine", type: "enum" as const, values: { from: "search_engines" as const } },
      { name: "where", type: "enum" as const, values: ["current", "new_tab"], default: "current" },
    ],
    runs_in: "background" as const,
    run: () => {},
  },
  "open.url": { label: "Open", intent: "x", params: [{ name: "url", type: "string" as const }], runs_in: "background" as const, run: () => {} },
};

test("bad args warn and skip, defaults are filled, prompt bindings stay", () => {
  const { registry } = make_fake(commands);
  const config = { ...empty_config(), keymap: { normal: { D: { id: "tab.close" }, X: { id: "tab.close", args: { focus: "up" } }, o: { id: "open.url" } }, search_keys: { a: "arch", z: "nope" } } };
  const { compiled, warnings } = compile_config({
    config,
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: ["arch"], containers: [] },
  });
  const children = compiled.modes.normal!.children;
  assert.deepEqual((children.D as TreeLeaf).steps[0]!.invocation.args, { focus: "right" });
  assert.equal(children.X, undefined);
  assert.ok(children.o);
  assert.ok((children.s as { children: object }).children);
  assert.equal(warnings.filter((w) => w.includes("nope")).length, 2);
  assert.equal(warnings.filter((w) => w.includes("focus")).length, 1);
});

test("a content binding that lacks a required param compiles to a background step", () => {
  const { registry } = make_fake({
    "mode.set": { label: "Mode", intent: "x", params: [{ name: "mode", type: "enum" as const, values: ["normal", "ignore"] }], runs_in: "content", run: () => {} },
  });
  const { compiled } = compile_config({
    config: { ...empty_config(), keymap: { normal: { i: { id: "mode.set" } } } },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  assert.equal((compiled.modes.normal!.children.i as TreeLeaf).steps[0]!.runs_in, "background");
});

test("a prompt leaf goes to the background so the router can refuse it", () => {
  const { registry } = make_fake({
    "mode.set": { label: "Mode", intent: "x", params: [{ name: "mode", type: "enum" as const, values: ["normal", "ignore"], default: "normal" }], runs_in: "content", run: () => {} },
  });
  const { compiled, warnings } = compile_config({
    config: { ...empty_config(), keymap: { normal: { i: { id: "mode.set", prompt: { param: "mode" } } } } },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  const step = (compiled.modes.normal!.children.i as TreeLeaf).steps[0]!;
  assert.equal(step.runs_in, "background");
  assert.deepEqual(step.invocation.prompt, { param: "mode" });
  assert.deepEqual(warnings, []);
});

test("a prompt naming a missing param warns and skips", () => {
  const { registry } = make_fake(commands);
  const { compiled, warnings } = compile_config({
    config: { ...empty_config(), keymap: { normal: { o: { id: "open.url", prompt: { param: "link" } } } } },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  assert.equal(compiled.modes.normal, undefined);
  assert.match(warnings[0]!, /prompt names "link"/);
});

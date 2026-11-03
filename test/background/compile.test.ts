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
      { name: "where", type: "enum" as const, values: ["here", "tab"], default: "here" },
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

test("a binding in a mode the command does not allow is warned about and skipped", () => {
  const { registry } = make_fake({
    "tab.close": { label: "Close", intent: "x", runs_in: "background", run: () => {} },
    "mode.leave": { label: "Leave", intent: "x", runs_in: "content", modes: ["normal", "ignore"], run: () => {} },
  });
  const { compiled, warnings } = compile_config({
    config: empty_config(),
    default_keymap: { normal: { D: { id: "tab.close" } }, ignore: { D: { id: "tab.close" }, L: { id: "mode.leave" } }, browser: { "<A-j>": { id: "tab.close" } } },
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
  assert.ok(compiled.modes.normal!.children.D);
  assert.deepEqual(Object.keys(compiled.modes.ignore!.children), ["L"]);
  assert.ok(compiled.modes.browser!.children["<A-j>"]);
  assert.equal(warnings.filter((w) => w.includes("ignore") && w.includes("tab.close")).length, 1);
});

function compile_labels(keymap: object, extra: object = {}) {
  const { registry } = make_fake({
    ...commands,
    "open.url": { label: "Open", intent: "x", params: [{ name: "where", type: "string" as const }, { name: "container", type: "string" as const }], runs_in: "background" as const, run: () => {} },
    "tab.reopen_in_container": { label: "Reopen In Container", intent: "x", params: [{ name: "container", type: "string" as const }], runs_in: "background" as const, run: () => {} },
  });
  const config = {
    ...empty_config(),
    keymap,
    search_engines: { ddg: { url: "https://d/?q=%s", label: "DuckDuckGo" }, arch: { url: "https://a/?q=%s", label: "Arch Wiki" } },
    ...extra,
  };
  const { compiled, warnings } = compile_config({ config, default_keymap: {}, get_command: (id) => registry.get(id), enum_sources: { search_engines: ["ddg", "arch", "nope"], containers: ["Work"] } });
  assert.deepEqual(warnings, []);
  const children = compiled.modes.normal!.children;
  const leaf_at = (group: string, key: string) => ((children[group] as { children: Record<string, TreeLeaf> }).children[key])!;
  return { children, leaf_at };
}

test("generated search keys are labeled with the engine label", () => {
  const { leaf_at } = compile_labels({ search_keys: { d: "ddg", a: "arch" } });
  assert.equal(leaf_at("s", "d").label, "DuckDuckGo");
  assert.equal(leaf_at("S", "d").label, "DuckDuckGo");
  assert.equal(leaf_at("s", "a").label, "Arch Wiki");
});

test("a search binding without an engine takes the default engine label", () => {
  const { children } = compile_labels({ normal: { ",,": { id: "open.search" } } }, { settings: { default_engine: "arch" } });
  const leaf = (children[","] as { children: Record<string, TreeLeaf> }).children[","]!;
  assert.equal(leaf.label, "Arch Wiki");
});

test("a search engine without a configured label keeps the command label", () => {
  const { leaf_at } = compile_labels({ search_keys: { n: "nope" } });
  assert.equal(leaf_at("s", "n").label, "Search");
});

test("container keys are labeled with the container name", () => {
  const { leaf_at } = compile_labels({ container_keys: { w: "Work" } });
  assert.equal(leaf_at("c", "w").label, "Work");
  assert.equal(leaf_at("C", "w").label, "Work");
});

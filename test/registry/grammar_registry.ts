// A small registry in the shape the grammar reads: `main` marks, no flags.
import { create_registry } from "../../src/shared/registry/index.ts";
import type { CommandInput, Registry } from "../../src/shared/registry/index.ts";

const WHERE = ["here", "tab", "background", "window"];

// `main` is part A's field on ParamDef. The cast keeps this file independent of A's branch.
const define = (registry: Registry, id: string, input: Omit<CommandInput, "label" | "intent" | "runs_in" | "run">) =>
  registry.define(id, { label: "L", intent: "I.", runs_in: "background", run: () => {}, ...input } as CommandInput);

export function grammar_registry(): Registry {
  const registry = create_registry();
  define(registry, "tab.close", {
    params: [{ name: "focus", type: "enum", values: ["right", "left"], default: "right", main: true }] as never,
  });
  define(registry, "tab.move", { params: [{ name: "offset", type: "int", main: true }] as never });
  define(registry, "tab.next", {});
  define(registry, "open.url", {
    name: "open",
    aliases: ["o"],
    params: [
      { name: "url", type: "string", main: true },
      { name: "container", type: "string", values: { from: "containers" }, when: { where: ["tab", "background", "window"] } },
      { name: "where", type: "enum", values: WHERE, default: "here" },
    ] as never,
  });
  define(registry, "open.search", {
    name: "search",
    aliases: ["s"],
    params: [
      { name: "engine", type: "enum", values: { from: "search_engines" } },
      { name: "query", type: "string", default: { from: "selection" }, main: true },
      { name: "where", type: "enum", values: WHERE, default: "here" },
    ] as never,
  });
  define(registry, "hint.run", {
    name: "hint",
    params: [
      { name: "action", type: "enum", values: ["open", "background", "window"], default: "open" },
      { name: "filter", type: "enum", values: ["links", "inputs", "custom"], default: "links" },
      { name: "selector", type: "string", default: "a", when: { filter: ["custom"] } },
      { name: "rapid", type: "bool", default: false },
    ] as never,
  });
  define(registry, "dup.both", {
    params: [
      { name: "first", type: "enum", values: ["x", "y"], default: "x" },
      { name: "second", type: "enum", values: ["y", "z"], default: "z" },
    ] as never,
  });
  return registry;
}

export const search_sources = { search_engines: ["arch", "ddg"], containers: ["Work", "Home"] };

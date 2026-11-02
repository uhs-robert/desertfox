// A small registry in the shape the grammar reads.
import { create_registry } from "../../src/shared/registry/index.ts";
import type { CommandInput, Registry } from "../../src/shared/registry/index.ts";

const WHERE = ["here", "tab", "background", "window"];

const define = (registry: Registry, id: string, input: Omit<CommandInput, "label" | "intent" | "runs_in" | "run">) =>
  registry.define(id, { label: "L", intent: "I.", runs_in: "background", run: () => {}, ...input });

export function grammar_registry(): Registry {
  const registry = create_registry();
  define(registry, "tab.close", {
    params: [{ name: "focus", type: "enum", values: ["right", "left"], default: "right" }],
  });
  define(registry, "tab.move", { params: [{ name: "offset", type: "int" }] });
  define(registry, "tab.next", {});
  define(registry, "tab.goto", { params: [{ name: "index", type: "int", default: -1 }] });
  define(registry, "zoom.set", { params: [{ name: "level", type: "float" }] });
  define(registry, "scroll.by", {
    params: [
      { name: "dx", type: "int", default: 0 },
      { name: "dy", type: "int", default: 0 },
    ],
  });
  define(registry, "tab.shift", {
    params: [
      { name: "offset", type: "int" },
      { name: "wrap", type: "bool", default: false },
    ],
  });
  define(registry, "open.url", {
    name: "open",
    aliases: ["o"],
    params: [
      { name: "url", type: "string", main: true },
      { name: "container", type: "string", values: { from: "containers" }, when: { where: ["tab", "background", "window"] } },
      { name: "where", type: "enum", values: WHERE, default: "here" },
    ],
  });
  define(registry, "open.search", {
    name: "search",
    aliases: ["s"],
    params: [
      { name: "engine", type: "enum", values: { from: "search_engines" } },
      { name: "query", type: "string", default: { from: "selection" }, main: true },
      { name: "where", type: "enum", values: WHERE, default: "here" },
    ],
  });
  define(registry, "hint.run", {
    name: "hint",
    params: [
      { name: "action", type: "enum", values: ["open", "background", "window"], default: "open" },
      { name: "filter", type: "enum", values: ["links", "inputs", "custom"], default: "links" },
      { name: "selector", type: "string", default: "a", when: { filter: ["custom"] } },
      { name: "rapid", type: "bool", default: false },
    ],
  });
  return registry;
}

export const search_sources = { search_engines: ["arch", "ddg"], containers: ["Work", "Home"] };

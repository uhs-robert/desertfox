// The design.md registry examples, built into a fresh registry per test.
import { create_registry } from "../../src/shared/registry/index.ts";
import type { CommandInput, Registry } from "../../src/shared/registry/index.ts";

export const WHERE = ["here", "tab", "background", "window"] as const;

export const tab_close_input: CommandInput = {
  label: "Close Tab",
  intent: "Close the current tab and focus the tab on the chosen side.",
  params: [{ name: "focus", type: "enum", values: ["right", "left"], default: "right" }],
  runs_in: "background",
  count: "repeat",
  run: () => {},
};

export const open_search_input: CommandInput = {
  label: "Search",
  intent: "Search with a keyword engine from the search engine list.",
  name: "search",
  aliases: ["s"],
  params: [
    { name: "engine", type: "enum", values: { from: "search_engines" } },
    { name: "query", type: "string", rest: true, default: { from: "selection" } },
    { name: "where", type: "enum", values: WHERE, default: "here", flag: { short: "w" } },
    {
      name: "container",
      type: "string",
      values: { from: "containers" },
      flag: { short: "c" },
      when: { where: ["tab", "background", "window"] },
    },
  ],
  flags: [
    { short: "b", long: "background", sets: { where: "background" }, label: "Open in a background tab" },
    { short: "t", long: "tab", sets: { where: "tab" }, label: "Open in a new tab" },
  ],
  runs_in: "background",
  run: () => {},
};

export function design_registry(): Registry {
  const registry = create_registry();
  registry.define("tab.close", tab_close_input);
  registry.define("open.search", open_search_input);
  return registry;
}

export const search_sources = { search_engines: ["arch", "ddg"], containers: ["Work", "Home"] };

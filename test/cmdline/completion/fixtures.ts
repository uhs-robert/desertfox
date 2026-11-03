import type { CommandMeta } from "../../../src/shared/command.ts";
import { create_word_lookup } from "../../../src/cmdline/word_lookup.ts";

export const COMMANDS: CommandMeta[] = [
  {
    id: "tab.close",
    label: "Close tab",
    intent: "Close the tab, or the tabs around it. Without a flag it closes this tab.",
    params: [
      { name: "left", type: "bool", default: false, short: "l", description: "Close the tabs on the left." },
      { name: "right", type: "bool", default: false, short: "r", description: "Close the tabs on the right." },
    ],
  },
  { id: "tab.next", label: "Next tab", intent: "Go to the next tab." },
  { id: "tab.switch", name: "tab", label: "Switch tab", intent: "Switch to a tab.", params: [{ name: "title", type: "string", main: true, default: "" }] },
  { id: "window.new", label: "New window", intent: "Open a new window.", aliases: ["nw"] },
  { id: "mode.set", name: "mode", label: "Set mode", intent: "Set the mode.", params: [{ name: "mode", type: "enum", values: ["ignore", "normal"], value_labels: { ignore: "Pass every key to the page" } }] },
  {
    id: "open.search",
    name: "search",
    label: "Search",
    intent: "Search the web.",
    params: [
      { name: "engine", type: "enum", values: { from: "search_engines" }, default: "duck" },
      { name: "where", type: "enum", values: ["here", "tab"], default: "here", short: { tab: "t" }, description: { tab: "Search in a new tab." } },
      { name: "container", type: "string", values: { from: "containers" }, short: "c", description: "Search in a container.", default: "" },
      { name: "query", type: "string", rest: true, main: true },
    ],
  },
];

export const SOURCES = { search_engines: ["duck", "github.repo.issues"], containers: ["Work", "Home"] };
export const COMMAND_ALIASES = { tc: "tab.close" };
export const lookup = create_word_lookup(COMMANDS, COMMAND_ALIASES);

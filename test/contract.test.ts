// The design.md registry examples as CommandDef values. `tsc` fails the build
// when a shared type drifts from the design, so this file is the contract check.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandDef, CompiledKeymap, TreeLeaf } from "../src/shared/index.ts";
import { COMPILED_KEYMAP_VERSION, CONFIG_FORMAT_VERSION, DEFAULT_SETTINGS } from "../src/shared/index.ts";

const WHERE = ["here", "tab", "background", "window"] as const;

const tab_close: CommandDef = {
  id: "tab.close",
  label: "Close Tab",
  intent: "Close the current tab and focus the tab on the chosen side.",
  params: [{ name: "focus", type: "enum", values: ["right", "left"], default: "right" }],
  runs_in: "background",
  count: "repeat",
  run: async (_ctx, { focus }) => {
    void focus;
  },
};

const open_search: CommandDef = {
  id: "open.search",
  label: "Search",
  intent: "Search with a keyword engine from the search engine list.",
  name: "search",
  aliases: ["s"],
  params: [
    { name: "engine", type: "enum", values: { from: "search_engines" } },
    { name: "query", type: "string", rest: true, main: true, default: { from: "selection" } },
    { name: "where", type: "enum", values: WHERE, default: "here" },
    {
      name: "container",
      type: "string",
      values: { from: "containers" },
      when: { where: ["tab", "background", "window"] },
    },
  ],
  runs_in: "background",
  run: async () => {},
};

const leaf: TreeLeaf = {
  kind: "leaf",
  label: tab_close.label,
  steps: [{ invocation: { id: tab_close.id, args: { focus: "left" } }, runs_in: tab_close.runs_in, count_rule: "ignore" }],
};

const keymap: CompiledKeymap = {
  format_version: COMPILED_KEYMAP_VERSION,
  modes: { normal: { kind: "branch", children: { D: leaf } } },
  mode_indicator: "always",
  which_key_delay_ms: DEFAULT_SETTINGS.which_key_delay_ms, toast_ms: 3000, toast_error_ms: 6000,
};

test("design examples satisfy the shared contracts", () => {
  assert.equal(CONFIG_FORMAT_VERSION, 2);
  assert.equal(open_search.params?.length, 4);
  assert.equal(keymap.modes.normal?.children["D"]?.kind, "leaf");
});

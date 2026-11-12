import assert from "node:assert/strict";
import { test } from "node:test";
import { create_live_source } from "../../src/cmdline/completion/live.ts";
import { create_completer } from "../../src/cmdline/completion/sources.ts";
import type { CommandMeta } from "../../src/shared/command.ts";
import type { SessionItem } from "../../src/shared/messages.ts";
import { create_word_lookup } from "../../src/cmdline/word_lookup.ts";

const COMMANDS: CommandMeta[] = [
  { id: "tabgroup.add", name: "tabgroup.add", label: "Add tab to group", intent: "Add.", params: [{ name: "group", type: "string", rest: true, main: true, optional: true, values: { from: "groups" } }] },
];

function complete(text: string, groups: SessionItem[] | undefined) {
  const live = create_live_source({ ask: async () => undefined, tabs: () => [], groups: () => groups, all_tabs: () => [], on_ready: () => {} });
  return create_completer(create_word_lookup(COMMANDS, {}), COMMANDS, {}, { search_engines: [], containers: [] }, "normal", live)(text, text.length);
}

test("the groups source lists the group labels, with the id suffix as the model client made it", () => {
  const result = complete("tabgroup.add ", [{ name: "Work", description: "" }, { name: "Play #2", description: "collapsed" }, { name: "Play #3", description: "" }]);
  assert.deepEqual(result.rows.map((row) => row.name).sort(), ["Play #2", "Play #3", "Work"]);
  assert.equal(result.rows.find((row) => row.name === "Play #2")?.insert, '"Play #2" ');
});

test("a typed word narrows the groups, and the list loads until the first snapshot", () => {
  assert.deepEqual(complete("tabgroup.add wo", [{ name: "Work", description: "" }, { name: "Play", description: "" }]).rows.map((row) => row.name), ["Work"]);
  assert.equal(complete("tabgroup.add ", undefined).loading, true);
});

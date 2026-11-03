import assert from "node:assert/strict";
import { test } from "node:test";
import { create_word_lookup } from "../../src/cmdline/word_lookup.ts";

const commands = [
  { id: "open.search", name: "search", label: "Search", intent: "" },
  { id: "tab.next", name: "nexttab", label: "Next", intent: "" },
  // A snippet, which reaches the page only through `open_cmdline`.
  { id: "my.jira", name: "jira", label: "Jira", intent: "" },
];

test("a configured alias and a snippet name both resolve", () => {
  const lookup = create_word_lookup(commands, { g: "open.search" });
  assert.equal(lookup.find("g")?.id, "open.search");
  assert.equal(lookup.find("jira")?.id, "my.jira");
});

test("an alias does not take a command's word, and an alias to an unknown id is skipped", () => {
  const lookup = create_word_lookup(commands, { nexttab: "open.search", x: "no.such" });
  assert.equal(lookup.find("nexttab")?.id, "tab.next");
  assert.equal(lookup.find("x"), undefined);
});

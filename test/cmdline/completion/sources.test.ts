import assert from "node:assert/strict";
import { test } from "node:test";
import { create_completer } from "../../../src/cmdline/completion/sources.ts";
import { create_word_lookup } from "../../../src/cmdline/word_lookup.ts";
import type { CommandMeta } from "../../../src/shared/command.ts";
import { COMMAND_ALIASES, COMMANDS, SOURCES, lookup } from "./fixtures.ts";

const SET: CommandMeta = { id: "settings.set", name: "set", label: "Set a setting", intent: "Change a setting.", params: [{ name: "setting", type: "string", rest: true, main: true, default: "" }] };
const UNSET: CommandMeta = { id: "settings.unset", name: "unset", label: "Unset a setting", intent: "Drop a change.", params: [{ name: "setting", type: "string", rest: true, main: true, default: "" }] };

const complete = create_completer(lookup, COMMANDS, COMMAND_ALIASES, SOURCES);
const names = (text: string) => complete(text, text.length).rows.map((row) => row.name);

test("an empty line lists every command, sorted by name", () => {
  assert.deepEqual(names(""), ["mode", "search", "tab", "tab.close", "tab.next", "window.new"]);
});

test("tab. lists the family with the family word, and tc finds tab.close first", () => {
  assert.deepEqual(names("tab."), ["tab", "tab.next", "tab.close"]);
  assert.equal(names("tc")[0], "tab.close");
});

test("an alias and a configured alias find their command", () => {
  assert.equal(names("nw")[0], "window.new");
  assert.equal(names("tc")[0], "tab.close");
});

test("a command row has the first sentence, the flags and the subject", () => {
  const [row] = complete("tab.close", 9).rows;
  assert.equal(row?.description, "Close the tab, or the tabs around it.");
  assert.equal(row?.args, "--left --right");
  assert.equal(complete("tab", 3).rows.find((candidate) => candidate.name === "tab")?.args, "<title>");
  assert.equal(row?.insert, "tab.close ");
  assert.equal(complete("nw", 2).rows[0]?.insert, "window.new");
});

test("a dash lists the flags of the command with their descriptions and short forms", () => {
  const { rows, start, end } = complete("tab.close -", 11);
  assert.deepEqual(rows.map((row) => [row.name, row.description, row.insert]), [
    ["--left -l", "Close the tabs on the left.", "--left "],
    ["--right -r", "Close the tabs on the right.", "--right "],
  ]);
  assert.deepEqual([start, end], [10, 11]);
});

test("a valued flag inserts its equals sign and no space, and an enum value gets its own flag", () => {
  const rows = complete("search -", 8).rows;
  assert.deepEqual(rows.map((row) => row.insert), ["--tab ", "--container="]);
  assert.deepEqual(rows.map((row) => row.name), ["--tab -t", "--container= -c="]);
});

test("a flag value lists the containers, and a static value lists with its label", () => {
  assert.deepEqual(names("search -c="), ["Work", "Home"]);
  assert.deepEqual(complete("search --container=Wo", 21).rows.map((row) => row.name), ["Work"]);
  const [ignore] = complete("mode ", 5).rows;
  assert.deepEqual([ignore?.name, ignore?.description], ["ignore", "Pass every key to the page"]);
});

test("after -- only subject candidates show, and free text offers nothing", () => {
  assert.deepEqual(names("mode -- "), ["ignore", "normal"]);
  assert.deepEqual(names("search -- "), []);
  assert.equal(complete("search -- ", 10).listing, false);
});

test("a second subject word offers no value", () => {
  assert.deepEqual(names("mode ignore "), []);
});

test("an unknown flag lists nothing and says so by listing without rows", () => {
  const unknown = complete("tab.close -x", 12);
  assert.deepEqual([unknown.rows.length, unknown.listing], [0, true]);
});

test("a quoted word offers nothing", () => {
  assert.equal(complete('tab.close "-', 12).listing, false);
});

test("the note usage of a typed command is its usage line", () => {
  assert.match(complete("tab.close ", 10).usage ?? "", /^tab\.close /);
});

test("a value with a space or a quote goes in double quotes", () => {
  const spaced = create_completer(lookup, COMMANDS, COMMAND_ALIASES, { ...SOURCES, containers: ["My Work", 'a"b', "Home"] });
  assert.deepEqual(spaced("search -c=", 10).rows.map((row) => row.insert), ['"My Work" ', '"a\\"b" ', "Home "]);
});

test("a typed short flag finds its row first and is no mismatch", () => {
  const found = complete("tab.close -l", 12);
  assert.equal(found.rows[0]?.name, "--left -l");
  assert.equal(found.listing && found.rows.length > 0, true);
  assert.equal(complete("tab.close -r", 12).rows[0]?.name, "--right -r");
  assert.equal(complete("search -t", 9).rows[0]?.name, "--tab -t");
  assert.equal(complete("search -c", 9).rows[0]?.name, "--container= -c=");
});

test("set offers the setting names, then the values the setting lists", () => {
  const complete_set = create_completer(
    create_word_lookup([...COMMANDS, SET, UNSET], {}),
    [...COMMANDS, SET, UNSET],
    {},
    SOURCES,
  );
  const rows = (text: string) => complete_set(text, text.length).rows.map((row) => row.name);
  assert.ok(rows("set ").includes("which_key_border"));
  assert.deepEqual(rows("set which_key_b"), ["which_key_border"]);
  assert.equal(complete_set("set which_key_border ", 21).rows.length, 3);
  assert.deepEqual(rows("set which_key_border ro"), ["round"]);
  assert.deepEqual(rows("set newtab_date "), ["true", "false"]);
  assert.deepEqual(rows("set hint_letters "), []);
  assert.deepEqual(rows("set which_key_border round "), []);
  assert.deepEqual(rows("set open_completion history "), ["bookmarks", "history"]);
  assert.ok(rows("unset ").includes("all"));
  assert.deepEqual(rows("unset which_key_border "), []);
});

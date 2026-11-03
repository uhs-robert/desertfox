import assert from "node:assert/strict";
import { test } from "node:test";
import { create_completer } from "../../../src/cmdline/completion/sources.ts";
import { COMMAND_ALIASES, COMMANDS, SOURCES, lookup } from "./fixtures.ts";

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
  assert.deepEqual(rows.map((row) => [row.name, row.args, row.description, row.insert]), [
    ["--left", "-l", "Close the tabs on the left.", "--left "],
    ["--right", "-r", "Close the tabs on the right.", "--right "],
  ]);
  assert.deepEqual([start, end], [10, 11]);
});

test("a valued flag inserts its equals sign and no space, and an enum value gets its own flag", () => {
  const rows = complete("search -", 8).rows;
  assert.deepEqual(rows.map((row) => row.insert), ["--tab ", "--container="]);
  assert.equal(rows[0]?.args, "-t");
  assert.equal(rows[1]?.args, "-c");
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

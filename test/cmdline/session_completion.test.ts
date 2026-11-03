import assert from "node:assert/strict";
import { test } from "node:test";
import { create_completer } from "../../src/cmdline/completion/sources.ts";
import { create_session } from "../../src/cmdline/session.ts";
import { parse_command_line } from "../../src/shared/registry/index.ts";
import { COMMAND_ALIASES, COMMANDS, SOURCES, lookup } from "./completion/fixtures.ts";

function make(history: string[] = []) {
  return create_session({
    history,
    parse: (text) => parse_command_line(lookup, text, SOURCES),
    complete: create_completer(lookup, COMMANDS, COMMAND_ALIASES, SOURCES),
  });
}
const tab = (session: ReturnType<typeof make>) => session.run("cmdline.next_completion", undefined);
const shift_tab = (session: ReturnType<typeof make>) => session.run("cmdline.prev_completion", undefined);
const down = (session: ReturnType<typeof make>) => session.run("cmdline.history", { direction: "next" });
const up = (session: ReturnType<typeof make>) => session.run("cmdline.history", { direction: "prev" });
const row_names = (session: ReturnType<typeof make>) => session.get_rows().map((row) => row.name);

test("the list holds every command on an empty line", () => {
  const session = make();
  session.edit("");
  assert.deepEqual(row_names(session), ["mode", "search", "tab", "tab.close", "tab.next", "window.new"]);
});

test("preview cycle: Tab previews row 0, Tab again row 1, Shift-Tab goes back, and the list keeps ranking the typed text", () => {
  const session = make();
  session.edit("tab.");
  const ranked = row_names(session);
  assert.deepEqual(ranked, ["tab", "tab.next", "tab.close"]);
  tab(session);
  assert.equal(session.get_text(), "tab ");
  assert.equal(session.get_selected(), 0);
  tab(session);
  assert.equal(session.get_text(), "tab.next");
  tab(session);
  assert.equal(session.get_text(), "tab.close ");
  shift_tab(session);
  assert.equal(session.get_text(), "tab.next");
  assert.deepEqual(row_names(session), ranked);
  assert.equal(session.get_selected(), 1);
});

test("Tab wraps at both ends and Shift-Tab starts at the last row", () => {
  const session = make();
  session.edit("tab.");
  shift_tab(session);
  assert.equal(session.get_text(), "tab.close ");
  tab(session);
  assert.equal(session.get_text(), "tab ");
});

test("typing resets the cycle: the list ranks the new text and the saved text is gone", () => {
  const session = make();
  session.edit("tab.");
  tab(session);
  tab(session);
  session.edit("tab.nex");
  assert.equal(session.get_selected(), -1);
  assert.deepEqual(row_names(session), ["tab.next"]);
  // The next Tab starts from the new text, not from "tab.".
  tab(session);
  assert.equal(session.get_text(), "tab.next");
});

test("a preview replaces only the word under the caret", () => {
  const session = make();
  session.edit("tab.close --ri", 14);
  tab(session);
  assert.equal(session.get_text(), "tab.close --right ");
  session.edit("tab.close -- now", 11);
  assert.equal(session.get_rows().length, 2);
});

test("Enter runs the line as shown after Tab, and nothing else", () => {
  const session = make();
  session.edit("tn");
  tab(session);
  assert.equal(session.get_text(), "tab.next");
  assert.deepEqual(session.run("cmdline.submit", undefined), { kind: "submit", invocation: { id: "tab.next" }, text: "tab.next" });
});

test("Enter on a previewed command that lacks a value still hits the pre-check", () => {
  const precheck = (invocation: { id: string }) => (invocation.id === "mode.set" ? "mode needs a value" : undefined);
  const session = create_session({ history: [], parse: (text) => parse_command_line(lookup, text, SOURCES), precheck, complete: create_completer(lookup, COMMANDS, COMMAND_ALIASES, SOURCES) });
  session.edit("mod");
  tab(session);
  assert.equal(session.get_text(), "mode ");
  assert.deepEqual(session.run("cmdline.submit", undefined), { kind: "render" });
  assert.equal(session.get_message(), "mode needs a value");
});

test("a single match goes into the line at once with a trailing space, and the list ranks the new text", () => {
  const session = make();
  session.edit("mo");
  tab(session);
  assert.equal(session.get_text(), "mode ");
  assert.equal(session.get_selected(), -1);
  assert.deepEqual(row_names(session), ["ignore", "normal"]);
});

test("Down and Up move and preview like Tab", () => {
  const session = make();
  session.edit("tab.");
  down(session);
  assert.deepEqual([session.get_selected(), session.get_text()], [0, "tab "]);
  down(session);
  assert.deepEqual([session.get_selected(), session.get_text()], [1, "tab.next"]);
  up(session);
  assert.deepEqual([session.get_selected(), session.get_text()], [0, "tab "]);
});

test("Down on the last row and Up on the first row stay put, and neither reaches the history", () => {
  const session = make(["older entry"]);
  session.edit("tab.");
  for (let press = 0; press < 5; press++) down(session);
  assert.deepEqual([session.get_selected(), session.get_text()], [2, "tab.close "]);
  up(session);
  up(session);
  up(session);
  up(session);
  assert.deepEqual([session.get_selected(), session.get_text()], [0, "tab "]);
  assert.deepEqual(row_names(session), ["tab", "tab.next", "tab.close"]);
});

test("Up with nothing selected goes to the last row", () => {
  const session = make();
  session.edit("tab.");
  up(session);
  assert.equal(session.get_selected(), 2);
});

test("with the list closed, Up and Down walk the history", () => {
  const session = make(["first", "second"]);
  session.edit("zzz");
  assert.deepEqual(session.get_rows(), []);
  up(session);
  assert.equal(session.get_text(), "second");
  up(session);
  assert.equal(session.get_text(), "first");
  down(session);
  down(session);
  assert.equal(session.get_text(), "zzz");
});

test("Escape closes the list first, then the line, and Up then walks the history", () => {
  const session = make(["older"]);
  session.edit("tab.");
  assert.deepEqual(session.run("mode.escape", undefined), { kind: "render" });
  assert.deepEqual(session.get_rows(), []);
  assert.equal(session.get_text(), "tab.");
  up(session);
  assert.equal(session.get_text(), "older");
  assert.deepEqual(session.run("mode.escape", undefined), { kind: "close" });
});

test("typing opens the list again after Escape closed it", () => {
  const session = make();
  session.edit("tab.");
  session.run("mode.escape", undefined);
  session.edit("tab.n");
  assert.deepEqual(row_names(session), ["tab.next"]);
});

test("an unknown flag shows no error in the note row until Enter", () => {
  const session = make();
  session.edit("tab.close -x");
  assert.equal(session.get_message(), undefined);
  assert.equal(session.get_hint(), "no match");
  assert.deepEqual(session.run("cmdline.submit", undefined), { kind: "render" });
  assert.match(session.get_message() ?? "", /unknown flag "-x"/);
});

test("the hint is the selected row's usage, else the command's", () => {
  const session = make();
  session.edit("tab.close ");
  assert.match(session.get_hint() ?? "", /^tab\.close /);
  session.edit("tc");
  tab(session);
  assert.match(session.get_hint() ?? "", /^tab\.close /);
});

test("a fresh line keeps Up and Down for the history: `:` Up Enter reruns the last command", () => {
  const session = make(["tab.next", "window.new"]);
  session.open("");
  assert.equal(session.get_rows().length, 6);
  up(session);
  assert.equal(session.get_text(), "window.new");
  up(session);
  assert.equal(session.get_text(), "tab.next");
  down(session);
  assert.equal(session.get_text(), "window.new");
  assert.deepEqual(session.run("cmdline.submit", undefined), { kind: "submit", invocation: { id: "window.new" }, text: "window.new" });
});

test("a prefilled line stays fresh, and typing or Tab ends it so Up and Down move in the list", () => {
  const typed = make(["old"]);
  typed.open("");
  typed.edit("t");
  up(typed);
  assert.equal(typed.get_selected(), typed.get_rows().length - 1);
  assert.notEqual(typed.get_text(), "old");

  const tabbed = make(["old"]);
  tabbed.open("");
  tab(tabbed);
  down(tabbed);
  assert.equal(tabbed.get_selected(), 1);
});

test("Ctrl-u ends the fresh state too", () => {
  const session = make(["old"]);
  session.open("");
  session.run("cmdline.clear", undefined);
  down(session);
  assert.equal(session.get_selected(), 0);
});

test("a caret move with no text change ranks the word at the new caret", () => {
  const session = make();
  session.edit("tab.close --ri");
  assert.equal(session.get_rows()[0]?.name, "--right -r");
  session.set_caret(3);
  assert.ok(session.get_rows().some((row) => row.name === "tab.close"));
  tab(session);
  assert.match(session.get_text(), /^tab\S*\s+--ri$/);
});

test("a typed exact short flag shows its row and no no-match note", () => {
  const session = make();
  session.edit("tab.close -l");
  assert.equal(session.get_rows()[0]?.name, "--left -l");
  assert.notEqual(session.get_hint(), "no match");
  assert.equal(session.get_message(), undefined);
  tab(session);
  assert.equal(session.get_text(), "tab.close --left ");
});

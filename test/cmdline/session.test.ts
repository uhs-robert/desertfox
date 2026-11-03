import assert from "node:assert/strict";
import { test } from "node:test";
import { create_session } from "../../src/cmdline/session.ts";
import { create_word_lookup } from "../../src/cmdline/word_lookup.ts";
import { parse_command_line } from "../../src/shared/registry/index.ts";

const lookup = create_word_lookup([
  { id: "scroll.by", name: "scroll", label: "Scroll", intent: "", params: [{ name: "count", type: "int", default: 1 }] },
  { id: "tab.next", name: "nexttab", aliases: ["nt"], label: "Next", intent: "" },
]);
const make = (history: string[] = []) => create_session({ history, parse: (text) => parse_command_line(lookup, text) });

test("Enter on a valid line submits the invocation and the trimmed text", () => {
  const session = make();
  session.edit("  nt ");
  assert.deepEqual(session.run("cmdline.submit", undefined), { kind: "submit", invocation: { id: "tab.next" }, text: "nt" });
});

test("a leading colon is ignored", () => {
  const session = make();
  session.edit(":scroll 3");
  assert.deepEqual(session.run("cmdline.submit", undefined), { kind: "submit", invocation: { id: "scroll.by", args: { count: "3" } }, text: "scroll 3" });
});

test("a parse error keeps the line open with the error, and an edit clears the error", () => {
  const session = make();
  session.edit("nope");
  assert.deepEqual(session.run("cmdline.submit", undefined), { kind: "render" });
  assert.equal(session.get_message(), 'unknown command "nope"');
  assert.equal(session.get_text(), "nope");
  session.edit("nop");
  assert.equal(session.get_message(), undefined);
});

test("-h shows the usage line and stays open", () => {
  const session = make();
  session.edit("scroll -h");
  assert.deepEqual(session.run("cmdline.submit", undefined), { kind: "render" });
  assert.match(session.get_message() ?? "", /^scroll /);
});

test("Enter on an empty line and Escape close it", () => {
  const session = make();
  assert.deepEqual(session.run("cmdline.submit", undefined), { kind: "close" });
  session.edit("scroll");
  assert.deepEqual(session.run("mode.escape", undefined), { kind: "close" });
});

test("Up and Down walk the history and bring the draft back", () => {
  const session = make(["first", "second"]);
  session.edit("dra");
  session.run("cmdline.history", { direction: "prev" });
  assert.equal(session.get_text(), "second");
  session.run("cmdline.history", { direction: "prev" });
  assert.equal(session.get_text(), "first");
  session.run("cmdline.history", { direction: "next" });
  session.run("cmdline.history", { direction: "next" });
  assert.equal(session.get_text(), "dra");
});

test("Ctrl-u clears the line", () => {
  const session = make();
  session.edit("abc");
  session.run("cmdline.clear", undefined);
  assert.equal(session.get_text(), "");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { parse_command_line, print_command } from "../../src/shared/registry/index.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

test("-t -b -w mean where and -c means container on every command that has the param", () => {
  for (const command of registry.list()) {
    for (const param of command.params ?? []) {
      if (param.name === "where") assert.deepEqual(param.short, { tab: "t", background: "b", window: "w" }, command.id);
      if (param.name === "container" && !param.main) assert.equal(param.short, "c", command.id);
    }
  }
});

test("typed names are the dotted id except the family words and one-word commands", () => {
  const named = registry.list().filter((command) => command.name !== undefined).map((command) => `${command.id}=${command.name}`);
  assert.deepEqual(named.sort(), [
    "bookmark.open=bookmark",
    "browser.open_firefox_page=firefox",
    "command.repeat=repeat",
    "copy.links=copylinks",
    "copy.tabs=copytabs",
    "copy.url=copy",
    "debug.perf=perf",
    "find.open=find",
    "heading.go=heading",
    "help.issue=issue",
    "help.key=helpkey",
    "help.open=help",
    "hint.run=hint",
    "history.open=history",
    "mark.list=marks",
    "media.act=media",
    "mode.set=mode",
    "open.anything=anything",
    "open.clipboard=paste",
    "open.search=search",
    "open.url=open",
    "quickmark.list=quickmarks",
    "register.list=registers",
    "scroll.lines=scroll",
    "settings.set=set",
    "settings.toggle=toggle",
    "settings.unset=unset",
    "tab.switch=tab",
    "zoom.set=zoom",
  ]);
  assert.equal(registry.find("s"), undefined);
});

test("prefills use the short flags", () => {
  const open = registry.get("open.url")!;
  assert.equal(print_command(open, { where: "tab" }, { open_param: "url" }), "open -t ");
  assert.equal(print_command(open, { where: "tab", container: "Family" }, { open_param: "url" }), "open -t -c=Family ");
  assert.equal(print_command(registry.get("hint.run")!, { action: "copy", filter: "links", rapid: true }), "hint -y -l -r");
  assert.equal(print_command(registry.get("copy.url")!, { format: "title" }), "copy -T");
  assert.equal(print_command(registry.get("scroll.to")!, { percent: 50, axis: "x" }), "scroll.to -x 50");
});

test("only page.reload decides `.` by its args", () => {
  assert.deepEqual(registry.list().filter((command) => typeof command.repeatable === "function").map((command) => command.id), ["page.reload"]);
});

test("only these commands record a jump, and the open commands only with where here", () => {
  const flagged = registry.list().filter((command) => command.jumps !== undefined);
  assert.deepEqual(flagged.map((command) => command.id).sort(), ["find.next", "find.prev", "heading.go", "mark.jump", "open.anything", "open.clipboard", "open.search", "open.url", "page.follow", "page.heading", "scroll.to"]);
  for (const id of ["open.url", "open.search", "open.anything", "open.clipboard", "page.follow"]) {
    const jumps = registry.get(id)!.jumps as (args: Record<string, unknown>) => boolean;
    assert.deepEqual(["here", "tab", "background", "window"].map((where) => jumps({ where })), [true, false, false, false], id);
  }
  const mark_jumps = registry.get("mark.jump")!.jumps as (args: Record<string, unknown>) => boolean;
  assert.deepEqual(["a", "'", "A"].map((key) => mark_jumps({ key })), [true, true, false], "the router leaves global marks to global_mark_jump.ts");
});

test("only these commands opt out of `.`, so a new command repeats unless someone decides otherwise", () => {
  const opted_out = registry.list().filter((command) => command.repeatable === false).map((command) => command.id);
  assert.deepEqual(opted_out.sort(), [
    "browser.close_all", "browser.focus_page", "browser.open_firefox_page", "caret.find", "caret.move", "cmdline.clear", "cmdline.help", "cmdline.history", "cmdline.next_completion", "cmdline.open", "cmdline.prev_completion", "cmdline.submit",
    "command.repeat", "config.reload", "debug.perf", "debug.restart", "engine.show", "find.open", "frame.exit", "help.issue", "help.key", "help.open", "help.whichkey", "hint.key", "list.act", "list.select", "macro.play", "macro.record", "macro.stop", "mark.add", "mark.clear", "mark.delete", "mark.jump", "mark.list", "mode.escape", "mode.insert", "mode.pass_next", "mode.set", "mode.site",
    "native.install", "native.update", "open.anything", "page.jump", "page.print", "page.save_pdf", "permissions.grant", "quickmark.add", "quickmark.delete", "quickmark.list", "register.list", "register.paste", "settings.set", "settings.toggle", "settings.unset", "text.edit_external", "visual.act", "visual.object", "visual.open",
  ]);
});

test("the search keys run in caret and visual mode too, and the registry lets them", async () => {
  const { DEFAULT_KEYMAP } = await import("../../src/background/default_keymap.ts");
  for (const mode of ["caret", "visual"] as const) {
    for (const [key, id] of [["/", "find.open"], ["?", "find.open"], ["*", "find.open"], ["#", "find.open"], ["n", "find.next"], ["N", "find.prev"]] as const) {
      assert.equal((DEFAULT_KEYMAP[mode]![key] as { id: string }).id, id, `${mode} ${key}`);
      assert.ok(registry.get(id)!.modes?.includes(mode), `${mode} ${id}`);
    }
  }
});

test("a jump list step and a global mark jump leave the router no place to record", () => {
  // A router record before a step pushes the present place and puts the cursor back at the present, so <C-i> then finds nothing.
  assert.equal(registry.get("page.jump")!.jumps, undefined);
  // A global mark records in global_mark_jump.ts, in the window it lands in. A router record goes to the sender's window.
  const mark_jumps = registry.get("mark.jump")!.jumps as (args: Record<string, unknown>) => boolean;
  assert.equal(mark_jumps({ key: "A" }), false);
});

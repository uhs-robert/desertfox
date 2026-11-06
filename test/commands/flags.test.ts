import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { parse_command_line, print_command, registry } from "../../src/shared/registry/index.ts";

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
    "command.repeat=repeat",
    "copy.url=copy",
    "find.open=find",
    "heading.go=heading",
    "help.open=help",
    "hint.run=hint",
    "mode.set=mode",
    "open.clipboard=paste",
    "open.search=search",
    "open.url=open",
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

test("only these commands opt out of `.`, so a new command repeats unless someone decides otherwise", () => {
  const opted_out = registry.list().filter((command) => command.repeatable === false).map((command) => command.id);
  assert.deepEqual(opted_out.sort(), ["browser.close_all", "browser.focus_page", "command.repeat", "config.reload", "engine.show", "help.open", "settings.set", "settings.toggle", "settings.unset"]);
});

test("the search keys run in visual mode too, and the registry lets them", async () => {
  const { DEFAULT_KEYMAP } = await import("../../src/background/default_keymap.ts");
  for (const [key, id] of [["/", "find.open"], ["?", "find.open"], ["*", "find.open"], ["#", "find.open"], ["n", "find.next"], ["N", "find.prev"]] as const) {
    assert.equal((DEFAULT_KEYMAP.visual![key] as { id: string }).id, id, key);
    assert.ok(registry.get(id)!.modes?.includes("visual"), id);
  }
});

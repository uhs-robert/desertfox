import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

test(":help completes every built-in command and the help pages", () => {
  const values = registry.get("help.open")!.params![0]!.values as string[];
  assert.ok(values.includes("scroll.to") && values.includes("help.open"));
  for (const command of registry.list()) assert.ok(values.includes(command.id), command.id);
  for (const title of ["home", "quick_start", "commands", "search_engines", "styling"]) assert.ok(values.includes(title), title);
});

test(":help refuses a name that is neither a page nor a command, before the handler runs", () => {
  const help = registry.get("help.open")!;
  assert.deepEqual(check_args(help, { name: "nope" }, {}).ok, false);
  for (const name of ["", "commands", "quick_start", "scroll.to"]) assert.equal(check_args(help, { name }, {}).ok, true, name);
});

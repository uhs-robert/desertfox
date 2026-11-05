import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { registry } from "../../src/shared/registry/index.ts";

test(":help completes every built-in command and the help pages", () => {
  const values = registry.get("help.open")!.params![0]!.values as string[];
  assert.ok(values.includes("scroll.to") && values.includes("help.open"));
  for (const command of registry.list()) assert.ok(values.includes(command.id), command.id);
  for (const title of ["Home", "Quick Start", "Commands", "Search Engines", "Styling"]) assert.ok(values.includes(title), title);
});

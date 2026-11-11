import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { is_dynamic_values } from "../../src/shared/registry/params.ts";

// Without rest the completer gives each word its own position, so a space after the first word closes the list.
test("every main param with a live completion source is rest, so a space inside it is a search term", () => {
  const offenders = registry
    .list()
    .flatMap((command) => (command.params ?? []).filter((param) => param.main && is_dynamic_values(param.values) && !param.rest).map((param) => `${command.id}.${param.name}`));
  assert.deepEqual(offenders, []);
});

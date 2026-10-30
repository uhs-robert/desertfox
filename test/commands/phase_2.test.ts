import assert from "node:assert/strict";
import { test } from "node:test";
import { needs_command_line, needs_hints } from "../../src/content/handlers/phase_2.ts";

test("phase 2 content commands refuse with the reason", () => {
  assert.throws(() => needs_hints.run({}), /needs hints \(phase 2\)/);
  assert.throws(() => needs_command_line.run({}), /needs the command line \(phase 2\)/);
});

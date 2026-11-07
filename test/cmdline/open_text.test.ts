import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { check_args, parse_command_line } from "../../src/shared/registry/index.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

test("cmdline.open takes text, so a caller can open the line with a command typed in", () => {
  const command = registry.get("cmdline.open")!;
  assert.deepEqual(check_args(command, { text: "open --url=" }), { ok: true, args: { text: "open --url=" } });
  assert.deepEqual(check_args(command, undefined), { ok: true, args: { text: "" } });
});

test("the command line text of cmdline.open reads --text=", () => {
  const parsed = parse_command_line(registry, 'cmdline.open --text="open -t "');
  assert.deepEqual(parsed.kind === "invocation" && parsed.invocation, { id: "cmdline.open", args: { text: "open -t " } });
});

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

test(":helpkey takes a leader sequence typed on the command line, and refuses missing or spaced keys", async () => {
  const { parse_command_line } = await import("../../src/shared/registry/command_line.ts");
  const help_key = registry.get("help.key")!;
  for (const keys of [",r", "gg", "<A-j>", "<C-d>"]) {
    const parsed = parse_command_line(registry, `helpkey ${keys}`, {});
    assert.equal(parsed.kind, "invocation", keys);
    if (parsed.kind === "invocation") assert.deepEqual(parsed.invocation.args, { keys });
  }
  assert.equal(check_args(help_key, {}, {}).ok, false);
  assert.equal(check_args(help_key, { keys: "g g" }, {}).ok, false);
  assert.equal(check_args(help_key, { keys: ",r" }, {}).ok, true);
});

test("the debug, config and native commands are advanced and the rest of the help commands are not", () => {
  for (const id of ["config.reload", "debug.restart", "native.install", "native.update"]) assert.equal(registry.get(id)!.advanced, true, id);
  assert.equal(registry.get("help.open")!.advanced, undefined);
});

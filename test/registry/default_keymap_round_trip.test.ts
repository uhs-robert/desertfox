import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import { check_args, parse_command_line, print_command, registry } from "../../src/shared/registry/index.ts";
import type { KeyBinding } from "../../src/shared/invocation.ts";

const SOURCES = { search_engines: ["google", "ddg"], containers: ["Work"] };

function steps_of(binding: KeyBinding | null): { id: string; args?: Record<string, unknown> }[] {
  if (binding === null) return [];
  return (Array.isArray(binding) ? binding : [binding]) as { id: string; args?: Record<string, unknown> }[];
}

test("every default-keymap binding prints to text that parses back to the same checked args", () => {
  let count = 0;
  for (const [mode, bindings] of Object.entries(DEFAULT_KEYMAP)) {
    if (typeof bindings !== "object" || mode === "group_names" || mode === "search_keys" || mode === "container_keys") continue;
    for (const [keys, binding] of Object.entries(bindings as Record<string, KeyBinding | null>)) {
      for (const step of steps_of(binding)) {
        const command = registry.get(step.id)!;
        for (const flags of ["short", "long"] as const) {
          const text = print_command(command, step.args, { flags, sources: SOURCES });
          const parsed = parse_command_line(registry, text, SOURCES);
          assert.equal(parsed.kind, "invocation", `${mode} ${keys}: ${text}`);
          if (parsed.kind !== "invocation") continue;
          assert.equal(parsed.invocation.id, step.id, `${mode} ${keys}: ${text}`);
          const expected = check_args(command, step.args ?? {}, SOURCES);
          const got = check_args(command, parsed.invocation.args ?? {}, SOURCES);
          assert.deepEqual(got, expected, `${mode} ${keys}: ${text}`);
        }
        count += 1;
      }
    }
  }
  assert.ok(count > 100, `only ${count} bindings were checked`);
});

// A handler must never refuse an argument value that the param schema accepts: every static rule lives in the schema.
// For each background command, the test builds args the one validator accepts, runs the real handler against a stub
// `browser`, and fails on any throw that is not a RuntimeRefusal.
import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import type { CommandContext, ParamDef } from "../../src/shared/command.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import type { EnumSources } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/index.ts";
import { is_dynamic_values, static_values } from "../../src/shared/registry/params.ts";

const SOURCES: EnumSources = { search_engines: ["stub_engine"], containers: ["stub_container"] };
const CTX: CommandContext = { tab_id: 1, window_id: 1, frame_id: 0, mode: "normal" };

// A value that answers every call and every property, so a handler gets past its browser calls to its own checks.
function stub_value(): unknown {
  const target = function () {};
  return new Proxy(target, {
    get: (_target, key) => (key === "then" ? undefined : key === Symbol.iterator ? function* () {} : key === Symbol.toPrimitive ? () => "" : stub_value()),
    apply: () => Promise.resolve(stub_value()),
  });
}

function candidates(param: ParamDef): readonly unknown[] {
  switch (param.type) {
    case "int":
      return [-1, 0, 1, 2];
    case "float":
      return [-1, 0, 1, 1.5];
    case "bool":
      return [false, true];
    case "enum":
      return static_values(param) ?? (is_dynamic_values(param.values) ? (SOURCES[param.values.from] ?? ["x"]) : ["x"]);
    case "string":
      return ["", " ", "1", "x", "1 x", ...(static_values(param) ?? []).slice(0, 2), ...(static_values(param) ?? []).slice(-1)];
  }
}

// The base args leave every param out, then each param takes each candidate alone. A set the validator rejects is dropped.
function accepted_args(command: NonNullable<ReturnType<typeof registry.get>>): Record<string, unknown>[] {
  const params = command.params ?? [];
  const sets: Record<string, unknown>[] = [{}];
  for (const param of params) for (const value of candidates(param)) sets.push({ [param.name]: value });
  const required = Object.fromEntries(params.map((param) => [param.name, candidates(param).at(-1)]));
  sets.push(required);
  return sets.filter((args) => check_args(command, args, SOURCES).ok).map((args) => (check_args(command, args, SOURCES) as { args: Record<string, unknown> }).args);
}

test("no background handler refuses args the schema accepts", async () => {
  (globalThis as unknown as { browser: unknown }).browser = stub_value();
  const failures: string[] = [];
  try {
    for (const command of registry.list()) {
      if (command.runs_in !== "background") continue;
      for (const args of accepted_args(command)) {
        try {
          await Promise.race([Promise.resolve(command.run(CTX, args)), new Promise((resolve) => setTimeout(resolve, 200))]);
        } catch (error) {
          // A TypeError comes from the stub's shape, not from a rule.
          if (error instanceof TypeError || (error as Error).name === "RuntimeRefusal") continue;
          failures.push(`${command.id} ${JSON.stringify(args)}: ${(error as Error).message}`);
        }
      }
    }
  } finally {
    delete (globalThis as unknown as { browser?: unknown }).browser;
  }
  assert.deepEqual(failures, []);
});

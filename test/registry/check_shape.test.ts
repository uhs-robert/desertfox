import assert from "node:assert/strict";
import { test } from "node:test";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { check_args_shape } from "../../src/shared/registry/check_shape.ts";
import { create_registry } from "../../src/shared/registry/index.ts";

const set = create_registry().define("shape.set", {
  label: "Set",
  intent: "Set a setting.",
  runs_in: "background",
  params: [
    { name: "name", type: "string", values: ["light_intensity"], strict: true },
    { name: "value", type: "string", optional: true, value_of: "name" },
  ],
  run: () => {},
});

test("the shape check accepts a bad setting value that check_args rejects", () => {
  const args = { name: "light_intensity", value: "9" };
  assert.deepEqual(check_args_shape(set, args), { ok: true, args });
  const full = check_args(set, args);
  assert.equal(full.ok, false);
  assert.match(full.ok ? "" : full.error, /light_intensity: expected/);
});

test("the shape check still reports a missing param", () => {
  const result = check_args_shape(set, {});
  assert.deepEqual(result, { ok: false, error: "missing <name>", missing_param: "name" });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { is_macro_register, REGISTER_NAME_PATTERN, register_kind, storage_name } from "../../src/shared/register_names.ts";

test("each register name has one kind", () => {
  assert.equal(register_kind("a"), "named");
  assert.equal(register_kind("Z"), "append");
  assert.equal(register_kind('"'), "unnamed");
  assert.equal(register_kind("+"), "clipboard");
  assert.equal(register_kind("_"), "black_hole");
  assert.equal(register_kind("/"), "search_query");
  assert.equal(register_kind("/:direction"), "search_direction");
  for (const name of ["", "1", "@", "ab", "/:", " a"]) assert.equal(register_kind(name), undefined, name);
});

test("an uppercase name stores in the lowercase register", () => {
  assert.equal(storage_name("A"), "a");
  assert.equal(storage_name("+"), "+");
});

test("a macro target is a letter, and the special registers and the last-played name are reserved", () => {
  assert.ok(is_macro_register("a") && is_macro_register("Q"));
  for (const name of ['"', "/", "/:direction", "+", "_", "@", "1", ""]) assert.ok(!is_macro_register(name), name);
});

test("the schema pattern accepts exactly the register names", () => {
  const pattern = new RegExp(REGISTER_NAME_PATTERN);
  for (const name of ["a", "Z", '"', "+", "_", "/", "/:direction", " a "]) assert.ok(pattern.test(name), name);
  for (const name of ["", "ab", "1", "@", "/:dir"]) assert.ok(!pattern.test(name), name);
});

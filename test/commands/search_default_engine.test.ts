import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { search_engine_name } from "../../src/commands/url_build.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

test("open.search accepts a query with no engine", () => {
  const result = check_args(registry.get("open.search")!, { query: "rust" });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("a search with no engine follows the default_engine setting, a named engine wins", () => {
  assert.equal(search_engine_name(undefined, "arch"), "arch");
  assert.equal(search_engine_name("", "arch"), "arch");
  assert.equal(search_engine_name("duck", "arch"), "duck");
});

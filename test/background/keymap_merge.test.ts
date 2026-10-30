import assert from "node:assert/strict";
import { test } from "node:test";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { make_fake } from "./fakes.ts";
import { merge_keymaps } from "../../src/background/keymap_merge.ts";

test("user binding overrides default and null removes one", () => {
  const merged = merge_keymaps(
    { normal: { J: { id: "tab.next" }, K: { id: "tab.prev" }, x: { id: "tab.close" } } },
    { normal: { J: { id: "tab.prev" }, K: null } },
  );
  assert.deepEqual(merged.normal, { J: { id: "tab.prev" }, K: null, x: { id: "tab.close" } });
});

test("modes from either side survive and generators come from the user", () => {
  const merged = merge_keymaps({ browser: { "<A-j>": { id: "tab.next" } } }, { insert: {}, search_keys: { a: "arch" } });
  assert.deepEqual(merged.browser, { "<A-j>": { id: "tab.next" } });
  assert.deepEqual(merged.insert, {});
  assert.deepEqual(merged.search_keys, { a: "arch" });
  assert.equal(merged.container_keys, undefined);
});

test("a null removes a binding generated from search_keys", () => {
  const { registry } = make_fake({
    "open.search": {
      label: "Search",
      intent: "x",
      params: [
        { name: "engine", type: "enum", values: { from: "search_engines" } },
        { name: "where", type: "enum", values: ["current", "new_tab"], default: "current" },
      ],
      runs_in: "background",
      run: () => {},
    },
  });
  const { compiled } = compile_config({
    config: { ...empty_config(), keymap: { search_keys: { a: "arch" }, normal: { Sa: null } } },
    default_keymap: {},
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: ["arch"], containers: [] },
  });
  const search_children = (compiled.modes.normal!.children.s as { children: object }).children;
  assert.deepEqual(Object.keys(search_children), ["a"]);
  assert.equal(compiled.modes.normal!.children.S, undefined);
});

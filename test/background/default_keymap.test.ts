import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/background/default_keymap.ts";
import type { KeymapConfig } from "../../src/shared/keymap.ts";
import { registry } from "../../src/shared/registry/index.ts";

const ids_in = (keymap: KeymapConfig) =>
  Object.values(keymap).flatMap((section) =>
    Object.values(section as Record<string, unknown>).flatMap((binding) => [binding].flat() as { id: string }[]),
  ).map((invocation) => invocation.id);

const used_ids = [...new Set(ids_in(DEFAULT_KEYMAP))];
// Waves 4a and 4b define these. Until the merge the registry lacks them.
const missing_ids = used_ids.filter((id) => !registry.get(id));

function compile(keymap: KeymapConfig) {
  return compile_config({
    config: empty_config(),
    default_keymap: keymap,
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
}

test("the default keymap compiles against the full registry with no warnings", { skip: missing_ids.length > 0 && `waits for the merge of waves 4a and 4b, missing: ${missing_ids.join(", ")}` }, () => {
  const { warnings, compiled } = compile(DEFAULT_KEYMAP);
  assert.deepEqual(warnings, []);
  assert.ok(compiled.modes.normal && compiled.modes.ignore && compiled.modes.browser && compiled.modes.insert);
});

test("the default bindings of commands that exist compile with no warnings", () => {
  const present = (section: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(section).filter(([, binding]) => [binding].flat().every((step) => registry.get((step as { id: string }).id))));
  const partial = Object.fromEntries(Object.entries(DEFAULT_KEYMAP).map(([mode, section]) => [mode, present(section)])) as KeymapConfig;
  assert.deepEqual(compile(partial).warnings, []);
});

test("every prompting default names a real param", () => {
  for (const section of Object.values(DEFAULT_KEYMAP)) {
    for (const binding of Object.values(section as Record<string, unknown>)) {
      for (const step of [binding].flat() as { id: string; prompt?: { param: string } }[]) {
        const command = registry.get(step.id);
        if (step.prompt && command) assert.ok(command.params?.some((param) => param.name === step.prompt!.param), step.id);
      }
    }
  }
});

test("the keys the owner approved are all bound", () => {
  const normal = Object.keys(DEFAULT_KEYMAP.normal ?? {});
  for (const key of ["h", "j", "k", "l", "gg", "G", "<C-d>", "<C-u>", "<C-f>", "<C-b>", "H", "L", "J", "K", "gt", "gT", "r", "R", "x", "dd", "u", "yy", "gu", "gU", "gi", "zi", "zo", "zz", "<S-Escape>", "<Escape>", "<C-v>", "<F1>", "o", "O", "t", "f", "F", ":", "g?"]) {
    assert.ok(normal.includes(key), key);
  }
  assert.deepEqual(Object.keys(DEFAULT_KEYMAP.browser ?? {}), ["<A-j>", "<A-k>"]);
  assert.deepEqual(DEFAULT_KEYMAP.ignore?.["<S-Escape>"], { id: "mode.set", args: { mode: "normal" } });
});

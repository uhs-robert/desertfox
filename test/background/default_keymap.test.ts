import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const missing_ids = used_ids.filter((id) => !registry.get(id));

function compile(keymap: KeymapConfig) {
  return compile_config({
    config: empty_config(),
    default_keymap: keymap,
    get_command: (id) => registry.get(id),
    enum_sources: { search_engines: [], containers: [] },
  });
}

test("the default keymap compiles against the full registry with no warnings", () => {
  assert.deepEqual(missing_ids, []);
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

test("the approved keys are all bound", () => {
  const normal = Object.keys(DEFAULT_KEYMAP.normal ?? {});
  for (const key of ["h", "j", "k", "l", "gg", "G", "<C-d>", "<C-u>", "<C-f>", "<C-b>", "H", "L", "J", "K", "gt", "gT", "rr", "rh", "R", "xx", "dd", "u", "yy", "gu", "gU", "gi", "zi", "zo", "zz", "zt", "zb", "<S-Escape>", "<Escape>", "<C-v>", "<F1>", "o", "O", "tt", "f", "F", ":", "g?"]) {
    assert.ok(normal.includes(key), key);
  }
  assert.deepEqual(Object.keys(DEFAULT_KEYMAP.browser ?? {}), ["<A-j>", "<A-k>", "<A-,>"]);
  assert.deepEqual(DEFAULT_KEYMAP.ignore?.["<S-Escape>"], { id: "mode.set", args: { mode: "normal" } });
});

test("the q group holds the OasisFox commands", () => {
  const { warnings, compiled } = compile(DEFAULT_KEYMAP);
  assert.deepEqual(warnings, []);
  assert.deepEqual(DEFAULT_KEYMAP.normal?.qr, { id: "config.reload" });
  assert.deepEqual(DEFAULT_KEYMAP.normal?.qh, { id: "help.open" });
  assert.deepEqual(DEFAULT_KEYMAP.normal?.qi, { id: "mode.set", args: { mode: "ignore" } });
  assert.deepEqual(DEFAULT_KEYMAP.normal?.qb, { id: "page.blur" });
  assert.ok(compiled.modes.normal);
});

test("plain r, t and x are prefixes only", () => {
  const normal = Object.keys(DEFAULT_KEYMAP.normal ?? {});
  for (const key of ["r", "t", "x"]) assert.ok(!normal.includes(key), key);
  for (const key of ["rr", "rh", "ri", "tt", "tT", "td", "tm", "tn", "tp", "ta", "tf", "tl", "xx", "xp"]) assert.ok(normal.includes(key), key);
});

test("zz, zt and zb align the focused field", () => {
  for (const [key, position] of Object.entries({ zz: "center", zt: "top", zb: "bottom" })) {
    assert.deepEqual(DEFAULT_KEYMAP.normal?.[key], { id: "scroll.align", args: { position } });
  }
  assert.deepEqual(DEFAULT_KEYMAP.normal?.["z="], { id: "zoom.set", args: { level: 1 } });
});

// Rows that name an engine or a container need the user's own data. The config supplies them.
function doc_rows() {
  const lines = readFileSync(new URL("../../docs/keymap.md", import.meta.url), "utf8").split("\n");
  return lines.flatMap((line) => {
    const [, mode, key, status, invocation] = line.match(/^\| (\w+) \| `(.+)` \| (\w+) \| `([^`]+)`/) ?? [];
    if (!mode || !key || !invocation) return [];
    return status === "v1" ? [{ mode, key, id: invocation.split(" ")[0] ?? invocation, user_data: / (engine|container)=/.test(invocation) }] : [];
  });
}

test("every v1 row of docs/keymap.md whose command exists is bound, except rows that need user data", () => {
  const unbound = doc_rows()
    .filter((row) => registry.get(row.id) && !row.user_data)
    .filter((row) => !(DEFAULT_KEYMAP[row.mode as keyof KeymapConfig] as Record<string, unknown> | undefined)?.[row.key])
    .map((row) => `${row.mode} ${row.key}`);
  // `;f` needs a link text param that hint.run lacks. `V` needs caret mode. `ex` rows belong to the command line.
  // `ZZ` closes every window with no undo, so users bind it in their config.
  assert.deepEqual(unbound.sort(), ["normal V", "normal ;f", "normal ZZ", "ex <A-ArrowDown>", "ex <A-ArrowUp>"].sort());
});

test("no default binds a command that does not exist", () => {
  assert.deepEqual(missing_ids, []);
});

test("every command has a one-line description that ends with a period", () => {
  for (const command of registry.list()) {
    assert.match(command.intent, /^[^\r\n]*\.$/, command.id);
  }
});

test("the default keymap names places and hint actions by the new words", () => {
  const old_words = ["current", "new_tab", "new_window"];
  const written = JSON.stringify(DEFAULT_KEYMAP);
  for (const word of old_words) assert.ok(!written.includes(`"${word}"`), word);
});

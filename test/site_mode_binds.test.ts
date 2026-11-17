import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { list_keys } from "../src/background/list_keys.ts";
import { page_keymap_for } from "../src/background/page_keymap.ts";
import { compile_config } from "../src/background/compile.ts";
import { empty_config } from "../src/background/config_load.ts";
import "../src/background/command_modules.ts";
import { DEFAULT_KEYMAP } from "../src/background/default_keymap.ts";
import { ConfigErrors } from "../src/shared/config_build/errors.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../src/shared/prefix_tree.ts";
import type { CompiledKeymap, TreeLeaf } from "../src/shared/prefix_tree.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { build_commands_file } from "../src/shared/registry/index.ts";
import { SETTING_SPECS } from "../src/shared/settings_schema.ts";
import { build_config } from "../tools/build-config/build_config.ts";
import { make_tmp_dir } from "./support/tmp_dir.ts";

const SITE = "https://a.test/*";
const PAGE = "https://a.test/";
const FIND = { id: "find.open" };
const FIND_BACK = { id: "find.open", args: { direction: "backward" } };
const NEXT = { id: "tab.next" };

function compile(rows: unknown[], keymap: Record<string, unknown> = {}) {
  return compile_config({
    config: { ...empty_config(), keymap: keymap as never, settings: { site_rules: rows } as never },
    default_keymap: DEFAULT_KEYMAP,
    get_command: (command_id) => registry.get(command_id),
    enum_sources: {},
  });
}
const ask = async (compiled: CompiledKeymap, address: string) => page_keymap_for({ get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: compiled }) } as never, [address]);
const id_at = (reply: Awaited<ReturnType<typeof ask>>, mode: "visual" | "visual_line" | "caret" | "normal", token: string) => ((reply!.keymap.modes[mode]?.children[token]) as TreeLeaf | undefined)?.steps?.[0]?.invocation.id;

test("a site row binds keys in visual, visual_line and caret mode, and only on a matching page", async () => {
  const { compiled, warnings } = compile([{ site: SITE, keymap: { visual: { x: FIND }, visual_line: { x: FIND }, caret: { x: FIND } } }]);
  assert.deepEqual(warnings, []);
  const on = await ask(compiled, PAGE);
  for (const mode of ["visual", "visual_line", "caret"] as const) assert.equal(id_at(on, mode, "x"), "find.open", mode);
  assert.equal(id_at(on, "normal", "x"), undefined);
  const off = await ask(compiled, "https://b.test/");
  for (const mode of ["visual", "visual_line", "caret"] as const) assert.equal(id_at(off, mode, "x"), undefined, mode);
});

test("a mode bind lands on the global tree of its mode and replaces the key there", async () => {
  const global = id_at(await ask(compile([]).compiled, PAGE), "visual", "y");
  assert.ok(global, "the default keymap binds y in visual mode");
  const reply = await ask(compile([{ site: SITE, keymap: { visual: { y: FIND, x: FIND } } }]).compiled, PAGE);
  assert.equal(id_at(reply, "visual", "y"), "find.open");
  assert.equal(id_at(reply, "visual", "x"), "find.open");
  assert.ok(reply!.keymap.modes.visual!.children["j"], "other visual keys stay");
});

test("bind and keymap.normal merge into one normal table", () => {
  const { compiled, warnings } = compile([{ site: SITE, bind: { j: NEXT }, keymap: { normal: { k: NEXT } } }]);
  assert.deepEqual(warnings, []);
  const rule = compiled.site_rules![0]!;
  assert.deepEqual(Object.keys(rule.bind!).sort(), ["j", "k"]);
  assert.equal(rule.keymap, undefined);
});

test("a row that sets only keymap.normal is not off", () => {
  assert.equal(compile([{ site: SITE, keymap: { normal: { k: NEXT } } }]).compiled.site_rules![0]!.off, undefined);
  assert.equal(compile([{ site: SITE, keymap: { visual: { k: FIND } } }]).compiled.site_rules![0]!.off, undefined);
});

test("rows merge key by key per mode, and the earlier row wins a shared key", async () => {
  const rows = [{ site: SITE, keymap: { visual: { x: FIND } } }, { site: "https://*.a.test/*", keymap: { visual: { x: FIND_BACK, z: FIND }, caret: { x: FIND_BACK } } }];
  const reply = await ask(compile(rows).compiled, PAGE);
  const x = reply!.keymap.modes.visual!.children["x"] as TreeLeaf;
  assert.equal(x.steps[0]!.invocation.args?.["direction"], "forward");
  assert.equal(id_at(reply, "visual", "z"), "find.open");
  assert.equal(id_at(reply, "caret", "x"), "find.open");
});

test("pass and only do not touch mode binds", async () => {
  const bound = { x: FIND };
  const passed = await ask(compile([{ site: SITE, pass: "j", keymap: { visual: bound } }]).compiled, PAGE);
  assert.equal(passed!.keymap.modes.normal!.children["j"], undefined);
  assert.equal(id_at(passed, "visual", "x"), "find.open");
  const only = await ask(compile([{ site: SITE, only: "j", keymap: { visual: bound } }]).compiled, PAGE);
  assert.equal(id_at(only, "visual", "x"), "find.open");
});

test("a page that is off gets no mode binds, whether off or by a key rule that frees every key", async () => {
  const off = await ask(compile([{ site: SITE, off: true, keymap: { visual: { x: FIND } } }]).compiled, PAGE);
  assert.equal(off!.all_off, true);
  assert.equal(id_at(off, "visual", "x"), undefined);
  const later_off = await ask(compile([{ site: SITE, keymap: { visual: { x: FIND } } }, { site: SITE, off: true }]).compiled, PAGE);
  assert.equal(id_at(later_off, "visual", "x"), undefined);
  // `only` always keeps the escape keys, so only a `pass` of every normal key leaves the page with no normal bind.
  const every_key = Object.keys(compile([]).compiled.modes.normal!.children).join(" ");
  const emptied = await ask(compile([{ site: SITE, pass: every_key, keymap: { visual: { x: FIND } } }]).compiled, PAGE);
  assert.equal(emptied!.all_off, true);
  assert.equal(id_at(emptied, "visual", "x"), undefined);
});

test("a command that does not run in the mode is dropped with a warning, and one that does is kept", () => {
  const { compiled, warnings } = compile([{ site: SITE, keymap: { visual: { x: FIND, n: NEXT } } }]);
  assert.deepEqual(Object.keys(compiled.site_rules![0]!.keymap!["visual"]!), ["x"]);
  assert.ok(warnings.some((text) => /keymap "visual" skipped bind "n" of "https:\/\/a.test\/\*"/.test(text) && /tab\.next/.test(text)), warnings.join("\n"));
});

test("a bind that is a prefix of another warns per mode, and the same keys in two modes do not clash", () => {
  const clash = compile([{ site: SITE, keymap: { visual: { x: FIND, xa: FIND } } }]).warnings;
  assert.ok(clash.some((text) => /skipped bind "xa": "x" is already a complete bind for the same site/.test(text)), clash.join("\n"));
  assert.deepEqual(compile([{ site: SITE, keymap: { visual: { x: FIND }, caret: { xa: FIND } } }]).warnings, []);
  const across = compile([{ site: SITE, keymap: { visual: { x: FIND } } }, { site: "https://*.a.test/*", keymap: { visual: { xa: FIND } } }]).warnings;
  assert.ok(across.some((text) => /skipped bind "xa" of "https:\/\/\*\.a\.test\/\*": "x" is already a complete bind of/.test(text)), across.join("\n"));
  assert.deepEqual(compile([{ site: SITE, keymap: { visual: { x: FIND } } }, { site: "https://*.a.test/*", keymap: { caret: { xa: FIND } } }]).warnings, []);
});

test("one key written two ways in bind and keymap.normal is a clash", () => {
  const spec = SETTING_SPECS.site_rules;
  assert.match(spec.explain!([{ site: SITE, bind: { "<C-a>": "tab.next" }, keymap: { normal: { "<C-A>": "tab.prev" } } }]) ?? "", /binds "<C-A>" in both "bind" and "keymap\.normal"/);
  assert.equal(spec.check([{ site: SITE, bind: { "<C-a>": "tab.next" }, keymap: { normal: { "<C-b>": "tab.prev" } } }]), true);
});

test("the keymap column accepts the four modes and refuses another mode, an empty table and a bad key", () => {
  const spec = SETTING_SPECS.site_rules;
  const ok = (keymap: unknown) => spec.check([{ site: SITE, keymap }]);
  assert.equal(ok({ visual: { x: "find" }, visual_line: { x: "find" }, caret: { x: "find" }, normal: { x: "find" } }), true);
  for (const bad of [{ insert: { x: "find" } }, { Visual: { x: "find" } }, { visual: {} }, { visual: { "": "find" } }, {}, "visual", { visual: "find" }]) assert.equal(ok(bad), false, JSON.stringify(bad));
  const refused = spec.explain!([{ site: SITE, keymap: { insert: { x: "find" } } }]);
  assert.match(refused ?? "", /names the mode "insert", which a site row cannot bind \(use "normal", "visual", "visual_line" or "caret"\)/);
});

test("the same key in bind and keymap.normal is refused with the key named", () => {
  const spec = SETTING_SPECS.site_rules;
  assert.equal(spec.check([{ site: SITE, bind: { j: "tab.next" }, keymap: { normal: { k: "tab.next" } } }]), true);
  assert.equal(spec.check([{ site: SITE, bind: { j: "tab.next" }, keymap: { normal: { j: "tab.prev" } } }]), false);
  assert.equal(spec.check([{ site: SITE, bind: { j: "tab.next" }, keymap: { visual: { j: "tab.prev" } } }]), true);
  assert.match(spec.explain!([{ site: SITE, bind: { gj: "tab.next" }, keymap: { normal: { gj: "tab.prev" } } }]) ?? "", /binds "gj" in both "bind" and "keymap\.normal"/);
});

const commands = build_commands_file(registry).commands;
function build_text(text: string) {
  const dir = make_tmp_dir("desertfox-mode-binds-");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.toml"), text);
  return build_config(dir, commands);
}
const problems_of = (text: string): string => {
  try {
    build_text(text);
  } catch (error) {
    if (error instanceof ConfigErrors) return error.problems.join("\n");
    throw error;
  }
  return assert.fail("expected the build to reject the config");
};

test("the config build resolves keymap binds, checks them against their mode and names the mode", () => {
  const good = build_text(`[[site_rules]]\nsite = "${SITE}"\n[site_rules.keymap.visual]\nx = "find"\ny = ["find", "find --backward"]\n`);
  const row = good.settings.site_rules?.[0] as unknown as { keymap: { visual: Record<string, unknown> } };
  assert.deepEqual(row.keymap.visual["x"], { id: "find.open" });
  assert.equal((row.keymap.visual["y"] as unknown[]).length, 2);
  assert.match(problems_of(`[[site_rules]]\nsite = "${SITE}"\n[site_rules.keymap.visual]\nn = "tab.next"\n`), /keymap "visual" bind "n" of "https:\/\/a\.test\/\*": tab\.next runs in normal mode, not visual/);
  assert.match(problems_of(`[[site_rules]]\nsite = "${SITE}"\n[site_rules.keymap.visual]\nn = "no.such"\n`), /keymap "visual" bind "n"/);
});

test("the config build refuses a mode a site row cannot bind and a key in both bind and keymap.normal", () => {
  assert.match(problems_of(`[[site_rules]]\nsite = "${SITE}"\n[site_rules.keymap.insert]\nx = "find"\n`), /insert/);
  const clash = problems_of(`[[site_rules]]\nsite = "${SITE}"\nbind = { j = "tab.next" }\n[site_rules.keymap.normal]\nj = "tab.prev"\n`);
  assert.match(clash, /binds "j" in both "bind" and "keymap\.normal"/);
  build_text(`[[site_rules]]\nsite = "${SITE}"\nbind = { j = "tab.next" }\n[site_rules.keymap.normal]\nk = "tab.prev"\n`);
});

test("which-key lists a site-bound key in visual mode on a matching page only, and not on a page that is off", async () => {
  const storage = { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: compile([{ site: SITE, keymap: { visual: { x: FIND } } }, { site: "https://off.a.test/*", off: true, keymap: { visual: { x: FIND } } }]).compiled }) } as never;
  const keys_on = async (address: string, mode: string) => (await list_keys(storage, (command_id) => registry.get(command_id), { mode, prefix: [] } as never, { addresses: [address] })).rows.map((row) => row.keys);
  assert.ok((await keys_on(PAGE, "visual")).includes("x"));
  assert.equal((await keys_on(PAGE, "caret")).includes("x"), false);
  assert.equal((await keys_on("https://b.test/", "visual")).includes("x"), false);
  assert.equal((await keys_on("https://off.a.test/", "visual")).includes("x"), false);
});

test("a bad keymap.normal bind is named by its column in the warning, and a bad bind by bind", () => {
  const bad_args = { id: "find.open", args: { direction: "sideways" } };
  const warnings = compile([{ site: SITE, keymap: { normal: { "": FIND, x: bad_args } }, bind: { y: bad_args } }]).warnings;
  assert.ok(warnings.some((text) => /^site_rules: keymap "normal" skipped bind "": /.test(text)), warnings.join("\n"));
  assert.ok(warnings.some((text) => /^site_rules: keymap "normal" skipped bind "x" of /.test(text)), warnings.join("\n"));
  assert.ok(warnings.some((text) => /^site_rules: skipped bind "y" of /.test(text)), warnings.join("\n"));
});
